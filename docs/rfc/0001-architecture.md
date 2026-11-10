# RFC-0001: Anti-Social Network — Architecture

| | |
|---|---|
| Status | Draft |
| Date | 2026-11-07 |
| Author | siddiqee.shrestha |
| Decisions | Q1–Q34 (grilling session, all accepted) |

## 1. Summary

An invite-only, 100-seat, Twitter-like community with no private messaging. Identity is a passkey plus a handle — no email login, no password, no OAuth (members give admins a phone and an email, §10.7). Members must keep showing up (30-day inactivity rule) and must keep contributing (lurker rule) or pay a stay fee. Members can host and attend real-world events. Every member has identical capabilities, except admins (role `ops`), who run the room from an Admin page (§10.2, added 2026-11-08; originally ops was backend-only).

Stack: Next.js web client → Elysia (Bun) API → PostgreSQL (Drizzle + a few PL/pgSQL functions). The API is the single source of truth so a mobile app can be added later without backend changes.

## 2. Goals and non-goals

**Goals**
- Invite-only onboarding with a hard cap of 100 seats, enforced atomically in the database.
- ~~Passkey-only authentication~~ (2026-11-09, §10.13: a handle and a 6-digit PIN; passkeys optional); the user's identity is their handle.
- Automated archival of inactive members and lurkers; paid reinstatement and paid stay exemptions.
- Public feed (posts, replies, likes, images) and events (host, RSVP, attend).
- One API serving web now and mobile later.

**Non-goals (v1)**
- Direct/private messaging of any kind. (Consultations, §10.6, let two adults swap contacts after an accepted request; the conversation happens off the site.)
- Follows, reposts, algorithmic ranking.
- Platform-processed payments for events (Stripe Connect) — see §15.
- Email, SMS, or social login. (Members give a phone and an email for admins only, §10.7; they are never used to sign in.)
- ~~User-facing admin/moderator roles.~~ Reversed 2026-11-08: admins are visible and have an Admin page (§10.2).

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
| Flags | 5 distinct members flagging a post hides it until an admin reviews it. Admins can also remove any post or project directly. |
| Posts | 1500 chars (raised from 500 on 2026-11-09), ≤ 4 images × 5 MB (EXIF stripped), edit within 15 min (marked "edited"), delete anytime, 20 posts/hour. |
| Equal permissions | Every member has the same capabilities, except admins (role `ops`): they moderate, ban and unban, change handles, mint invites without limit and set the room's size. Admins carry the OG mark (§10.7; it replaced the "admin" tag) and are exempt from the inactivity and lurker rules. See §10.2. |
| Handles | Chosen at sign-up; members cannot change them. Admins can change anyone's handle (their own included); the face, drawn from the handle, changes with it. |

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

   banned: set by an admin from any state (never on an admin); an admin can lift it (unban_user):
           active if a seat is free, otherwise waitlisted as a new invitee.
   deleted: user-initiated from any state; terminal.
```

- `users.state` holds the current state; `user_state_events` is an append-only log of every transition (from, to, reason, actor, timestamp).
- All transitions go through SQL functions (§8) so seat accounting can never drift.

## 5. User flows

### 5.1 Join
1. Receive a code (`XXXX-XXXX-XXXX`) from a member out-of-band.
2. Open `/join`, enter code → `POST /invites/check` returns valid/expired/used.
3. Choose handle and display name (members can't change the handle later; an admin can, §10.2).
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
  handle: text('handle').notNull().unique(),          // members can't change it; admins can (§10.2). citext-like via lower() index
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
  body: text('body').notNull(),                        // CHECK length <= 1500
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

### 10.2 Admins (added 2026-11-08)

The owner asked for a real admin rather than a hidden backend role. `users.role = 'ops'` is the
admin; the web app shows an **Admin** menu item and page to admins only (members get a 404 from
`/ops/*` and "Not found" on `/admin`).

- **Invite codes**: founder invites (no inviter, no limit), shown once with copy buttons.
- **Reports**: the flag queue; Keep it / Restore / Remove. Admins can also remove **any** post (post
  menu: "Remove (admin)") or project (project page) without reports. Removing closes any open
  reports and tells the author (`post_removed`, `project_removed` with the title).
- **Members**: everyone but deleted accounts, seated first and admins on top. Per person:
  - **Ban** (not admins) and **Unban**: `unban_user()` re-seats them if a seat is free, else they
    queue as a new invitee; their passkeys were kept, so they sign in as before. `set_state`
    restarts `activated_at` on banned → active so the inactivity rule doesn't archive them at once.
  - **Make admin / Remove admin**: only seated members can be made admin; the last admin cannot be
    removed (rows locked so two admins can't remove each other at once).
  - **Change handle**: same rules as sign-up, case-insensitively unique; changing only the case of
    a handle is allowed. The member is told (`handle_changed`, with the new handle). The face is
    drawn from the handle, so it changes too; old `/u/<handle>` links stop working.
- **Community**: seat cap (1–1000; raising it runs `promote_waitlist()`, lowering it removes
  nobody), open invites per member (0–20) and invite expiry (1–60 days). The seat charts read the
  cap from `GET /seats` instead of the compiled-in default.
- **Admin perks**: an "admin" tag next to the name (posts, member lists, profile), and
  `run_lifecycle()` skips admins for inactivity archival and lurker detection (a flagged member
  made admin is cleared at once).
- **Bootstrap**: `OPS_HANDLES` grants admin on boot only while no admin exists; otherwise a handle
  freed by a rename could be claimed by someone else and promoted at the next restart.

### 10.3 Setup: About you, gender, birthday (added 2026-11-08)

Grilled with the owner (Q1–Q18, all accepted). Every member fills in three things once, right after
the recovery-code screen; everyone who joined before gets the same page on their next visit, admins
included. Until it is done the app shows only `/setup` (sign-out still works) and the API answers
`setup_required` (403) from every seated endpoint; `/me`, `/me/setup`, passkeys, notifications and
settings stay open. People still waiting for a seat see only their status page, as before.

- **About you**: 50–300 words (runs of non-space; at most 2,400 characters), with a live counter. It
  *is* the portfolio's About (same rule in the portfolio editor), so a portfolio is never empty. The
  short 160-character bio is unchanged and optional.
- **Gender**: Woman / Man / Non-binary / Prefer not to say. It only shapes the drawn face and is never
  shown as text; it can change any time in Settings. Faces are generated from handle + gender, from
  three hair sets that never overlap (redrawn 2026-11-09 after a woman's face came out looking like a
  man's): women draw from bob, long, bun, full curls, ponytail and braids, always get lashes (or
  earrings where glasses hide the lashes) and never facial hair; men draw from flat, spiky, cap,
  quiff, buzz and short curls and may have a beard or moustache; non-binary, prefer-not-to-say and
  "not set up yet" draw from side, mop, wavy, beanie and crown with none of those markers. The
  landing page's hundred seats are half women, half men. `/dev/faces` shows 200 + 200 + 100 samples
  for checking. Every change to the sets redraws every face; it was done once while the room was small.
- **Birthday**: a date; under 13 the app asks "is that right?" and then the account is closed (the
  birthday is never stored); future dates and ages over 120 are refused. Members can't change it;
  admins can correct it (same under-13 rule, with a confirmation). Only month and day are ever shared,
  and only for the "birthday today" tag; ages are visible to admins only.
- **Closing an account** (self-delete, under 13): `closeAccount()` removes the portfolio and projects
  with their images, then `delete_account(user, reason, actor)` frees the seat and strips the row
  (handle, name, gender, birthday...). Posts stay as "deleted user" so threads still read.
- **Birthdays today**: on each viewer's own date (29 February on the 28th in other years) a red
  "birthday today" tag by the name (posts, member lists, seat map, profile), a "birthdays" window in
  the desktop side panel and one line above the feed on phones; no notifications. Settings has a
  "Show my birthday" switch (on by default).
- **Finish your profile**: after the house-rules welcome is closed, a checklist window on the feed
  (headline, skills, a published project, a first post, a pick; deliberately no "invite someone": the room stays hand-picked). Items tick themselves from
  what the member has done (`GET /me/checklist`); it nudges, never blocks; closing it is saved to the
  account (`checklist_dismissed_at`).
- **Reminder**: while the checklist isn't finished, one `checklist_reminder` notification a day (push too), starting a day after setup; the new one replaces the unread old one, finishing removes it, and it brings a hidden checklist window back.
- Not a contribution for the lurker rule.

### 10.4 Picks: tried it (added 2026-11-08)

The pick window changes on its own every 60 s (and on Another, which restarts the minute); it holds
still while the pointer is over it, a remark is being written, a dialog is open or the tab is hidden,
and skips the last 5 seen. Members who tried a pick vote **good** (+1) or **not for me** (-1) in
`suggestion_votes` (one per member per pick, changeable, not on your own) with an optional remark of up
to 200 characters. Rotation is weighted: score = 1 + (up - down)/4 clamped to [1/4, 4], drawn with
`-ln(random)/score`, so nothing disappears. The window shows the tally and the newest remark; **All
remarks** lists everyone's vote and remark (profiles too). The suggester is notified of remarks, not
votes. Admins remove remarks (the vote stays, the writer is told). The author removes their own
pick from the pick window ("Remove my pick", after a confirmation) or from the Picks tab of their
profile; admins see every pick under **Admin → Picks** and remove any of them, and the author is
told. Never a lurker contribution.

### 10.5 Collabs, interests, upgraded events (added 2026-11-08)

**Interests.** One shared list of tags (`interests`, 30 seeded). So nobody is left out, any member can
add a missing one (2–30 characters, 5 a day; the same name or tag returns the existing one); it joins
the list for everyone (`created_by`). Admins add tags and remove any (it comes off every profile,
collab and event); the Admin page lists the member-added ones, newest first. Members pick up to 10
(`user_interests`, Settings and the 6th checklist item); collabs carry 1–5, events up to 5. "People
who might fit" is always the overlap, best first.

**Collabs** are ongoing projects or activities members do together (a zine, a band, a cleanup).
Fields: title, description ≤ 2000, interests, "looking for" ≤ 5 roles, requirements ≤ 500, team size
2–20 (host included), optional cover, a price or donation note and an `https://` link (anti never
handles money). Status: recruiting → closed ("team set") → finished.

- The **team** (`collab_members`): one host, co-hosts (the host promotes them; they manage requests,
  invites and plain members), members. A leaving host hands over to the longest-standing co-host;
  with none, the collab stops recruiting. A member hosts at most 3 recruiting collabs.
- **Joining**: open = straight in; approve = a request with a note ≤ 300 (`collab_requests`, 10 a
  day per member). Declines never say who decided. **Invites** (`collab_invites`, ≤ 20 open) skip
  asking; managers see suggestions from shared interests and can invite any handle.
- **Collabs page**: "For you" (recruiting, sharing your interests, best match first) and "All", with an
  interest filter. Profiles have a Collabs tab.
- **Updates**: ordinary posts with `collab_id` (and `event_id` when "from a meetup"), up to 4 photos.
  The team starts them, anyone replies; replies inherit the link. They never appear in the main feed,
  and count toward the posting rule like any post or reply.
- **Meetups**: events with `collab_id`, planned by anyone on the team, **team only** (default; invisible
  to everyone else, even in lists and post links) or **anyone** (listed in Events). The team is told.
- **Finishing** (the first time) gives each team member a **draft** portfolio project (title, write-up,
  their part, "Team of N", how long it ran) unless their portfolio is full.
- **Reports**: like posts and projects; 5 open reports hide a collab from everyone but its team and
  admins until ops restore or remove it. Admins remove any collab; the host is told, not by whom.

**Events** gain the same tools: interests, requirements ("what to bring or know"), **who can come**
(anyone, or ask with a note and the host accepts: `event_requests`), **invites** with suggestions
(`event_invites`, ≤ 20 open; an invite skips asking; a team-only meetup only takes the team), and an
**updates** thread on the page (posts with `event_id`: the host and people going start them, for a
meetup the team; anyone replies). Accepted requests and invites go on the going list, or the waitlist
when full.

Notifications: `collab_request`, `collab_joined`, `collab_accepted`, `collab_declined`,
`collab_invite`, `collab_update`, `collab_meetup`, `collab_finished`, `collab_removed`,
`event_request`, `event_accepted`, `event_declined`, `event_invite`, `event_update`.

### 10.6 Consultations (added 2026-11-08)

Grilled with the owner (Q1–Q17, all accepted). A member books another member's time; the other
side accepts or declines, and decides per request whether it is free or paid. This is the one
deliberate exception to "no private messaging, no contact details": on acceptance the two people
see each other's contact (free text they typed) and take the conversation off the site, by mutual
choice, one pair at a time.

- **Who**: members only, and **18+ on both sides** (from the stored birthday; under-18s never see
  the menu item, the portfolio section, the "consults" tag or the endpoints: `consult_age`).
- **Money**: anti never handles it. Offers and acceptances carry a price note and, optionally, the
  consultant's own `https://` payment link (shown only to the requester once there is a price). No
  Stripe Connect, no ID checks, no refunds.
- **Offer** (`consult_offers`, opt-in): a switch, an optional description ≤ 500, a session length
  (30/45/60/90/120 min), Free or Paid (a starting point; price note required for Paid), and a
  private **contact** ≤ 300. Switching it on needs a contact. There are no topics (removed
  2026-11-09, owner's call): a member consults on what they are in life right now, which the
  portfolio already says; someone who reads it and is interested books. Pausing stops new
  requests; it is live only while active, not blocked by an admin, not hidden after reports, and
  its owner is a seated adult who is verified and approved (§10.18).
- **Request** (`consultations`): what you need help with ≤ 1000, when suits you ≤ 200, your
  contact ≤ 300. At most 3 open with the same consultant, 10 sent a day. States:
  `pending` → `accepted` (Paid: waits for the requester's **"I agree to pay this"**) → `revealed`
  → `done`; or `declined` (no reason given), `expired` (7 days unanswered, or 7 days without
  agreeing to a price), `closed` (either side: withdraw, "No thanks", call it off). Free acceptance
  reveals at once.
- **Contacts**: the consultant's contact is copied onto the request at the reveal; both are shown
  only while `revealed`/`done` and are hidden (and the copies wiped) when the request is closed, 14
  days after Done, or 60 days after the reveal, whichever comes first. Reads apply the time limits
  directly; the hourly `consultations` job expires requests (with notifications) and wipes copies.
- **Done and thanks**: either side marks Done. The requester may leave a public thank-you ≤ 300 (no
  stars or scores); the consultant can hide it. The portfolio shows "N sessions done".
- **Portfolio**: a **Consulting** section (length, usual price, description, sessions done,
  newest 3 thank-yous plus "All", **Book a consultation**). Member lists carry a "consults" tag and
  a filter (`GET /members?consults=1`). The menu has **Consultations** (Received / Sent / Your offer)
  with a badge for requests waiting on you.
- **Reports**: an offer like a project (5 reports hide it until ops decide; "remove" switches the
  member's consulting off: offer blocked, requests not yet under way closed, agreed sessions keep
  going). A request reaches the queue on one report (only two people see it). Admins see who
  consulted whom and when (`GET /ops/consultations`), but read what was asked and the contacts
  **only on a reported request** (`GET /ops/consultations/:id`). Admins can switch anyone's
  consulting off or back on from Members.
- **Bans and deletion**: `close_consultations_for()` (called by `ban_user` and `delete_account`)
  closes everything open, wipes every contact copy and switches the offer off (deleted: removed).
- Never a contribution for the lurker rule; no feed items.

Notifications: `consult_request`, `consult_accepted` (with pricing), `consult_declined`,
`consult_agreed`, `consult_expired`, `consult_done`, `consult_thanks`, `consult_closed`,
`consult_removed`, `consult_switched_off`, and `consult_reported` for admins. Push texts never
contain a contact.

### 10.7 The OG mark, the verified badge, contact details for admins (added 2026-11-08)

Grilled with the owner (Q1–Q18, all accepted, then narrowed on review: no address, encrypted,
every opening logged).

- **OG mark**: the "admin" tag is gone. Every admin (role `ops`) carries a small OG monogram (two
  interlocking rings) after their name, everywhere names show; hover: "Runs the room"; screen
  readers: "admin".
- **Verified badge**: a seal with a tick after the name (after the OG mark), on posts, profiles,
  lists, search, collab teams and event guests. Only an admin gives it (`verified_at`,
  `verified_by`), after checking the member however they like (usually through the contact details);
  Admin → Members has Verify / Remove verification and a "Not verified yet (N)" filter. Verifying
  notifies the member (`verified`); taking it back is silent. Admins are not verified
  automatically. The badge unlocks nothing; it is a mark of trust (§10.18 asks for it first, before
  an admin's separate yes). A verified member who later changes their contact details keeps the
  badge, and admins see "contact changed since verified". Taking it back also stops their consulting
  and wipes that approval (§10.18).
- **Contact details**: every member gives a **cell phone** (7–15 digits, optional leading +, country
  code encouraged) and an **email** (basic shape), as setup step 4. Members who finished setup
  before this are sent back to setup once; the rest is filled in and the birthday cannot change
  there. Only the member (Settings) and admins see them, never other members, the profile, lists,
  notifications or push. They are stored **encrypted** (AES-256-GCM, `contact_phone_enc` /
  `contact_email_enc`) with a key from the server environment (`CONTACT_KEY`), never in the
  database, so a copy of the database alone shows only ciphertext. Admins open them per member
  ("Show contact"); every opening is recorded (`contact_views`) and the recent openings show with
  them. Without `CONTACT_KEY` in production the feature is off (nothing is asked or stored). No
  address is collected. `delete_account` erases them and the badge.

### 10.8 Visitor passes (added 2026-11-08)

Grilled with the owner (Q1–Q20, all accepted). An admin gives someone who is not a member **one
hour of looking around**: everything members see, nothing they can do. For showing the place to a
friend, a collaborator, an agency, without spending an invite or a seat.

- **A visitor is not a user.** No row in `users`, no seat, no passkey, no setup. A pass is a row in
  `visitor_passes` (code hash, the admin's private label, who made it, `code_expires_at` a week
  out, `opened_at`/`expires_at` for the hour, `token_hash` for the browser, `revoked_at`) and an
  `anti_visitor` cookie. Member lists, seat counts, birthdays, lifecycle jobs and notifications
  never see them. They are purged 30 days after creation.
- **Code and link, both.** Admin → Visitor passes: an optional label ("Priya from the agency"), *Make
  a 1-hour pass*. The 8-symbol code (`K7QF-M2XP`, invite alphabet) and the link `/visit/<code>` are
  shown once, hashed in the database. The landing page has a "Have a visitor code?" field under the
  sign-in window; the link lands on `/visit/<code>` with the code filled in and one button, *Visit
  for an hour*. Entering is rate-limited per IP like `/invites/check`.
- **The hour starts on entry**, not on creation, and the pass **locks to that browser**: a second
  entry of the same code anywhere answers "This pass has already been used." An unopened code
  expires after seven days. No duration setting: an hour, always.
- **Reading like a member.** The auth plugin resolves the cookie into a stand-in seated user
  (nil UUID, handle `visitor`, an adult so 18+ consultation offers show), so every read handler
  works unchanged; `GET /me` returns that shape with `visitor.expiresAt`. Images and portfolios
  included. Closed even to read: `/me/*` (they have nothing there), notifications, consultations,
  payments, push; `/ops/*` is a 404 to them as to members.
- **Two walls against writing.** `app.ts` rejects every non-GET request carrying a visitor cookie
  and no member session with `403 visitor_readonly` before routing (except entering a code,
  leaving, signing in and joining); `requireUser` rejects the stand-in too, so a handler reached by
  mistake still refuses. The UI shows every control a member would see and strikes it out with
  "Visitors can only watch." (composer, likes, picks, RSVP, join, book, report). Members-only pages
  (settings, inbox, writing, editing, admin) bounce to the feed.
- **In the chrome**: where your face and handle go, a grey face and a "Visitor · 42 min left" pill
  (red under five minutes); the side rail has a *visitor* window with the time left and *Leave*. No
  Notifications, Settings or Admin in the menu. Members never see that a visitor is browsing.
- **The end.** When the hour is up or an admin ends the visit, the API answers `401 visitor_expired`
  and drops the cookie; the app lands on `/visit/ended` ("Your hour is up ... ask the person who sent
  you the pass"), and a client timer sends them there on the minute even if idle. A member always
  wins over a visitor cookie in the same browser (signing in drops it); a member entering a code is
  told no pass is needed and the code stays unused.
- **Admin list**: label, state (unopened / visiting with minutes left / over / expired / revoked),
  when and by whom, *Revoke* or *End the visit*. Only opened-at and ended-at are recorded: no IP,
  no user agent, no page log.

### 10.9 The UX pass (2026-11-09)

A critique of every screen (from the walkthrough screenshots) turned into five changes, built as
five commits. The rules it left behind, for anything added later:

- **Phones (under 900px) have a different shell** (`PhoneBar.tsx`). The menu column becomes a bell
  with the unread count in the sticky header (the clock is desktop-only) and five tabs along the
  bottom: Feed, Events, Collabs, Members, *you* (your face, with the unread badge). Drawers (your
  profile, Search, Consultations, Settings, Admin) open in a sheet from the fifth tab. A visitor
  gets a grey face with the minutes left instead. Settings and setup are standalone pages with no
  shell, and stay that way. The first screen is posts: the feed composer is one line until tapped
  or holding a draft, the checklist folds to a line with a count, the pick window waits until after
  the third post, and a visitor sees one notice strip where a member sees the composer.
- **Type.** The bitmap face (`--font-ui`) is for chrome only: window titles, tabs, buttons, menus,
  form labels, tags. Anything a reader has to parse (handles, times, counts, places, meta lines) is
  set in the reading face via `.meta` (0.9rem, `--gray-strong`). New meta text uses `.meta`, never
  `.ui`.
- **Dates.** `relativeTime` within a week ("5m", "3h", "2d"), then "Thu, Nov 5" (year only when
  it is not this year). `fmtDate` for exact moments drops the current year. Event cards say the
  weekday and time, since the date chip already says the day; event detail keeps the full date.
- **Zeros are invitations.** "Reply", not "0 replies"; "Like" with no count; "Be the first to go";
  no "0 up · 0 down"; "none yet"; a portfolio with no posts says nothing about posts.
- **One primary action per screen.** Rarer and destructive actions go in the "⋯" menu
  (`ActionMenu.tsx`): a collab shows Join/Ask or Edit plus a menu; an event shows Edit plus a menu;
  an admin member row shows Verify (when due), Unban, Show contact plus a menu, and filter chips.
  A host sees what waits on them (requests, inviting) in a line under the collab title.
- **Liveness.** The feed polls for new posts on the unread-count rhythm (30 s while visible, and on
  focus) and holds them behind a "3 new posts" pill. The members page has a search and chips (new
  this month, offers consultations, each interest somebody has).
- **Onboarding.** The three house rules close the setup page, and the welcome window is marked
  seen when setup is done (it still shows once for members from before). The About box carries
  three questions and talks in sentences, not word counts, until the minimum is near. The landing
  tells a stranger how an invite is obtained and makes both alert buttons answer the question.
  Settings has a row of section links that stays under the header on wide screens.

`scripts/screenshots-phone.ts` walks the phone shell, the pill and the member filters.

**The desktop pass (same day, later).** A second critique, of the wide screens, added:

- **The feed opens on posts here too.** The checklist is one line on every screen: the title, the
  next thing to do (a link), the count and "Show all".
- **The menu column is only the menu.** Rows are tighter; your drawers (Notifications, Settings,
  Admin) are a smaller group under a double rule; under it, "? Keyboard shortcuts". It fits a
  1366×768 laptop without scrolling (it still has its own scroll if it ever does not). The pick
  window lives in the right column, which opens with the next events (the "you" window is gone:
  your profile is in the menu). Under 1180px there is no right column, so the pick window and the
  birthday line sit in the feed, as on phones.
- **The side windows scroll on their own** (owner's call, 2026-11-09). The right column is never
  taller than the screen: it scrolls under the header, like the menu, so a short laptop window can
  still reach the last window instead of losing it below the fold. The scroll does not carry on
  into the feed.
- **No window repeats its page:** no next-events window on Events, no seats window on Members, and
  a visitor's time left is in the side window only (the menu pill shows where there is no rail).
- **No empty boxes.** The portfolio's About/Skills | Experience/Education box is one column when
  either half would be empty.
- **A greyed-out control says why.** `why(reason)` in `Visitor.tsx` sets `data-why`, shown as a
  black slip on hover or keyboard focus (CSS) and read out via `aria-description`; native `title`
  tooltips were slow and do not show on disabled buttons everywhere.
- **Keyboard** (`Shortcuts.tsx`): N write a post, / search (the page's own search box when it has
  one), J/K next and previous post, Enter open it, Esc leave a text box, ? the list. Ignored while
  typing, with modifiers, or while a dialog is open.

`scripts/screenshots-desktop.ts` checks each of these at laptop sizes.

### 10.10 Screen time (added 2026-11-09)

The site would rather you went outside, so it says so and then shows you the door. Grilled Q1–Q9,
all accepted.

- **The cycle.** A member gets 30 minutes of looking, then is locked out for 60, then a fresh 30.
  Only time with the tab in front counts: the page ticks while visible and sends a heartbeat with
  the seconds since the last one every 30 s and when the tab goes to the background. An hour away
  also opens a fresh half hour, so a quiet member never carries yesterday's minutes.
- **Kept on the server**, one row per member (`screen_time`: `used_s`, `window_started_at`,
  `locked_until`), so the half hour follows the person across tabs and devices and survives a
  refresh. `GET /me/screen-time` reads it (and settles a spent rest); `POST /me/screen-time/beat
  {seconds}` adds at most a minute per call and locks the member out when the limit is reached.
- **The wall.** While locked, the auth plugin answers every request with `403 rest_time` (detail:
  when it ends) except `/me`, `/me/screen-time*`, `/auth/logout` and `/health`. The lock is read
  with the session (one left join), so it costs no extra query.
- **In the app.** A timer centred in the header, pixel font in a bordered box, counting up and red
  in the last five minutes; alert windows at 10, 20 and 25 minutes (once each per half hour,
  remembered on the device by the window's start), one button each; at 30 the lock window replaces
  every page with a countdown and *Sign out*, and clears itself when the hour is up.
- **The switch.** Off by default (`settings.screen_time` = 0). An admin turns it on or off for
  everyone from Admin → Community (`PATCH /ops/settings {screenTime: 0|1}`). While off, nothing
  shows and heartbeats count nothing; switching it off deletes every `screen_time` row, so everyone
  is let in at once and nobody carries old minutes into the next switch-on.
- **Who.** Everyone with a seat. Admins see the timer and the nudges but are never locked out:
  their count runs on past the half hour (`exempt` in the state) and the wall ignores them.
  Visitors are excluded: their hour is the pass. Settings and setup are outside the shell;
  Settings carries the timer too, setup does not.
- Constants in `RULES` (`screen_time_limit_s`, `screen_time_rest_s`, `screen_time_nudges_s`); the
  nudge texts live in `ScreenTime.tsx`. `scripts/screenshots-screen-time.ts` walks it.

### 10.11 The feed: newest first, with an end (added 2026-11-09)

Built from a read of how big platforms and small community sites order their feeds, and what
users and builders say about it. The feed is **not ranked**: no
score, no likes or replies moving a post, nothing learned from what anyone looks at. At a hundred
seats every post can be read; the real problems are the frequent poster who drowns out the rest,
not knowing where you left off, and a newcomer posting into silence. The fixes are display rules on
top of `(created_at desc, id desc)`, each one written on `/feed-rules`:

- **Likes are the author's alone.** `likeCount` is a number only on your own posts, `null` on
  everyone else's (feed, threads, the like endpoints). Likes never change position. (The
  MusicLab result: visible counts make popularity snowball.)
- **"new here" and "First post".** Posts by members in their first `new_member_exempt_days` (21)
  carry "new here" by the name; a member's first root post outside collabs and events wears a
  "First post" badge and its reply button reads "Say hello". The inviter gets
  `invitee_first_post` (once per member, ever; not for replies or updates).
- **The line.** A visit starts when the feed opens after `FEED.visitGapMinutes` (30) with no feed
  activity in that tab (`sessionStorage`; a reload resumes it with `since=`). `GET /feed?visit=1`
  returns `visit {since, capped, newPosts, visitId, threads, events, nextEvent}`; `since` is
  `users.feed_seen_through`, never more than `FEED.newWindowDays` (7) back. The 30-second poll
  sends neither parameter and never starts a visit.
- **The end.** The feed loads on its own only until it reaches the line; there the end card says
  "You're caught up. That's everything since Tue 9:14 pm." (or "Nothing new…"), the next event,
  "Go outside.", and a *Show older posts* button; below the line only buttons load more. Once the
  card has been on screen, `POST /feed/caught-up {through, visitId}` moves `feed_seen_through` to
  the newest post in the list: clamped to now, forward only, closed to visitors.
- **The fold.** On one local day an author's posts after the first `FEED.foldAfter` (2) collapse
  into "3 more from Mina today", opened in place (`foldBusy` in `packages/shared/src/feed.ts`, pure
  and unit-tested). Never folded: your own posts, newcomers, anyone's first post.
- **Rows in time.** An older post (made up to 72 h before the line) that `FEED.threadMinRepliers`
  (2) other people replied to since the line gets one row, "Mina's post from Monday: 3 people
  replied since you were here", at the newest reply. Guards from the small sites that rank: the
  author's and your own replies don't count, nor replies more than 72 h after the post, and rows
  are counted from replies that still exist (reply-then-delete removes it). A new public event by
  someone else gets a row at the moment it was made. Rows only sit above the line; the post itself
  never moves.
- **The log.** `feed_visits` (user, since, new posts waiting, when the end card was reached) is
  the only behavioural data the feed keeps: the owner reads backlog sizes and how many visits reach
  the end. Pruned after 60 days by the daily cleanup, gone with the member. Visitors write nothing.
- **Not built:** a "By person" view (what you missed, grouped per member, quietest first). Build it
  only if the 90th-percentile backlog stays above 150 posts, or fewer than half of the visits with
  60+ new posts reach the end before a screen-time lock, or five members ask for it. Never an A/B
  test; time on site and sessions are never objectives.

The landing page keeps "no algorithm"; its rule now reads "One feed, newest first. Likes never move
a post. A line shows where you left off, and you will reach the end of it." Tests:
`apps/api/test/feed.test.ts`, `apps/api/test/fold.test.ts`; screenshots:
`scripts/screenshots-feed.ts`.

### 10.12 Posts and replies look different (added 2026-11-09)

The owner found posts and replies hard to tell apart: both were the same card. Decided with the
owner, six points, all as proposed:

- **Everywhere replies show**: the thread page, a member's profile list and search (the feed
  itself shows posts only).
- **The thread's post is heavier**: a framed card with a shadow, larger text and a "Post" label
  (`PostCard variant="lead"`).
- **Replies are lighter**: a 36px face (30px on phones) instead of 52, smaller text, dashed
  dividers, and they hang off one line on the left joined to the post by a short tick
  (`variant="reply"`, `.thread-replies`).
- **Flat, one level.** A reply to a reply stays in the same list with "replying to @x"; no deeper
  nesting (it breaks on phones, and threads here are short).
- **In lists, a reply says what it answers**: "↳ Replied to Mina's post: 'Anyone up for a hike…'",
  linking into the thread, drawn in the same small style. The API adds `replyTo {rootId, author,
  snippet}` to every reply (the snippet is empty when the post was deleted or hidden).
- `scripts/screenshots-replies.ts` shoots the same scene before (`SHOTS=before`) and after.

### 10.13 Signing in with a handle and a PIN (added 2026-11-09)

Members found passkeys hectic, so the way in is now the invite code once, then a handle and a
6-digit PIN. Decided with the owner, thirteen points, all as proposed:

- **Joining**: invite code → handle and display name → a PIN typed twice → the recovery code,
  shown once ("I saved it") → setup. `POST /auth/join {code, handle, displayName, pin}`; no
  passkey step. (`/auth/register/options|verify` stay for older clients and tests.)
- **Signing in**: `POST /auth/pin/login {handle, pin}` (handle case-insensitive, `@` allowed). A
  wrong PIN and an unknown handle get the same `401 pin_invalid`. Banned: `account_unavailable`,
  only after the right PIN. Sessions stay 7 days.
- **Guessing**: 5 wrong in a row → the account rests 15 minutes (`423 pin_resting`, detail = the
  time), doubling with each further rest until a right PIN; 10 wrong in a day → `423 pin_blocked`
  until a recovery code or an admin's code. The count is per account, under a row lock; on top,
  `pinGuess` allows 60 tries per IP per hour. The member is told (`pin_locked`, `pin_blocked`).
  PINs are argon2id hashes; `pinProblem` (packages/shared) refuses one digit six times, straight
  runs, repeated pairs or triples, and the member's birthday as six digits.
- **Forgot your PIN**: `POST /auth/pin/reset {handle, code, pin}` with the recovery code (also
  removes passkeys, signs out everywhere, returns a new recovery code) or an admin's reset code
  (one hour, one use, unlocks, signs out everywhere). Admin → Members → *Reset PIN*
  (`POST /ops/users/:handle/pin-reset`): never for yourself; a new code retires the older one;
  the member is told (`pin_reset_code`); `pin_resets` is the log of who reset whom.
- **Changing it**: Settings → PIN, `PUT /me/pin {pin, currentPin}`; every other device is signed out.
- **Passkeys are an extra**: under Settings, optional; with a PIN the last one can be removed.
  "Use a passkey" stays on the sign-in page.
- **Existing members** (joined with a passkey, `pinSet: false` on `/me`): the next passkey
  sign-in, and every page until then, asks them to choose a PIN first. Admins sign in the same way.
- Constants: `PIN_LENGTH`, `PIN_RULES` in `packages/shared/src/pin.ts`. Tests:
  `apps/api/test/pin.test.ts`; screenshots: `scripts/screenshots-pin.ts`.

### 10.14 Dark mode, by choice (added 2026-11-09)

Some members want a dark page; Anti stays a white-paper site for everyone else. Decided with the
owner, four points, all as proposed:

- **Light by default, whatever the device says.** Settings → Appearance: Light or Dark, applied at
  once, no "match my device" option (`prefers-color-scheme` is never read).
- **Saved on the account** (`users.theme`, `PATCH /me {theme}`), so it follows the member to every
  device, and copied into an `anti_theme` cookie: the root layout reads it (with the session
  cookie) and renders `<html data-theme="dark">`, so a dark page never flashes white.
- **Signed out and visitors: always light**, cookie or not.
- **Portfolios keep their own look**: a "paper" portfolio stays white inside a dark page, "ink"
  stays black; the menu, side windows and posts follow the viewer.
- The theme is one block, `:root[data-theme="dark"]` in `globals.css` (every colour is a
  variable). Tests: `apps/api/test/theme.test.ts`; screenshots: `scripts/screenshots-theme.ts`.

### 10.15 Every post its own card, shaped by what it is (added 2026-11-09)

The owner found the feed ran together: a status right under a photo read like its caption or a
reply to it. Decided with the owner, seven points, all as proposed:

- **Framed cards**: each post is its own box (2px ink border, small offset shadow) with a clear
  gap before the next, the same window look as the rest of the site (`PostCard framed`,
  `.posts.cards`).
- **The shape tells what it is, no labels** (`postShape` in `packages/shared/src/feed.ts`):
  - *photo* (any image): the picture runs the card's full width, the words under it as a caption;
  - *short* (at most `FEED.shortMaxChars` 140 characters on at most 3 lines, no image): set large, as a note;
  - *text*: normal size, folded after `FEED.clampLines` (6) lines with "Read more", which opens
    it in place (shown only when the fold actually hides something at that width).
- **Reply and Like sit in a strip** across the bottom of the card, so the actions close the post.
- **Where**: the feed and a member's profile list. The thread page keeps §10.12; search, event
  and collab update lists stay compact.
- **Phones**: the same framed card with the page's small inset each side.
- Tests: `apps/api/test/post-shape.test.ts`; screenshots: `scripts/screenshots-feed-types.ts`
  (`SHOTS=before` for the old look).

### 10.16 Mentions: type @, no button (added 2026-11-09)

Decided with the owner, all as proposed:

- **Typing @ is the trigger.** In every post box (feed composer, replies, collab and event
  updates) an unfinished `@word` opens a list of up to 8 seated members under the box: handle
  prefix first, then display name, each row a drawn face, the name and `@handle`. ↑/↓ moves,
  Enter or Tab picks, Esc closes, clicking a row picks it. **There is no mention button.**
- **The body stays plain text.** `@handle` is written as typed; the members it really names are
  stored in `post_mentions` (post_id, user_id) when the post is saved. Links therefore survive a
  handle change, and an edit can diff old against new.
- **Only real mentions become links.** The post carries the handles back; only those render as a
  link to `/u/<handle>`. An unknown @word, or an @ inside an email or URL, stays plain text.
- **One notification per person per post** (`kind = 'mention'`, in-app and Web Push): "@theo
  mentioned you". Replying to someone and also mentioning them sends only the reply notice.
  Mentioning yourself does nothing.
- **Edits** notify only people newly added in the 15-minute window; removing a mention drops the
  link and sends nothing.
- **Limits:** seated members only (`active`, `flagged_lurker`), case-insensitive, at most 10 per
  post. A mention is not a contribution for the lurker rule.
- **The picker's list** comes from `GET /members/mention?q=` (members-only, 8 rows).
- Tests: `apps/api/test/mentions.test.ts`; screenshots: `scripts/screenshots-latest.ts`
  (`15-mention-list`) and `.screenshots/mentions/`.

### 10.17 Pet Corner: pets as sub-accounts (added 2026-11-09)

The right-hand seats window becomes **Pet Corner**: a live feed of the room's pets. Decided with
the owner, every answer as proposed:

- **A pet is a content identity, not an account.** It has no seat, no PIN and cannot sign in; it
  belongs to one member, up to **3 pets each**, and posts as itself.
- **Add Pet** sits at the right end of your own profile's cover banner, opposite your face, name
  and headline (only you see it). It opens a window: name, species (**Dog**, **Cat** or **Bird**),
  and an optional photo.
- **Default looks are drawn in code**: endless per species — any variant number draws a new face,
  seeded from it and the species, in the same hand-drawn 1-bit ink as member faces. A pet keeps
  its look; an uploaded photo replaces it.
- **Each pet has `/pet/<id>`**: a small header (avatar, name, species, "pet of @owner") and its
  posts. The owner also sees Edit and Delete there.
- **Posting as a pet happens on the pet's page**, where the composer says "Posting as Max"; the
  main feed composer stays the member's. A pet post carries one label — **Everyday**, **Advice**,
  **Health** or **Help** — and at most **one picture** (1500 characters, 15-minute edit).
- **Pet Corner** shows the newest pet posts: on wide screens in the right rail (where the seats
  window was), and below 1180px on its own **`/pets`** page. Each card shows the pet's avatar, its
  name, "pet of @owner", the label, the words and any picture. On phones the feed also gets **one
  Pet Corner stop**: one random pet post between the 4th and 10th post, once per visit, the way the
  pick window sits after the third; its heading opens `/pets` and its card opens the pet's page.
- **Others can like, reply and report** a pet post. Replies stay inside Pet Corner; five reports
  hide a pet post like any other; the **owner is notified in their own inbox** for replies and
  likes. A pet post is **never a lurker contribution**. Admins get **Remove (admin)** on any pet
  post (the owner is told), as on any other post.
- **Deleting a pet** removes the pet and all its posts, images and replies, after a confirmation
  that says how many posts will go.
- **The seats window only disappears from the rail.** The seat chart and count stay on the
  Members page and in Admin.
- The owner's profile gains a small row of their pets (avatars linking to each pet page). Pet
  posts do not offer @mentions: mentions name members, not pets.

### 10.18 Consulting needs the badge, then an admin's yes (added 2026-11-10)

Grilled with the owner (three rounds, every answer as proposed). Offering consulting used to be one
switch. Now it takes two things first: the **verified badge** (§10.7), and after that **one admin's
approval**. Both are given once.

- **The gate**: switching an offer on needs the badge (`consult_unverified`). With the badge, the
  first switch-on **saves the offer and puts the member in the admin's queue** — the offer is so
  stored (the details typed while waiting are kept) but not live, so nobody can book and no
  "consults" tag appears. Only when an admin says yes does it go live, at once if it is already
  switched on.
- **Approved once, in `users`**: `consult_approved_at` / `consult_approved_by`, with
  `consult_requested_at` (waiting) and `consult_declined_at` (said no). Pausing and resuming after a
  yes asks nobody again; switching off while waiting takes the request back. An offer is live only
  while all of §10.6's conditions hold **and** the owner is verified and approved.
- **Declined**: the offer is switched off, the member is told, no reason is given (as with a
  declined request), and they cannot ask again — only an admin can change it, from the queue or
  Members. It adds nothing to the profile: only admins see it, as "not approved".
- **A member who is not verified** still sees Consultations and **Your offer**, but the form is one
  plain line in place of the fields: the badge comes first, ask an admin. They keep the form while
  they are verified but waiting, so they can tidy the details.
- **Losing the badge** (§10.7, Remove verification) stops consulting and **wipes the approval**: the
  offer goes off, and giving the badge back does not make them bookable without a fresh decision.
  The same happens on a ban or deletion, which already close everything (§10.6).
- **Requests already under way carry on** when approval or the badge goes: only new bookings stop.
- **Admin → Consulting** lists everyone waiting, oldest first, with name, badge, description, session
  length, Free or Paid and whether their offer is switched on, and **Approve** / **Not now**. The
  same two actions are in the Members row menu, and Members has a "Consulting (N)" filter chip and
  says "waiting for approval" / "not approved" beside the person. Admins get no new role: `/ops/*`
  is unchanged, and `requireOps` still 404s to members.
- **Offers that were already live** when this shipped were paused into the queue by the migration
  (`0031_consult_approval.sql`): every active offer whose owner has no approval is now waiting, so
  the rule is true from the first minute. Nothing was deleted; each one goes live again on approval.

Notifications: `consult_asked` (to every admin, once per member, not once per save),
`consult_approved` and `consult_not_approved` (to the member). Push texts carry neither a contact nor
a reason.

### 10.19 The Bangla font stays, its credit line goes (added 2026-11-10)

The owner asked for two things at once: the font stays, the credit line at the foot of the landing
page goes. Only the credit was removed; nothing about the font changed.

- **The font is unchanged.** Golesta Borno still draws every Bangla character, from
  `apps/web/app/fonts/golesta-borno/` (regular and italic, `unicode-range` limited to Bengali, so it
  only downloads on pages that have Bangla). Do not swap it out or re-upload the files elsewhere.
- **The credit line is gone**: the `Web font: lipighor.com` footer on the landing page
  (`apps/web/app/page.tsx`), its `.landing-foot` rule and the `foot` grid area it occupied
  (`apps/web/app/globals.css`). The landing page therefore ends at the three house rules. **Do not
  bring it back unless the owner asks.** The licence file (`LICENSE-Readme.txt`) still ships beside
  the font and is the only place the name remains; that file is not to be edited or removed.
- **The screenshot script no longer looks for the link**: `scripts/screenshots-bangla.ts` dropped its
  "landing backlink ok" step. Its remaining job is unchanged: prove the Bangla is drawn in Golesta
  Borno and the English around it is not, using Chrome's own font report.
- The owner asked that this change carry no screenshots.

## 11. API surface (Elysia)

Guards: **P** public, **U** any signed-in non-banned user, **A** active/flagged_lurker, **O** ops,
**V** a visitor (§10.8) may read it too (every **A** GET unless listed as closed in §10.8).

| Method & path | Guard | Purpose |
|---|---|---|
| `POST /invites/check` | P | Validate a code |
| `POST /auth/register/options` | P | WebAuthn registration options (requires valid invite code + handle) |
| `POST /auth/register/verify` | P | Verify, create user + passkey, `redeem_invite`, return recovery code once, start session |
| `POST /auth/login/options` | P | Discoverable login options |
| `POST /auth/login/verify` | P | Verify, start session |
| `POST /auth/recover/options` / `verify` | P | Recovery-code flow; rotates code |
| `POST /auth/join` | P | Join with an invite and a 6-digit PIN (§10.13); returns the recovery code once |
| `POST /auth/pin/login` | P (rate-limited) | Handle + PIN; rests and locks per §10.13 |
| `POST /auth/pin/reset` | P (rate-limited) | Recovery code or admin's reset code + new PIN |
| `PUT /me/pin` | U | Choose or change the PIN (current PIN needed once one is set) |
| `POST /ops/users/:handle/pin-reset` | O | One-hour PIN reset code for a member (not yourself; logged) |
| `POST /auth/logout` | U | End session |
| `GET /me` | U | Profile, state, waitlist position / offer, lurker countdown, `setupNeeded`, gender, own birthday |
| `GET/PUT /me/setup` | U | Setup: About you, gender, birthday (under 13 + `confirmUnderage`: account closed) |
| `GET /me/checklist`, `POST /me/checklist/dismiss` | A | "Finish your profile" items, and closing it |
| `GET/POST/DELETE /me/passkeys` | U | Manage passkeys |
| `PATCH /me` | U | Display name, bio, gender, "show my birthday" |
| `DELETE /me` | U | Self-deletion |
| `GET/POST /me/invites` | A | List / create (≤ 2 open, no penalty) |
| `POST /me/waitlist/rejoin` | U (archived) | Join priority queue |
| `GET /feed` | A | Global feed, newest first; `visit=1` / `since=` on the first page add the visit (§10.11) |
| `POST /feed/caught-up` | A (not V) | The end card was seen: move the "new since" line forward (§10.11) |
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
| `POST/DELETE /events/:id/rsvp` | A | RSVP (approve events: only accepted or invited people) |
| `POST/DELETE /events/:id/request`, `POST /events/:id/requests/:handle/accept\|decline` | A / host | Ask to come; the host decides |
| `GET /events/:id/suggestions`, `POST /events/:id/invites`, `POST /events/:id/invite/decline` | host / A | People who might fit; invites |
| `GET /events/:id/updates` | A | The event's updates (post with `POST /posts { eventId }`) |
| `GET/POST /interests`, `PUT /me/interests` | A | The tag list; add a missing one; your picks |
| `GET/POST /ops/interests`, `DELETE /ops/interests/:slug` | O | Who added what; add; remove everywhere |
| `GET/POST /collabs`, `GET/PATCH/DELETE /collabs/:id` | A | Collabs (`?tab=for-you\|all&interest=`) |
| `POST /collabs/:id/join`, `DELETE /collabs/:id/request`, `POST /collabs/:id/requests/:handle/accept\|decline` | A / managers | Join or ask; decide |
| `GET /collabs/:id/suggestions`, `POST /collabs/:id/invites`, `POST /collabs/:id/invite/accept\|decline` | managers / A | Invites |
| `POST /collabs/:id/leave`, `POST /collabs/:id/members/:handle/role`, `DELETE /collabs/:id/members/:handle` | A / host, managers | The team |
| `GET /collabs/:id/updates`, `GET /members/:handle/collabs` | A | Updates (post with `POST /posts { collabId }`); a member's collabs |
| `POST /collabs/:id/flag`, `POST /ops/collabs/:id/resolve`, `POST /ops/collabs/:id/remove` | A / O | Report; ops restore or remove |
| `GET/PUT /me/consult-offer`, `GET /members/:handle/consult-offer`, `GET /members/:handle/consult-thanks` | A, 18+ | Consultation offer (§10.6) |
| `POST /members/:handle/consultations`, `GET /consultations?box=received\|sent`, `GET /consultations/waiting`, `GET /consultations/:id` | A, 18+ | Requests |
| `POST /consultations/:id/accept\|decline\|agree\|close\|done`, `PUT /consultations/:id/thanks`, `POST /consultations/:id/thanks/hidden` | A, 18+ (the two people) | The request's steps |
| `POST /consultations/:id/flag`, `POST /members/:handle/consult-offer/flag` | A, 18+ | Reports |
| `GET /ops/consultations[/:id]`, `POST /ops/consultations/:id/resolve`, `POST /ops/consult-offers/:handle/resolve`, `POST /ops/users/:handle/consulting` | O | Who consulted whom; reported requests in full; switch consulting off/on |
| `GET /ops/consult-asks`, `POST /ops/users/:handle/consult-approval` | O | Who is waiting for consulting approval; approve or decline it (§10.18) |
| `POST /events/:id/attendance` | A (host) | Confirm attendees |
| `GET /notifications`, `POST /notifications/read` | U | In-app inbox |
| `POST/DELETE /push/subscriptions` | U | Web Push |
| `POST /payments/checkout` | U | Stripe Checkout session |
| `POST /webhooks/stripe` | P (signed) | Stripe webhook |
| `GET /seats` | A | Seat cap and seats in use (the cap is a setting admins change) |
| `POST /ops/invites` | O | Mint founder invites |
| `GET /ops/flags`, `POST /ops/flags/:postId/resolve` | O | Moderation queue |
| `POST /ops/posts/:id/remove`, `POST /ops/projects/:id/remove` | O | Remove any post / project; author told |
| `GET /ops/members` | O | Everyone but deleted accounts, with state and role |
| `PUT /me/contact` | U | Your phone and email (§10.7; only admins see them) |
| `POST /ops/users/:handle/verify`, `GET /ops/users/:handle/contact` | O | Give or take back the verified badge; open contact details (logged) |
| `POST /ops/users/:handle/ban`, `/unban` | O | Ban / lift a ban |
| `POST /ops/users/:handle/role` | O | Make or remove an admin (never the last one) |
| `POST /ops/users/:handle/handle` | O | Change a handle (signup rules; member told) |
| `POST /ops/users/:handle/birthday` | O | Correct a birthday (under 13 + `confirmUnderage`: account closed) |
| `GET/PATCH /ops/settings` | O | Seat cap, open invites per member, invite expiry |
| `POST /visit`, `POST /visit/leave` | P (rate-limited) | Enter a visitor code (§10.8): the hour starts, cookie set; leave early |
| `GET/POST /ops/visitor-passes`, `POST /ops/visitor-passes/:id/revoke` | O | Visitor passes: list with states, make one (code shown once), revoke or end a visit |

To members, every `/ops/*` path is a 404. Ops also has a CLI (`bun run ops:mint-invites --count 10`, `bun run ops -- grant <handle>`) that calls the same service code; on hosts without a shell, `BOOTSTRAP_INVITES` and `OPS_HANDLES` do the first-boot equivalents (`OPS_HANDLES` only while no admin exists).

## 12. Scheduled jobs

| Job | Frequency | What |
|---|---|---|
| `run_lifecycle()` | Hourly | Archival, lurker detection/resolution/grace, waitlist decay, promotion (§8.2) |
| Session + challenge cleanup | Daily | Delete expired `sessions`, `auth_challenges`; `visitor_passes` older than 30 days (§10.8); `feed_visits` older than 60 days (§10.11) |
| Upload quarantine sweep | Daily | Delete orphaned R2 quarantine objects > 24 h |
| Notification fan-out | On insert (in-process queue) | Send Web Push for push-worthy kinds |

Runner: `@elysiajs/cron` in the API; each tick does `select pg_try_advisory_lock(<job id>)` and skips if not acquired, so multiple API instances are safe.

## 13. Security, abuse, privacy

- **Invite codes**: 60+ bits of entropy, rate-limited checks (10/min/IP) to prevent enumeration. Stored as SHA-256 hash; the plaintext is shown only to the creator.
- **WebAuthn**: RP ID = production domain; origin checked; signature counter checked; challenge single-use.
- **Sessions**: hashed tokens; revoke-all on recovery and ban; CSRF mitigated by `SameSite=Lax` + Origin check on mutating requests.
- **Rate limits** (per user, Postgres- or memory-backed): posts 20/h, likes 300/h, flags 30/day, join requests (collabs and events) 10/day, invites per §3, auth endpoints per IP.
- **Content**: body length CHECK in DB; images re-encoded server-side (removes EXIF/GPS and polyglot payloads).
- **Privacy**: no real name collected. A cell phone and an email are required since §10.7, seen only by the member and admins, stored encrypted with a key outside the database, every admin opening logged, erased with the account; nothing else asks for them (sign-in is a handle and a PIN, §10.13). IP addresses not persisted beyond rate-limit windows. Event location can be RSVP-only.
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
8. **M8 — Admins** (2026-11-08, §10.2): the Admin page (invites, reports, members with ban/unban/admin/handle, community settings), removing any post or project, admin tag and activity-rule exemption.
9. **M9 — Setup** (2026-11-08, §10.3): the compulsory setup page and the setup gate; faces drawn by gender everywhere; birthdays (tags, side window, admin ages and corrections); the "Finish your profile" checklist.
10. **M10 — Collabs** (2026-11-08, §10.5), in four steps: interests; collabs with joining, requests and invites; updates, meetups and finishing into portfolio drafts; upgraded events and collab reports.
11. **M11 — Trust** (2026-11-08, §10.7): the OG mark for admins, the verified badge, contact details for admins (encrypted, openings logged).
12. **M12 — Visitor passes** (2026-11-08, §10.8), in four steps: the table, SQL and API with the read-only walls; the visitor's side of the app (code form, pass page, pill, struck-out controls, ended page); the admin panel; docs and screenshots.
13. **M13 — The feed** (2026-11-09, §10.11), in three steps: like counts for the author only, "new here", "First post" and the inviter's notice; the "new since" line, the end card and the visit log; the fold, conversation and event rows, and `/feed-rules`.
14. **M14 — Posts and replies** (2026-11-09, §10.12): the thread's post framed and labelled, replies small on a thread line, replies in lists saying what they answer.
15. **M15 — PIN sign-in** (2026-11-09, §10.13): joining and signing in with a handle and a 6-digit PIN, rests and locks, recovery and admin reset codes, passkeys optional.
16. **M16 — Dark mode** (2026-11-09, §10.14): Settings → Appearance, light by default whatever the device says, saved on the account, no white flash.

## Appendix A — Decision log

| # | Decision |
|---|---|
| Q1 | Separate Elysia API + Next.js client from day one (Eden Treaty). |
| Q2 | ~~Passkey-only~~ (2026-11-09: handle + 6-digit PIN, §10.13; passkeys optional); one-time recovery code. |
| Q3 | ≤ 2 open invites per active member, 7-day expiry; invite tree recorded. |
| Q4 | Cap full → FIFO waitlist. |
| Q5 | Activity = any authenticated request, `last_seen` once/day; 7-day sessions. |
| Q6 | Contribution = post/reply/host/attend; lurker = ≥ 8 seen days & < 2 contributions in 30 days. |
| Q7 | Archived content stays visible; profile badged; seat freed. |
| Q8 | Stripe Checkout; store customer ID only. |
| Q9 | v1 events free; external payment link only. |
| Q10 | Single global chronological feed; posts, public replies, likes, images. No follows/reposts. |
| Q11 | 5 flags hide a post pending ops review; ~~ops is backend-only~~ (2026-11-08: admins get an Admin page, §10.2). |
| Q12 | Drizzle + PL/pgSQL for seat/state transitions. |
| Q13 | Immutable handle (for members; 2026-11-08: admins can change any handle, §10.2), editable display name/bio. |
| Q14 | State machine: waitlisted → active ↔ flagged_lurker → archived; banned; append-only event log. |
| Q15 | The profile is a portfolio: one window, Behance layout inside the retro frame; members only; every field optional, no real name. |
| Q16 | Portfolio look from a fixed set (3 typefaces, 2 backgrounds, 6 accents); background fixed, not following dark mode. |
| Q17 | Projects: ≤ 12, ≤ 10 images, per-project draft; reportable like posts, owner keeps seeing a hidden one; edits never count toward the lurker rule. |
| S1–S18 | (2026-11-08, §10.3) Compulsory setup after joining, for everyone: About you 50–300 words (= portfolio About), gender of four (face only, never text, changeable), birthday (13+, members can't change it, admins can; only month/day shown, opt-out tag, each viewer's date); non-blocking "Finish your profile" checklist after the welcome. |
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
