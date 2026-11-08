-- RFC-0001 §8.2 — seat-critical state transitions.
-- Idempotent: applied after the Drizzle table migrations on every `db:migrate`.
-- Rule: any change to users.state or to the seat count goes through these functions,
-- and every one of them takes seat_lock() first, so the seat cap cannot be raced.

-- ─── Settings (defaults; mirror packages/shared/src/rules.ts) ───────────────
insert into settings(key, value) values
  ('seat_cap', '100'),
  ('max_open_invites', '2'),
  ('invite_expiry_days', '7'),
  ('inactivity_days', '30'),
  ('lurker_window_days', '30'),
  ('lurker_min_seen_days', '8'),
  ('lurker_min_contributions', '2'),
  ('new_member_exempt_days', '21'),
  ('lurker_grace_days', '7'),
  ('stay_fee_exempt_days', '90'),
  ('reinstate_offer_hours', '72'),
  ('waitlist_decay_days', '60'),
  ('ban_invite_penalty_days', '30')
on conflict (key) do nothing;

-- Placeholder prices (RFC §15 open question). Change rows in `pricing`; existing rows are never overwritten.
insert into pricing(product_key, amount_minor, currency) values
  ('stay_fee_90d', 500, 'usd'),
  ('reinstatement', 1000, 'usd')
on conflict (product_key) do nothing;

-- Interests (RFC §10.5): the starting list; admins add more from the site. Existing rows are kept.
insert into interests(slug, label) values
  ('design', 'Design'), ('art', 'Art'), ('illustration', 'Illustration'), ('photography', 'Photography'),
  ('film', 'Film'), ('animation', 'Animation'), ('music', 'Music'), ('writing', 'Writing'), ('books', 'Books'),
  ('theatre', 'Theatre'), ('dance', 'Dance'), ('fashion', 'Fashion'), ('architecture', 'Architecture'),
  ('crafts', 'Crafts'), ('code', 'Code'), ('tech', 'Tech'), ('startups', 'Startups'), ('science', 'Science'),
  ('gaming', 'Gaming'), ('sports', 'Sports'), ('fitness', 'Fitness'), ('hiking', 'Hiking'), ('travel', 'Travel'),
  ('cooking', 'Cooking'), ('food', 'Food'), ('coffee', 'Coffee'), ('languages', 'Languages'),
  ('teaching', 'Teaching'), ('volunteering', 'Volunteering'), ('environment', 'Environment')
on conflict (slug) do nothing;
create or replace function setting_int(p_key text) returns int
language sql stable as $$
  select (value #>> '{}')::int from settings where key = p_key
$$;

create or replace function days(p_key text) returns interval
language sql stable as $$
  select make_interval(days => setting_int(p_key))
$$;

create or replace function seat_lock() returns void
language sql as $$
  select pg_advisory_xact_lock(hashtext('anti:seats'))
$$;

-- Seats in use = seated members + open reinstatement offers (an offer holds its seat).
create or replace function seats_used() returns int
language sql stable as $$
  select (select count(*)::int from users where state in ('active', 'flagged_lurker'))
       + (select count(*)::int from waitlist where offered_at is not null and offer_expires_at > now())
$$;

create or replace function invite_hash(p_code text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(p_code, 'UTF8')), 'hex')
$$;

-- ─── Core transition ────────────────────────────────────────────────────────
create or replace function set_state(p_user uuid, p_to user_state, p_reason text, p_actor uuid default null)
returns void language plpgsql as $$
declare v_from user_state;
begin
  select state into v_from from users where id = p_user for update;
  if not found then raise exception 'user_not_found' using errcode = 'P0010'; end if;

  update users set
    state = p_to,
    activated_at = case
      when p_to = 'active' and v_from in ('waitlisted', 'archived', 'banned') then now()
      else activated_at end,
    lurker_flagged_at = case
      when p_to = 'flagged_lurker' then now()
      when p_to in ('active', 'archived', 'banned', 'deleted') then null
      else lurker_flagged_at end
  where id = p_user;

  insert into user_state_events(user_id, from_state, to_state, reason, actor_id)
  values (p_user, v_from, p_to, p_reason, p_actor);
end $$;

-- ─── Waitlist promotion ─────────────────────────────────────────────────────
-- Priority 0 (reinstating members) get a time-limited paid offer; priority 1 (new invitees)
-- are activated immediately. Returns the number of seats filled or offered.
create or replace function promote_waitlist() returns int
language plpgsql as $$
declare v_row waitlist%rowtype; v_n int := 0;
begin
  perform seat_lock();

  for v_row in select * from waitlist where offered_at is not null and offer_expires_at <= now() loop
    delete from waitlist where user_id = v_row.user_id;
    insert into notifications(user_id, kind, payload) values (v_row.user_id, 'seat_offer_expired', '{}');
  end loop;

  loop
    exit when seats_used() >= setting_int('seat_cap');
    select * into v_row from waitlist where offered_at is null order by priority, enqueued_at limit 1;
    exit when not found;

    if v_row.priority = 0 then
      update waitlist
         set offered_at = now(),
             offer_expires_at = now() + make_interval(hours => setting_int('reinstate_offer_hours'))
       where user_id = v_row.user_id;
      insert into notifications(user_id, kind, payload) values (v_row.user_id, 'seat_offered', '{}');
    else
      delete from waitlist where user_id = v_row.user_id;
      perform set_state(v_row.user_id, 'active', 'waitlist_promoted');
      insert into notifications(user_id, kind, payload) values (v_row.user_id, 'activated', '{}');
    end if;
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

-- ─── Invites ────────────────────────────────────────────────────────────────
-- p_creator null = ops/founder invite (no limits). p_code must already be normalised.
create or replace function create_invite(p_creator uuid, p_code text) returns timestamptz
language plpgsql as $$
declare v_user users%rowtype; v_open int; v_expires timestamptz;
begin
  if p_creator is not null then
    select * into v_user from users where id = p_creator for update;
    if v_user.state not in ('active', 'flagged_lurker') then
      raise exception 'invite_not_allowed_state' using errcode = 'P0020';
    end if;
    if v_user.invite_penalty_until is not null and v_user.invite_penalty_until > now() then
      raise exception 'invite_penalty' using errcode = 'P0021';
    end if;
    select count(*) into v_open from invites
     where created_by = p_creator and redeemed_at is null and revoked_at is null and expires_at > now();
    if v_open >= setting_int('max_open_invites') then
      raise exception 'invite_limit' using errcode = 'P0022';
    end if;
  end if;

  v_expires := now() + days('invite_expiry_days');
  insert into invites(code_hash, created_by, expires_at) values (invite_hash(p_code), p_creator, v_expires);
  return v_expires;
end $$;

-- Is this (normalised) code currently redeemable?
create or replace function invite_is_valid(p_code text) returns boolean
language sql stable as $$
  select exists (
    select 1 from invites
     where code_hash = invite_hash(p_code)
       and redeemed_at is null and revoked_at is null and expires_at > now()
  )
$$;

-- Called in the same transaction that inserted the users row (state = 'waitlisted') and its
-- passkey. Everyone enters through the waitlist so FIFO order is always respected; the
-- promotion pass then activates them at once if a seat is free.
create or replace function redeem_invite(p_code text, p_user uuid) returns user_state
language plpgsql as $$
declare v_inv invites%rowtype; v_state user_state;
begin
  perform seat_lock();

  select * into v_inv from invites where code_hash = invite_hash(p_code) for update;
  if not found or v_inv.redeemed_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  update invites set redeemed_by = p_user, redeemed_at = now() where code_hash = v_inv.code_hash;
  update users set invited_by = v_inv.created_by where id = p_user;

  insert into user_state_events(user_id, from_state, to_state, reason)
  values (p_user, null, 'waitlisted', 'invite_redeemed');
  insert into waitlist(user_id, priority) values (p_user, 1);

  perform promote_waitlist();

  select state into v_state from users where id = p_user;
  return v_state;
end $$;

-- ─── Activity ───────────────────────────────────────────────────────────────
create or replace function touch_last_seen(p_user uuid) returns void
language plpgsql as $$
begin
  update users set last_seen_at = now(), last_seen_on = current_date
   where id = p_user and (last_seen_on is null or last_seen_on < current_date);
  if found then
    insert into user_seen_days(user_id, day) values (p_user, current_date) on conflict do nothing;
  end if;
end $$;

-- ─── Paid transitions (called from the Stripe webhook) ──────────────────────
create or replace function pay_stay_fee(p_user uuid) returns void
language plpgsql as $$
declare v_state user_state;
begin
  perform seat_lock();
  select state into v_state from users where id = p_user for update;
  if v_state not in ('active', 'flagged_lurker') then
    raise exception 'stay_fee_not_applicable' using errcode = 'P0030';
  end if;
  update users
     set lurker_exempt_until = greatest(coalesce(lurker_exempt_until, now()), now()) + days('stay_fee_exempt_days')
   where id = p_user;
  if v_state = 'flagged_lurker' then
    perform set_state(p_user, 'active', 'paid_stay_fee');
  end if;
end $$;

create or replace function rejoin_queue(p_user uuid) returns void
language plpgsql as $$
begin
  perform seat_lock();
  if (select state from users where id = p_user) <> 'archived' then
    raise exception 'rejoin_not_applicable' using errcode = 'P0031';
  end if;
  -- Former members (activated before) get priority + a paid offer; never-activated users who
  -- decayed out of the queue rejoin as ordinary invitees (free, auto-promoted).
  insert into waitlist(user_id, priority)
  select p_user, case when activated_at is null then 1 else 0 end from users where id = p_user
  on conflict (user_id) do nothing;
  perform promote_waitlist();
end $$;

create or replace function activate_offer(p_user uuid) returns void
language plpgsql as $$
begin
  perform seat_lock();
  if not exists (select 1 from waitlist where user_id = p_user
                   and offered_at is not null and offer_expires_at > now()) then
    raise exception 'no_open_offer' using errcode = 'P0002';
  end if;
  delete from waitlist where user_id = p_user;
  perform set_state(p_user, 'active', 'paid_reinstate');
end $$;

-- Applies a completed checkout (webhook `checkout.session.completed`). Idempotent per session.
-- Returns 'applied' | 'refund' (paid, but the transition is no longer possible) | 'duplicate'.
create or replace function complete_payment(p_session text, p_intent text) returns text
language plpgsql as $$
declare v payments%rowtype;
begin
  select * into v from payments where stripe_checkout_session_id = p_session for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0040'; end if;
  if v.status not in ('pending', 'expired') then return 'duplicate'; end if;

  update payments set status = 'paid', paid_at = now(), stripe_payment_intent_id = p_intent where id = v.id;
  if v.user_id is null then
    update payments set status = 'refund_pending', refund_reason = 'account_deleted' where id = v.id;
    return 'refund';
  end if;

  begin  -- subtransaction: a failed transition rolls back alone, the payment row stays
    if v.product_key = 'stay_fee_90d' then
      perform pay_stay_fee(v.user_id);
    elsif v.product_key = 'reinstatement' then
      perform activate_offer(v.user_id);
    else
      raise exception 'unknown_product' using errcode = 'P0041';
    end if;
  exception when sqlstate 'P0030' or sqlstate 'P0002' then  -- stay_fee_not_applicable / no_open_offer
    update payments set status = 'refund_pending', refund_reason = sqlerrm where id = v.id;
    return 'refund';
  end;

  insert into notifications(user_id, kind, payload)
  values (v.user_id, case v.product_key when 'stay_fee_90d' then 'stay_fee_paid' else 'reinstated' end,
          jsonb_build_object('paymentId', v.id));
  return 'applied';
end $$;

-- ─── Ops / account removal ──────────────────────────────────────────────────
create or replace function ban_user(p_user uuid, p_actor uuid) returns void
language plpgsql as $$
declare v_inviter uuid;
begin
  perform seat_lock();
  perform set_state(p_user, 'banned', 'ops_ban', p_actor);
  delete from sessions where user_id = p_user;
  delete from waitlist where user_id = p_user;
  update invites set revoked_at = now() where created_by = p_user and redeemed_at is null and revoked_at is null;
  select invited_by into v_inviter from users where id = p_user;
  if v_inviter is not null then
    update users set invite_penalty_until = now() + days('ban_invite_penalty_days') where id = v_inviter;
  end if;
  perform promote_waitlist();
end $$;

-- Lifts a ban. The member gets a seat at once if one is free, otherwise waits in line like a new
-- invitee (free, first come first served). Their passkeys were kept, so they can sign in again.
-- activated_at restarts (set_state), so the inactivity rule does not archive them on the next run.
create or replace function unban_user(p_user uuid, p_actor uuid) returns user_state
language plpgsql as $$
declare v_state user_state;
begin
  perform seat_lock();
  select state into v_state from users where id = p_user for update;
  if v_state is distinct from 'banned' then
    raise exception 'not_banned' using errcode = 'P0023';
  end if;
  if seats_used() < setting_int('seat_cap') then
    perform set_state(p_user, 'active', 'ops_unban', p_actor);
  else
    perform set_state(p_user, 'waitlisted', 'ops_unban', p_actor);
    insert into waitlist(user_id, priority) values (p_user, 1) on conflict (user_id) do nothing;
  end if;
  insert into notifications(user_id, kind, payload) values (p_user, 'unbanned', '{}');
  select state into v_state from users where id = p_user;
  return v_state;
end $$;

-- The row is kept (state log, thread integrity) but stripped of identity.
-- p_reason: 'self_delete' | 'underage' (setup or an admin found the member is under 13).
-- The one-argument version is dropped first: a second overload with defaults would make
-- delete_account(uuid) ambiguous.
drop function if exists delete_account(uuid);
create or replace function delete_account(p_user uuid, p_reason text default 'self_delete', p_actor uuid default null)
returns void
language plpgsql as $$
begin
  perform seat_lock();
  perform set_state(p_user, 'deleted', p_reason, coalesce(p_actor, p_user));
  delete from passkeys where user_id = p_user;
  delete from sessions where user_id = p_user;
  delete from waitlist where user_id = p_user;
  delete from push_subscriptions where user_id = p_user;
  update invites set revoked_at = now() where created_by = p_user and redeemed_at is null and revoked_at is null;
  update payments set user_id = null where user_id = p_user;
  update users set
    handle = 'deleted_' || replace(id::text, '-', ''),
    display_name = 'deleted user',
    bio = '',
    avatar_key = null,
    recovery_code_hash = '',
    stripe_customer_id = null,
    gender = null,
    birthday = null,
    birthday_public = true
  where id = p_user;
  perform promote_waitlist();
end $$;

-- ─── Hourly lifecycle job ───────────────────────────────────────────────────
-- Admins (role 'ops') are exempt from the activity rules: the people who run the room never
-- lose their seat to inactivity or the lurker rule.
create or replace function run_lifecycle() returns void
language plpgsql as $$
declare r record;
begin
  perform seat_lock();

  -- 1. inactivity archival
  for r in select id from users
            where state in ('active', 'flagged_lurker') and role <> 'ops'
              and greatest(last_seen_at, activated_at) < now() - days('inactivity_days') loop
    perform set_state(r.id, 'archived', 'inactive');
  end loop;

  -- 2. flagged lurkers who contributed enough since the flag are cleared; so is anyone made admin
  for r in select u.id, u.role from users u
            where u.state = 'flagged_lurker'
              and (u.role = 'ops'
                   or (select count(*) from contributions c
                        where c.user_id = u.id and c.at >= u.lurker_flagged_at) >= setting_int('lurker_min_contributions')) loop
    perform set_state(r.id, 'active', case when r.role = 'ops' then 'ops_exempt' else 'lurker_resolved_contributed' end);
  end loop;

  -- 3. grace expired
  for r in select id from users
            where state = 'flagged_lurker' and role <> 'ops' and lurker_flagged_at < now() - days('lurker_grace_days') loop
    perform set_state(r.id, 'archived', 'lurker_grace_expired');
  end loop;

  -- 4. lurker detection
  for r in select u.id from users u
            where u.state = 'active' and u.role <> 'ops'
              and u.activated_at < now() - days('new_member_exempt_days')
              and (u.lurker_exempt_until is null or u.lurker_exempt_until < now())
              and (select count(*) from user_seen_days d
                    where d.user_id = u.id
                      and d.day > current_date - setting_int('lurker_window_days')) >= setting_int('lurker_min_seen_days')
              and (select count(*) from contributions c
                    where c.user_id = u.id
                      and c.at > now() - days('lurker_window_days')) < setting_int('lurker_min_contributions') loop
    perform set_state(r.id, 'flagged_lurker', 'lurker_detected');
    insert into notifications(user_id, kind, payload) values (r.id, 'lurker_warning', '{}');
  end loop;

  -- 5. waitlist decay (unoffered entries whose user hasn't checked in)
  for r in select w.user_id, u.state from waitlist w join users u on u.id = w.user_id
            where w.offered_at is null
              and coalesce(u.last_seen_at, u.created_at) < now() - days('waitlist_decay_days') loop
    delete from waitlist where user_id = r.user_id;
    if r.state = 'waitlisted' then
      perform set_state(r.user_id, 'archived', 'waitlist_decay');
    end if;
  end loop;

  -- 6. fill freed seats
  perform promote_waitlist();
end $$;
