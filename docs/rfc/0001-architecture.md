# RFC-0001: Anti-Social Network — Architecture

| | |
|---|---|
| Status | Draft |
| Date | 2026-11-07 |
| Author | siddiqee.shrestha |
| Decisions | Q1–Q34 (grilling session, all accepted) |

## 1. Summary

An invite-only, 100-seat, Twitter-like community with no private messaging. Identity is a passkey plus a handle — no email, no password, no OAuth. Members must keep showing up (30-day inactivity rule) and must keep contributing (lurker rule) or pay a stay fee. Members can host and attend real-world events. Every member has identical capabilities; the only privileged role is a backend-only ops role.

Stack: Next.js web client → Elysia (Bun) API → PostgreSQL (Drizzle + a few PL/pgSQL functions). The API is the single source of truth so a mobile app can be added later without backend changes.

## 2. Goals and non-goals

**Goals**
- Invite-only onboarding with a hard cap of 100 seats, enforced atomically in the database.
- Passkey-only authentication; the user's identity is their handle plus their passkey(s).
- Automated archival of inactive members and lurkers; paid reinstatement and paid stay exemptions.
- Public feed (posts, replies, likes, images) and events (host, RSVP, attend).
- One API serving web now and mobile later.

**Non-goals (v1)**
- Direct/private messaging of any kind.
- Follows, reposts, algorithmic ranking.
- Platform-processed payments for events (Stripe Connect) — see §15.
- Email, SMS, or social login.
- User-facing admin/moderator roles.

## 3. Product rules (the contract)

| Rule | Value |
|---|---|
| Seat cap | 100 seats. A seat is held by users in `active` or `flagged_lurker` state. |
| Invites per member | At most 2 unredeemed codes at a time; refilled as codes are used or expire. |
| Invite expiry | 7 days after creation. |
| Inactivity archival | 30 days without any authenticated request → `archived`. |
| "Seen" | Any authenticated request; `last_seen_at` updated at most once per day. |
| Contribution | Post, reply to someone else's post, hosting an event (with ≥1 confirmed attendee besides host), confirmed attendance. Likes do not count. |
| Lurker | Seen on ≥ 8 distinct days in the rolling 30 days AND < 2 contributions in that window. |
| New-member exemption | No lurker check during the first 21 days after activation. |
| Lurker grace | 7 days after being flagged to contribute twice or pay; otherwise archived. |
| Stay fee | One-time payment; exempt from the lurker check for 90 days. Does not exempt from inactivity archival. |
| Reinstatement | Archived users join the waitlist for free with priority. When a seat opens they have 72 h to pay. |
| Waitlist | FIFO. Reinstating members are ahead of new invitees. New invitees are auto-promoted. |
| Waitlist decay | Waitlisted user not seen for 60 days is removed from the queue. |
| Ban penalty | Inviter of a banned user loses invite privileges for 30 days. |
| Flags | 5 distinct members flagging a post hides it until ops review. |
| Posts | 500 chars, ≤ 4 images × 5 MB (EXIF stripped), edit within 15 min (marked "edited"), delete anytime, 20 posts/hour. |
| Equal permissions | Every member has the same capabilities. Ops is a backend role, not a user-visible one. |

## 4. Account state machine

```
               redeem invite
                    │
                    ▼
             ┌─────────────┐  seat frees (auto)   ┌──────────┐
             │ waitlisted  │─────────────────────▶│  active  │◀─────────────┐
             └─────────────┘                      └──────────┘              │
                ▲      │ 60 days unseen             │      │                │
                │      ▼                            │      │ lurker job     │ contributes 2× or
                │   (removed)                       │      ▼                │ pays stay fee
                │                                   │ ┌────────────────┐    │
                │                                   │ │ flagged_lurker │────┘
                │                                   │ └────────────────┘
                │                     30 d unseen   │      │ 7-day grace expires
                │                                   ▼      ▼
                │  join queue (free, priority)   ┌──────────┐
                └────────────────────────────────│ archived │
                                                 └──────────┘
   seat offered → 72 h to pay → active

   banned: set by ops from any state; terminal unless ops lifts it.
   deleted: user-initiated from any state; terminal.
```

- `users.state` holds the current state; `user_state_events` is an append-only log of every transition (from, to, reason, actor, timestamp).
- All transitions go through SQL functions (§8) so seat accounting can never drift.

## 5. User flows

### 5.1 Join
1. Receive a code (`XXXX-XXXX-XXXX`) from a member out-of-band.
2. Open `/join`, enter code → `POST /invites/check` returns valid/expired/used.
3. Choose handle (immutable) and display name.
4. Create passkey (WebAuthn registration ceremony).
5. Server shows the **recovery code once**; user must confirm they saved it.
6. `redeem_invite()` runs: if a seat is free → `active`; otherwise → `waitlisted` with queue position.
7. Waitlisted users see only a status page (position, estimated wait). Active users land on the feed.

### 5.2 Daily use
- Sign in with passkey (discoverable credential; no username needed).
- Feed, reply, like, post, browse events and members, search.
- Banner if `flagged_lurker` with countdown and two buttons: "Post something" / "Pay stay fee".

### 5.3 Losing access
- Inactivity: archived on day 31 without being seen. Content stays, profile shows "archived".
- Lurker: flagged → 7-day grace → archived.
- Archived users can still sign in, but see only the reinstatement page.

### 5.4 Reinstatement
1. Archived user signs in → "Rejoin the queue" (free).
2. Placed in the priority segment of the waitlist.
3. When a seat opens, it is **offered** (held for 72 h) and the user is notified (in-app + Web Push).
4. User pays via Stripe Checkout → webhook → `activate_offer()` → `active`.
5. Offer expires unpaid → seat released to next in queue, user returns to `archived` (may re-queue).

### 5.5 Device loss / recovery
- Preferred: synced passkeys (iCloud Keychain / Google Password Manager) or a second passkey added from Settings.
- Fallback: recovery code → register new passkey. This revokes **all** existing passkeys and sessions, burns the code, and issues a new one (shown once).

### 5.6 Invite others
- Settings → Invites shows up to 2 open codes with expiry. Generate is disabled when under a ban penalty or not `active`.
- Profile shows "invited by @x". The invite tree is stored.

### 5.7 Self-deletion
- Removes profile, passkeys, sessions, invites; frees seat. Posts and replies are retained with author shown as "deleted user". Payment rows retained with user reference nulled.

## 6. System architecture

```
┌──────────────┐  Eden Treaty (typed)   ┌─────────────────────────┐
│ Next.js web  │───────────────────────▶│  Elysia API (Bun)       │
│ (Vercel)     │   cookie session       │  - auth (WebAuthn)      │
└──────────────┘                        │  - feed / events / ...  │
┌──────────────┐   Bearer token         │  - stripe webhooks      │
│ Mobile (later)│──────────────────────▶│  - cron (advisory lock) │
└──────────────┘                        └───────┬─────────┬───────┘
                                                │         │
                                    ┌───────────▼──┐  ┌───▼──────────┐
                                    │ PostgreSQL   │  │ Cloudflare R2│
                                    │ (Neon)       │  │ (images)     │
                                    └──────────────┘  └──────────────┘
                     Stripe Checkout ──webhook──▶ API     Web Push (VAPID) ◀── API
```

| Concern | Choice |
|---|---|
| Web | Next.js (App Router) on Vercel. Thin client: all data via the API; no direct DB access. |
| API | Elysia on Bun, deployed on Fly.io (or Railway). Eden Treaty gives the web client end-to-end types. |
| DB | PostgreSQL on Neon. Drizzle for schema, migrations, queries. PL/pgSQL for seat-critical transitions. |
| Images | Cloudflare R2 via presigned PUT; API verifies, strips EXIF (sharp), re-encodes to WebP. |
| WebAuthn | `@simplewebauthn/server` + `@simplewebauthn/browser`. |
| Payments | Stripe Checkout (one-time payments). Store only Stripe customer/session/payment IDs, never email. |
| Notifications | `notifications` table (in-app) + Web Push (VAPID). Same table later drives APNs/FCM. |
| Jobs | Hourly cron inside the API process, guarded by `pg_try_advisory_lock` so one instance runs it. |
| Validation | TypeBox (Elysia native) schemas in `packages/shared`, reused by web and mobile. |

### 6.1 Repo layout (Bun workspaces + Turborepo)

```
anti-site/
├─ apps/
│  ├─ web/          Next.js
│  ├─ api/          Elysia
│  └─ mobile/       (later; Expo, consumes Eden client)
├─ packages/
│  ├─ db/           Drizzle schema, migrations, SQL functions (migrations/*.sql)
│  └─ shared/       TypeBox schemas, constants (limits from §3), API types
└─ docs/rfc/
```

All rule constants in §3 live in `packages/shared/src/rules.ts` and are mirrored into the SQL functions via a `settings` table read at runtime, so a single source can be tuned without code changes.

## 7. Authentication and sessions

- **Registration**: only during invite redemption (or recovery). WebAuthn options with `residentKey: 'required'`, `userVerification: 'preferred'`. Challenge stored in `auth_challenges` with 5-minute TTL.
- **Login**: discoverable-credential flow (no handle entry). Server looks up credential ID → user.
- **Passkeys**: many per user (`passkeys` table). Add from Settings requires an active session plus a fresh WebAuthn ceremony on the existing device.
- **Recovery code**: 128-bit random, displayed once, stored as argon2id hash.
- **Sessions**: 32-byte random token; DB stores SHA-256 hash. 7-day sliding expiry. Web: `HttpOnly; Secure; SameSite=Lax` cookie. Mobile: `Authorization: Bearer`. One Elysia `derive` resolves both.
- **Guards**: `requireUser` (any non-deleted, non-banned state), `requireActive` (active or flagged_lurker), `requireOps`.
- **Last seen**: the auth guard calls `touch_last_seen(user_id)` which updates only if `last_seen_on < current_date` and inserts into `user_seen_days`.

## 8. Database

### 8.1 Drizzle schema (abridged but complete in shape)

```ts
// packages/db/src/schema.ts
import { pgTable, pgEnum, uuid, text, timestamp, integer, boolean,
  date, primaryKey, index, uniqueIndex, jsonb, bigint, customType } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const userState = pgEnum('user_state',
  ['waitlisted', 'active', 'flagged_lurker', 'archived', 'banned', 'deleted']);
export const userRole = pgEnum('user_role', ['member', 'ops']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  handle: text('handle').notNull().unique(),          // immutable, citext-like via lower() index
  displayName: text('display_name').notNull(),
  bio: text('bio').notNull().default(''),
  avatarKey: text('avatar_key'),
  role: userRole('role').notNull().default('member'),
  state: userState('state').notNull(),
  invitedBy: uuid('invited_by'),                      // FK users.id, nullable for founders
  recoveryCodeHash: text('recovery_code_hash').notNull(),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  lastSeenOn: date('last_seen_on'),
  lurkerFlaggedAt: timestamp('lurker_flagged_at', { withTimezone: true }),
  lurkerExemptUntil: timestamp('lurker_exempt_until', { withTimezone: true }),
  invitePenaltyUntil: timestamp('invite_penalty_until', { withTimezone: true }),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  stateIdx: index('users_state_idx').on(t.state),
  handleLower: uniqueIndex('users_handle_lower').on(sql`lower(${t.handle})`),
}));

export const userStateEvents = pgTable('user_state_events', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid('user_id').notNull(),
  fromState: userState('from_state'),
  toState: userState('to_state').notNull(),
  reason: text('reason').notNull(),    // 'invite_redeemed','inactive_30d','lurker_grace_expired','paid_reinstate',...
  actorId: uuid('actor_id'),           // null = system
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const userSeenDays = pgTable('user_seen_days', {
  userId: uuid('user_id').notNull(),
  day: date('day').notNull(),
}, t => ({ pk: primaryKey({ columns: [t.userId, t.day] }) }));

export const passkeys = pgTable('passkeys', {
  id: text('id').primaryKey(),                         // credential ID (base64url)
  userId: uuid('user_id').notNull(),
  publicKey: text('public_key').notNull(),
  counter: bigint('counter', { mode: 'number' }).notNull(),
  transports: text('transports').array(),
  deviceLabel: text('device_label'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
});

export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull(),
  client: text('client').notNull(),                    // 'web' | 'mobile'
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authChallenges = pgTable('auth_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  challenge: text('challenge').notNull(),
  purpose: text('purpose').notNull(),                  // 'register' | 'login' | 'add_passkey' | 'recover'
  userId: uuid('user_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const invites = pgTable('invites', {
  codeHash: text('code_hash').primaryKey(),            // SHA-256 of the code; plaintext never stored (§13)
  createdBy: uuid('created_by'),                       // null = ops/founder
  redeemedBy: uuid('redeemed_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const waitlist = pgTable('waitlist', {
  userId: uuid('user_id').primaryKey(),
  priority: integer('priority').notNull(),             // 0 = reinstating member, 1 = new invitee
  enqueuedAt: timestamp('enqueued_at', { withTimezone: true }).notNull().defaultNow(),
  offeredAt: timestamp('offered_at', { withTimezone: true }),     // reinstating only
  offerExpiresAt: timestamp('offer_expires_at', { withTimezone: true }),
}, t => ({ orderIdx: index('waitlist_order').on(t.priority, t.enqueuedAt) }));

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorId: uuid('author_id'),                         // null after author deletion
  parentId: uuid('parent_id'),                         // reply → parent post
  rootId: uuid('root_id'),                             // thread root
  body: text('body').notNull(),                        // CHECK length <= 500
  editedAt: timestamp('edited_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),     // flag threshold reached
  search: tsvector('search'),                          // generated: to_tsvector('simple', body)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  feedIdx: index('posts_feed').on(t.createdAt).where(sql`parent_id is null and deleted_at is null and hidden_at is null`),
  threadIdx: index('posts_thread').on(t.rootId, t.createdAt),
  searchIdx: index('posts_search').using('gin', t.search),
}));

export const postImages = pgTable('post_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id').notNull(),
  r2Key: text('r2_key').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  position: integer('position').notNull(),             // 0..3
});

export const likes = pgTable('likes', {
  userId: uuid('user_id').notNull(),
  postId: uuid('post_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({ pk: primaryKey({ columns: [t.userId, t.postId] }) }));

export const flags = pgTable('flags', {
  userId: uuid('user_id').notNull(),
  postId: uuid('post_id').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolution: text('resolution'),                      // 'restored' | 'removed'
}, t => ({ pk: primaryKey({ columns: [t.userId, t.postId] }) }));

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  hostId: uuid('host_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  location: text('location').notNull(),
  locationRsvpOnly: boolean('location_rsvp_only').notNull().default(false),
  capacity: integer('capacity'),                       // null = unlimited
  priceNote: text('price_note'),                       // informational, e.g. "$15 at the door"
  externalPaymentUrl: text('external_payment_url'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rsvpStatus = pgEnum('rsvp_status', ['going', 'waitlisted', 'cancelled']);
export const eventRsvps = pgTable('event_rsvps', {
  eventId: uuid('event_id').notNull(),
  userId: uuid('user_id').notNull(),
  status: rsvpStatus('status').notNull(),
  attendedConfirmedAt: timestamp('attended_confirmed_at', { withTimezone: true }), // set by host
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({ pk: primaryKey({ columns: [t.eventId, t.userId] }) }));

// Denormalised ledger used by the lurker check; written by triggers/app on each contribution.
export const contributions = pgTable('contributions', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid('user_id').notNull(),
  kind: text('kind').notNull(),                        // 'post'|'reply'|'event_hosted'|'event_attended'
  refId: uuid('ref_id').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  userAt: index('contrib_user_at').on(t.userId, t.at),
  uniq: uniqueIndex('contrib_uniq').on(t.userId, t.kind, t.refId),
}));

export const pricing = pgTable('pricing', {
  productKey: text('product_key').primaryKey(),        // 'stay_fee_90d' | 'reinstatement'
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
  active: boolean('active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),                             // nulled on account deletion
  productKey: text('product_key').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
  stripeCheckoutSessionId: text('stripe_checkout_session_id').notNull().unique(),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  status: text('status').notNull(),                    // 'pending'|'paid'|'expired'|'refunded'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
});

export const stripeEvents = pgTable('stripe_events', {  // webhook idempotency
  id: text('id').primaryKey(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  kind: text('kind').notNull(),    // 'reply','like','event_update','lurker_warning','seat_offered','activated',...
  payload: jsonb('payload').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({ inbox: index('notif_inbox').on(t.userId, t.createdAt) }));

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  platform: text('platform').notNull(),               // 'webpush' now; 'apns'|'fcm' later
  endpoint: text('endpoint').notNull().unique(),
  keys: jsonb('keys').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable('settings', {          // tunable rule constants from §3
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});
```

Foreign keys are declared in full in the real schema (omitted above for length). Notable `ON DELETE` choices: posts.author_id `SET NULL`, payments.user_id `SET NULL`, everything else owned by a user `CASCADE`.

### 8.2 SQL functions (the seat-critical core)

All seat-changing operations take a single transaction-scoped advisory lock so the 100-seat invariant cannot race:

```sql
-- packages/db/migrations/0002_seat_functions.sql
create or replace function seat_lock() returns void language sql as
$$ select pg_advisory_xact_lock(hashtext('seats')) $$;

create or replace function seats_used() returns int language sql stable as $$
  select (select count(*)::int from users where state in ('active','flagged_lurker'))
       + (select count(*)::int from waitlist where offered_at is not null and offer_expires_at > now())
$$;  -- an open reinstatement offer holds a seat

create or replace function set_state(p_user uuid, p_to user_state, p_reason text, p_actor uuid default null)
returns void language plpgsql as $$
declare v_from user_state;
begin
  select state into v_from from users where id = p_user for update;
  update users set state = p_to,
    activated_at = case when p_to = 'active' and v_from in ('waitlisted','archived') then now() else activated_at end
  where id = p_user;
  insert into user_state_events(user_id, from_state, to_state, reason, actor_id)
  values (p_user, v_from, p_to, p_reason, p_actor);
end $$;

-- Called after the WebAuthn registration has been verified in the API, inside one transaction
-- that also inserts the user row (state='waitlisted') and passkey.
create or replace function redeem_invite(p_code text, p_user uuid) returns user_state
language plpgsql as $$
declare v_inv invites%rowtype;
begin
  perform seat_lock();
  select * into v_inv from invites
   where code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex') for update;
  if not found or v_inv.redeemed_at is not null or v_inv.revoked_at is not null
     or v_inv.expires_at < now() then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  update invites set redeemed_by = p_user, redeemed_at = now() where code_hash = v_inv.code_hash;
  update users set invited_by = v_inv.created_by where id = p_user;

  if seats_used() < (select (value)::int from settings where key = 'seat_cap')
     and not exists (select 1 from waitlist) then          -- don't jump the queue
    perform set_state(p_user, 'active', 'invite_redeemed');
    return 'active';
  else
    insert into waitlist(user_id, priority) values (p_user, 1);
    perform set_state(p_user, 'waitlisted', 'invite_redeemed_cap_full');
    return 'waitlisted';
  end if;
end $$;

-- Fills free seats from the queue. Priority 0 (reinstating) get an offer; priority 1 get activated.
create or replace function promote_waitlist() returns int language plpgsql as $$
declare v_row waitlist%rowtype; v_n int := 0;
begin
  perform seat_lock();
  -- expire stale offers first
  for v_row in select * from waitlist where offered_at is not null and offer_expires_at <= now() loop
    delete from waitlist where user_id = v_row.user_id;
    insert into notifications(user_id, kind, payload) values (v_row.user_id, 'seat_offer_expired', '{}');
  end loop;

  while seats_used() < (select (value)::int from settings where key = 'seat_cap') loop
    select * into v_row from waitlist where offered_at is null
      order by priority, enqueued_at limit 1 for update skip locked;
    exit when not found;
    if v_row.priority = 0 then
      update waitlist set offered_at = now(), offer_expires_at = now() + interval '72 hours'
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

-- Called from the Stripe webhook for product 'reinstatement'.
create or replace function activate_offer(p_user uuid) returns void language plpgsql as $$
begin
  perform seat_lock();
  if not exists (select 1 from waitlist where user_id = p_user
                 and offered_at is not null and offer_expires_at > now()) then
    raise exception 'no_open_offer' using errcode = 'P0002';   -- webhook marks payment for refund
  end if;
  delete from waitlist where user_id = p_user;
  update users set lurker_flagged_at = null where id = p_user;
  perform set_state(p_user, 'active', 'paid_reinstate');
end $$;

-- Hourly job body.
create or replace function run_lifecycle() returns void language plpgsql as $$
declare r record;
begin
  perform seat_lock();

  -- 1. inactivity archival
  for r in select id from users where state in ('active','flagged_lurker')
           and coalesce(last_seen_at, activated_at) < now() - interval '30 days' loop
    perform set_state(r.id, 'archived', 'inactive_30d');
  end loop;

  -- 2. lurker grace expiry
  for r in select id from users where state = 'flagged_lurker'
           and lurker_flagged_at < now() - interval '7 days' loop
    perform set_state(r.id, 'archived', 'lurker_grace_expired');
  end loop;

  -- 3. lurker resolution (contributed twice since flag)
  for r in select u.id from users u where u.state = 'flagged_lurker'
           and (select count(*) from contributions c where c.user_id = u.id
                and c.at >= u.lurker_flagged_at) >= 2 loop
    update users set lurker_flagged_at = null where id = r.id;
    perform set_state(r.id, 'active', 'lurker_resolved_contributed');
  end loop;

  -- 4. lurker detection
  for r in select u.id from users u
           where u.state = 'active'
             and u.activated_at < now() - interval '21 days'
             and (u.lurker_exempt_until is null or u.lurker_exempt_until < now())
             and (select count(*) from user_seen_days d where d.user_id = u.id
                  and d.day > current_date - 30) >= 8
             and (select count(*) from contributions c where c.user_id = u.id
                  and c.at > now() - interval '30 days') < 2 loop
    update users set lurker_flagged_at = now() where id = r.id;
    perform set_state(r.id, 'flagged_lurker', 'lurker_detected');
    insert into notifications(user_id, kind, payload) values (r.id, 'lurker_warning', '{}');
  end loop;

  -- 5. waitlist decay
  delete from waitlist w using users u
   where w.user_id = u.id and w.offered_at is null
     and coalesce(u.last_seen_at, u.created_at) < now() - interval '60 days';

  -- 6. invite expiry is implicit (expires_at); nothing to do.

  -- 7. fill freed seats
  perform promote_waitlist();
end $$;
```

The literal intervals above are shown for readability; the real functions read them from `settings`.

Other SQL functions (straightforward, not shown): `touch_last_seen(user)`, `pay_stay_fee(user)` (sets `lurker_exempt_until = now() + 90 days`, clears flag, → `active`), `rejoin_queue(user)` (archived → insert waitlist priority 0, state stays `archived` until offer is paid), `ban_user(user, actor)` (→ `banned`, sets inviter `invite_penalty_until`, revokes sessions, calls `promote_waitlist`), `delete_account(user)`.

### 8.3 Drizzle vs SQL boundary

| In Drizzle (TypeScript) | In PL/pgSQL |
|---|---|
| All reads, feed, search, events CRUD, likes, flags, notifications | Anything that changes `users.state` or seat count |
| Invite creation (with app-side limit check + DB partial unique index) | `redeem_invite`, `promote_waitlist`, `activate_offer`, `run_lifecycle`, `ban_user`, `delete_account`, `pay_stay_fee` |

Drizzle calls them via `db.execute(sql\`select redeem_invite(${code}, ${userId})\`)`. Functions live in raw SQL migrations under `packages/db/migrations` alongside Drizzle-generated ones.

## 9. Payments

- **Products**: `stay_fee_90d`, `reinstatement`. Rows in `pricing`; prices TBD (§15).
- **Flow**: `POST /payments/checkout {productKey}` → API validates eligibility (stay fee: state `flagged_lurker` or `active`; reinstatement: has an open offer) → creates Stripe Checkout Session (`mode: 'payment'`, `client_reference_id = user.id`, `metadata.product_key`) → inserts `payments` row `pending` → returns URL.
- **Webhook** `POST /webhooks/stripe`: verify signature → insert into `stripe_events` (PK conflict = already processed, return 200) → on `checkout.session.completed` mark paid and call `pay_stay_fee` or `activate_offer`. If `activate_offer` raises `no_open_offer` (paid after expiry), auto-refund via Stripe API and notify.
- **Checkout expiry**: Checkout session `expires_at` set no later than the offer expiry.
- **Privacy**: Stripe will collect an email for receipts; we never read or store it. Only the Stripe customer ID is persisted.

## 10. Feed, posts, events

**Feed**: `GET /feed?cursor=` — top-level posts, newest first, keyset pagination on `(created_at, id)`, excludes deleted/hidden. Each item includes like count, reply count, `likedByMe`, images.

**Replies**: `parent_id` + `root_id`; thread view loads by `root_id`. Replies count as contributions.

**Images**: client requests presigned upload URLs (`POST /uploads`), uploads to a quarantine prefix; `POST /posts` references the upload IDs; API downloads, validates type/size, strips EXIF, re-encodes WebP, moves to public prefix. Max 4.

**Edit**: allowed if `now() - created_at < 15 min`; sets `edited_at`. **Delete**: soft delete (`deleted_at`), body cleared, and its `contributions` row removed so post-then-delete can't satisfy the lurker rule.

**Flags**: `POST /posts/:id/flag`. On the 5th distinct flag, `hidden_at = now()` and ops is notified. Ops resolves via ops endpoints.

**Search**: `GET /search?q=` — `websearch_to_tsquery('simple', q)` against `posts.search`, plus handle/display-name prefix match on users.

**Directory**: `GET /members` — active and flagged_lurker members, with invited-by.

**Events**:
- Any `active` member creates; host edits/cancels. Cancel notifies all RSVPs.
- RSVP: `going` if under capacity, else `waitlisted`; a cancellation promotes the oldest event-waitlisted RSVP.
- If `location_rsvp_only`, location is returned only to the host and `going` RSVPs.
- After `starts_at`, host marks attendance (`attended_confirmed_at`). This writes `event_attended` contributions for attendees and, on the first confirmed non-host attendee, an `event_hosted` contribution for the host.
- `price_note` and `external_payment_url` are informational only.

### 10.1 Portfolio and projects (added 2026-11-08)

The member page `/u/<handle>` is one large window laid out like a Behance portfolio; posts and
Picks sit underneath behind folder tabs. Members only, like everything else. Every field is
optional and nothing asks for a real name, email or phone.

- **Portfolio** (`portfolios`, one row per member): headline, location, "open to work", about,
  skills and tools (tags), experience and education (title, place, from, to | null, one line;
  sorted newest first), up to 6 `https://` links (opened with `noopener noreferrer`, no referrer),
  an optional cover strip, and the look: typeface (Archivo, Space Mono, Shantell Sans — served
  through `next/font`, never from Google at runtime), white or black background (fixed; does not
  follow the system dark mode), one of six accents. No custom fonts or CSS. An empty portfolio
  looks like the plain profile; only the owner sees the invitation to start one. Owners edit in
  place; Settings keeps only display name and bio.
- **Projects** (`projects`, `project_images`): up to 12 numbered case studies, each with a details
  line (year, role, team, duration, tools), a summary, a write-up and up to 10 images, each full
  width or beside a text panel on the left or right. `draft` projects are visible only to the
  owner. Images come from the post upload pipeline (5 MB, 2048 px, re-encoded, metadata stripped);
  attaching one moves its row out of `post_images`, so the orphan sweep never touches it.
- **Reports**: `POST /projects/:id/flag` behaves like a post flag (same threshold, same ops queue,
  `project_flags`). A hidden project disappears for others and returns 404; the owner still sees
  it, marked "hidden after reports". Ops restore (unhide) or remove (delete, owner notified with
  `project_removed`).
- **Lurker rule**: editing a portfolio or a project is about yourself, not a conversation with the
  room, so it never writes a `contributions` row. No feed items or notifications are created.
- **Member list and search** carry the headline and "open to work"; search also matches the headline.

## 11. API surface (Elysia)

Guards: **P** public, **U** any signed-in non-banned user, **A** active/flagged_lurker, **O** ops.

| Method & path | Guard | Purpose |
|---|---|---|
| `POST /invites/check` | P | Validate a code |
| `POST /auth/register/options` | P | WebAuthn registration options (requires valid invite code + handle) |
| `POST /auth/register/verify` | P | Verify, create user + passkey, `redeem_invite`, return recovery code once, start session |
| `POST /auth/login/options` | P | Discoverable login options |
| `POST /auth/login/verify` | P | Verify, start session |
| `POST /auth/recover/options` / `verify` | P | Recovery-code flow; rotates code |
| `POST /auth/logout` | U | End session |
| `GET /me` | U | Profile, state, waitlist position / offer, lurker countdown |
| `GET/POST/DELETE /me/passkeys` | U | Manage passkeys |
| `PATCH /me` | U | Display name, bio, avatar |
| `DELETE /me` | U | Self-deletion |
| `GET/POST /me/invites` | A | List / create (≤ 2 open, no penalty) |
| `POST /me/waitlist/rejoin` | U (archived) | Join priority queue |
| `GET /feed` | A | Global feed |
| `POST /posts` | A | Create post or reply |
| `GET /posts/:id` | A | Post + thread |
| `PATCH /posts/:id` | A | Edit (15 min) |
| `DELETE /posts/:id` | A | Delete |
| `POST/DELETE /posts/:id/like` | A | Like / unlike |
| `POST /posts/:id/flag` | A | Flag |
| `POST /uploads` | A | Presigned image upload |
| `GET /search` | A | Full-text search |
| `GET /members`, `GET /members/:handle` | A | Directory, profile, member's posts |
| `GET /members/:handle/portfolio`, `PATCH /me/portfolio` | A | Portfolio (CV fields, look, cover) |
| `GET /members/:handle/projects[/:id]` | A | Contents list (with the look) and one project |
| `POST /me/projects`, `PATCH/DELETE /me/projects/:id`, `POST /me/projects/order` | A | Projects |
| `POST /projects/:id/flag`, `POST /ops/projects/:id/resolve` | A / O | Report a project; ops restore or remove |
| `GET/POST /events`, `GET/PATCH/DELETE /events/:id` | A | Events |
| `POST/DELETE /events/:id/rsvp` | A | RSVP |
| `POST /events/:id/attendance` | A (host) | Confirm attendees |
| `GET /notifications`, `POST /notifications/read` | U | In-app inbox |
| `POST/DELETE /push/subscriptions` | U | Web Push |
| `POST /payments/checkout` | U | Stripe Checkout session |
| `POST /webhooks/stripe` | P (signed) | Stripe webhook |
| `POST /ops/invites` | O | Mint founder invites |
| `GET /ops/flags`, `POST /ops/flags/:postId/resolve` | O | Moderation queue |
| `POST /ops/users/:id/ban` | O | Ban |

Ops also has a CLI (`bun run ops:mint-invites --count 10`) that calls the same service code, used once to bootstrap.

## 12. Scheduled jobs

| Job | Frequency | What |
|---|---|---|
| `run_lifecycle()` | Hourly | Archival, lurker detection/resolution/grace, waitlist decay, promotion (§8.2) |
| Session + challenge cleanup | Daily | Delete expired `sessions`, `auth_challenges` |
| Upload quarantine sweep | Daily | Delete orphaned R2 quarantine objects > 24 h |
| Notification fan-out | On insert (in-process queue) | Send Web Push for push-worthy kinds |

Runner: `@elysiajs/cron` in the API; each tick does `select pg_try_advisory_lock(<job id>)` and skips if not acquired, so multiple API instances are safe.

## 13. Security, abuse, privacy

- **Invite codes**: 60+ bits of entropy, rate-limited checks (10/min/IP) to prevent enumeration. Stored as SHA-256 hash; the plaintext is shown only to the creator.
- **WebAuthn**: RP ID = production domain; origin checked; signature counter checked; challenge single-use.
- **Sessions**: hashed tokens; revoke-all on recovery and ban; CSRF mitigated by `SameSite=Lax` + Origin check on mutating requests.
- **Rate limits** (per user, Postgres- or memory-backed): posts 20/h, likes 300/h, flags 30/day, invites per §3, auth endpoints per IP.
- **Content**: body length CHECK in DB; images re-encoded server-side (removes EXIF/GPS and polyglot payloads).
- **Privacy**: no email, phone, or real name collected. IP addresses not persisted beyond rate-limit windows. Event location can be RSVP-only.
- **Gaming the lurker rule**: likes don't count; deleted posts remove their contribution; a reply to your own post does not count (replies to anyone else do, in any thread); portfolio and project edits never count.
- **Portfolio**: every field optional, no real-name field; links must be `https://` and may not carry credentials; the look is a fixed set of classes, never member CSS; the cover and project images go through the same re-encoding as post images.
- **Audit**: `user_state_events` and `payments` are append-only for operational and financial auditing.

## 14. Mobile path

- Mobile (Expo/React Native) uses the same Elysia API via the Eden Treaty client from `packages/shared`.
- Sessions via Bearer token in secure storage. Passkeys via native platform APIs (`react-native-passkey` or equivalent) with the same RP ID (requires `apple-app-site-association` and `assetlinks.json` on the web domain).
- Push: add `apns`/`fcm` rows to `push_subscriptions`; the notification fan-out picks the transport by platform.
- No backend schema changes are required.

## 15. Open questions

1. **Prices** for `stay_fee_90d` and `reinstatement` (and currency). Go into `pricing`.
2. **Paid events via Stripe Connect** — deferred; requires host KYC, which conflicts with pseudonymity.
3. **Tax**: if selling to EU/UK, revisit Stripe Tax or a merchant of record (Lemon Squeezy/Paddle).
4. **Exact lurker thresholds** (8 seen days / 2 contributions / 30-day window) are set in `settings` and should be revisited after the first month of real data.
5. ~~**Self-reply gaming** of the contribution rule (§13).~~ Resolved: self-replies do not count.
6. **Domain name** — needed early because it becomes the WebAuthn RP ID and cannot change without re-registering every passkey.

## 16. Milestones

1. **M1 — Foundations**: monorepo, Drizzle schema + SQL functions with tests for the seat invariant, Elysia skeleton, WebAuthn register/login/recover, ops invite CLI.
2. **M2 — Core social**: feed, posts, replies, likes, images, profiles, directory, search, notifications (in-app).
3. **M3 — Lifecycle**: waitlist, `run_lifecycle` cron, lurker banner, archived/reinstatement screens.
4. **M4 — Payments**: pricing table, Stripe Checkout, webhook, refunds on expired offers.
5. **M5 — Events**: CRUD, RSVP + capacity, attendance confirmation, contributions.
6. **M6 — Hardening**: flags + ops queue, rate limits, Web Push, load/race tests on seat functions, launch with 10 founder invites.
7. **M7 — Portfolio** (2026-11-08, §10.1): the profile as a Behance-style portfolio, in four steps: CV card and in-place editing; projects and project pages; cover, the look, headline in the member list; reports and docs.

## Appendix A — Decision log

| # | Decision |
|---|---|
| Q1 | Separate Elysia API + Next.js client from day one (Eden Treaty). |
| Q2 | Passkey-only; multiple passkeys per account + one-time recovery code. |
| Q3 | ≤ 2 open invites per active member, 7-day expiry; invite tree recorded. |
| Q4 | Cap full → FIFO waitlist. |
| Q5 | Activity = any authenticated request, `last_seen` once/day; 7-day sessions. |
| Q6 | Contribution = post/reply/host/attend; lurker = ≥ 8 seen days & < 2 contributions in 30 days. |
| Q7 | Archived content stays visible; profile badged; seat freed. |
| Q8 | Stripe Checkout; store customer ID only. |
| Q9 | v1 events free; external payment link only. |
| Q10 | Single global chronological feed; posts, public replies, likes, images. No follows/reposts. |
| Q11 | 5 flags hide a post pending ops review; ops is backend-only. |
| Q12 | Drizzle + PL/pgSQL for seat/state transitions. |
| Q13 | Immutable handle, editable display name/bio. |
| Q14 | State machine: waitlisted → active ↔ flagged_lurker → archived; banned; append-only event log. |
| Q15 | The profile is a portfolio: one window, Behance layout inside the retro frame; members only; every field optional, no real name. |
| Q16 | Portfolio look from a fixed set (3 typefaces, 2 backgrounds, 6 accents); background fixed, not following dark mode. |
| Q17 | Projects: ≤ 12, ≤ 10 images, per-project draft; reportable like posts, owner keeps seeing a hidden one; edits never count toward the lurker rule. |
| Q15 | Lurker: warn + 7-day grace to contribute twice or pay. |
| Q16 | Stay fee: one-time, 90-day exemption from lurker check only. |
| Q17 | Reinstatement: free priority queue; pay within 72 h of seat offer. |
| Q18 | Account + passkey created at redemption; waitlisted users see status only; 60-day queue decay. |
| Q19 | Inviter loses invite privileges 30 days if invitee banned. |
| Q20 | Recovery revokes all passkeys/sessions and rotates the code. |
| Q21 | Host confirms attendance; hosting counts with ≥ 1 confirmed attendee. |
| Q22 | Any member hosts; capacity + waitlist; RSVP-only location; host cancels. |
| Q23 | Vercel + Fly/Railway + Neon + R2; hourly cron with advisory lock. |
| Q24 | Hashed opaque sessions; cookie (web) / Bearer (mobile). |
| Q25 | Ops CLI mints 10 founder invites. |
| Q26 | Self-deletion; posts kept as "deleted user"; payments anonymised. |
| Q27 | In-app notifications + optional Web Push. |
| Q28 | No lurker check during first 21 days. |
| Q29 | New invitees auto-promoted from waitlist. |
| Q30 | 500 chars, 4 images, 15-min edit, 20 posts/h. |
| Q31 | Member directory + Postgres full-text search. |
| Q32 | Prices in a `pricing` table. |
| Q33 | Bun workspaces + Turborepo monorepo. |
| Q34 | This file. |
