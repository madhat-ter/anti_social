import {
  pgTable, pgEnum, uuid, text, timestamp, integer, boolean, date, primaryKey, index,
  uniqueIndex, jsonb, bigint, customType, check, type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
const bytea = customType<{ data: Uint8Array }>({ dataType: () => 'bytea' });
const tstz = (name: string) => timestamp(name, { withTimezone: true });

// ─── Users & lifecycle ──────────────────────────────────────────────────────

export const userState = pgEnum('user_state', [
  'waitlisted', 'active', 'flagged_lurker', 'archived', 'banned', 'deleted',
]);
export const userRole = pgEnum('user_role', ['member', 'ops']);
/** Shapes the drawn face only; never shown as text (RFC §10.3). Mirrors GENDERS in @anti/shared. */
export const gender = pgEnum('gender', ['woman', 'man', 'nonbinary', 'undisclosed']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  handle: text('handle').notNull(),
  displayName: text('display_name').notNull(),
  bio: text('bio').notNull().default(''),
  avatarKey: text('avatar_key'),
  role: userRole('role').notNull().default('member'),
  state: userState('state').notNull(),
  invitedBy: uuid('invited_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  recoveryCodeHash: text('recovery_code_hash').notNull(),
  activatedAt: tstz('activated_at'),
  lastSeenAt: tstz('last_seen_at'),
  lastSeenOn: date('last_seen_on'),
  lurkerFlaggedAt: tstz('lurker_flagged_at'),
  lurkerExemptUntil: tstz('lurker_exempt_until'),
  invitePenaltyUntil: tstz('invite_penalty_until'),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  // ── setup (RFC §10.3): filled in once after joining; until then the site is locked
  gender: gender('gender'),
  /** YYYY-MM-DD; members can't change it, admins can. Only month/day are ever shown, and only if public. */
  birthday: date('birthday'),
  birthdayPublic: boolean('birthday_public').notNull().default(true),
  setupDoneAt: tstz('setup_done_at'),
  /** the "Finish your profile" checklist was closed */
  checklistDismissedAt: tstz('checklist_dismissed_at'),
  // ── RFC §10.7: contact details only admins see, encrypted (AES-256-GCM, key CONTACT_KEY)
  contactPhoneEnc: text('contact_phone_enc'),
  contactEmailEnc: text('contact_email_enc'),
  contactUpdatedAt: tstz('contact_updated_at'),
  /** verified by an admin who checked the member; the badge shows by their name */
  verifiedAt: tstz('verified_at'),
  verifiedBy: uuid('verified_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  /** RFC §10.11: the newest feed post this member scrolled past to the "caught up" card; only moves forward */
  feedSeenThrough: tstz('feed_seen_through'),
  // ── RFC §10.13: signing in with a handle and a 6-digit PIN (argon2id hash; null until chosen)
  pinHash: text('pin_hash'),
  /** wrong PINs in a row since the last lock or success */
  pinFails: integer('pin_fails').notNull().default(0),
  /** locks since the last success: each one doubles the rest (15 min, 30, 60…) */
  pinLocks: integer('pin_locks').notNull().default(0),
  pinLockedUntil: tstz('pin_locked_until'),
  /** wrong PINs on `pin_fail_day`; at the day's limit the account waits for a reset */
  pinFailDay: date('pin_fail_day'),
  pinFailsDay: integer('pin_fails_day').notNull().default(0),
  pinBlockedAt: tstz('pin_blocked_at'),
  /** RFC §10.14: 'light' (everyone starts here, whatever the device says) or 'dark', chosen in Settings */
  theme: text('theme').notNull().default('light'),
}, (t) => [
  check('users_theme', sql`${t.theme} in ('light', 'dark')`),
  index('users_state_idx').on(t.state),
  uniqueIndex('users_handle_lower').on(sql`lower(${t.handle})`),
]);

/**
 * RFC §10.13: a one-hour code an admin gives a member who forgot their PIN (or is locked out).
 * Only the hash is kept; the row stays as the log of who reset whom.
 */
export const pinResets = pgTable('pin_resets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: tstz('created_at').notNull().defaultNow(),
  expiresAt: tstz('expires_at').notNull(),
  usedAt: tstz('used_at'),
}, (t) => [index('pin_resets_user').on(t.userId, t.createdAt)]);

/** RFC §10.7: every time an admin opens a member's contact details. */
export const contactViews = pgTable('contact_views', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  adminId: uuid('admin_id').references(() => users.id, { onDelete: 'set null' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  at: tstz('at').notNull().defaultNow(),
}, (t) => [index('contact_views_user').on(t.userId, t.at)]);

export const userStateEvents = pgTable('user_state_events', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  fromState: userState('from_state'),
  toState: userState('to_state').notNull(),
  reason: text('reason').notNull(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  at: tstz('at').notNull().defaultNow(),
}, (t) => [index('user_state_events_user').on(t.userId, t.at)]);

export const userSeenDays = pgTable('user_seen_days', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: date('day').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.day] })]);

/**
 * RFC §10.11: one row per feed visit (a visit starts after 30 quiet minutes). The only behavioural
 * log the feed keeps: backlog size and whether the end card was reached, so the owner can tell
 * whether members get through the feed. Pruned after 60 days; gone with the member.
 */
export const feedVisits = pgTable('feed_visits', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  startedAt: tstz('started_at').notNull().defaultNow(),
  /** the frozen "new since" line for this visit */
  since: tstz('since').notNull(),
  /** posts waiting above the line when the visit started */
  newPosts: integer('new_posts').notNull(),
  caughtUpAt: tstz('caught_up_at'),
}, (t) => [index('feed_visits_user').on(t.userId, t.startedAt)]);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

// ─── Auth ───────────────────────────────────────────────────────────────────

export const passkeys = pgTable('passkeys', {
  id: text('id').primaryKey(), // credential ID, base64url
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  publicKey: text('public_key').notNull(), // base64url
  counter: bigint('counter', { mode: 'number' }).notNull(),
  transports: text('transports').array(),
  deviceLabel: text('device_label'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  lastUsedAt: tstz('last_used_at'),
}, (t) => [index('passkeys_user').on(t.userId)]);

export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  client: text('client').notNull(), // 'web' | 'mobile'
  expiresAt: tstz('expires_at').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [index('sessions_user').on(t.userId)]);

export const authChallenges = pgTable('auth_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  challenge: text('challenge').notNull(),
  purpose: text('purpose').notNull(), // 'register' | 'login' | 'add_passkey' | 'recover'
  userId: uuid('user_id'),
  data: jsonb('data'),
  expiresAt: tstz('expires_at').notNull(),
});

// ─── Invites & waitlist ─────────────────────────────────────────────────────

export const invites = pgTable('invites', {
  codeHash: text('code_hash').primaryKey(), // sha256 hex of the normalised code
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  redeemedBy: uuid('redeemed_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: tstz('created_at').notNull().defaultNow(),
  expiresAt: tstz('expires_at').notNull(),
  redeemedAt: tstz('redeemed_at'),
  revokedAt: tstz('revoked_at'),
}, (t) => [index('invites_created_by').on(t.createdBy)]);

/**
 * Visitor passes (RFC §10.8): an admin makes one; whoever enters its code gets one hour of looking
 * around with no account, no seat and no way to write. The code is stored hashed like an invite;
 * entering it starts the hour, locks the pass to that browser (token_hash, also hashed) and sets
 * expires_at. An unopened code stops working at code_expires_at. Rows are purged after 30 days.
 */
export const visitorPasses = pgTable('visitor_passes', {
  id: uuid('id').primaryKey().defaultRandom(),
  codeHash: text('code_hash').notNull(),
  /** the admin's private note of who the pass was for */
  label: text('label').notNull().default(''),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: tstz('created_at').notNull().defaultNow(),
  codeExpiresAt: tstz('code_expires_at').notNull(),
  openedAt: tstz('opened_at'),
  tokenHash: text('token_hash'),
  expiresAt: tstz('expires_at'),
  revokedAt: tstz('revoked_at'),
  revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'set null' }),
}, (t) => [
  uniqueIndex('visitor_passes_code').on(t.codeHash),
  uniqueIndex('visitor_passes_token').on(t.tokenHash),
  index('visitor_passes_created').on(t.createdAt),
  check('visitor_passes_label_len', sql`char_length(${t.label}) <= 80`),
]);

/**
 * Screen time (RFC §10.10): how much of the current half hour a member has looked at the site, and
 * the hour they are locked out for once it is spent. One row per member, written by heartbeats.
 */
export const screenTime = pgTable('screen_time', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  /** seconds of visible time in the current window */
  usedS: integer('used_s').notNull().default(0),
  /** when the current window began (null until the first heartbeat) */
  windowStartedAt: tstz('window_started_at'),
  /** set when the window is spent; the member is locked out until then */
  lockedUntil: tstz('locked_until'),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const waitlist = pgTable('waitlist', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  priority: integer('priority').notNull(), // 0 = reinstating member, 1 = new invitee
  enqueuedAt: tstz('enqueued_at').notNull().defaultNow(),
  offeredAt: tstz('offered_at'),
  offerExpiresAt: tstz('offer_expires_at'),
}, (t) => [index('waitlist_order').on(t.priority, t.enqueuedAt)]);

// ─── Content ────────────────────────────────────────────────────────────────

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  parentId: uuid('parent_id').references((): AnyPgColumn => posts.id, { onDelete: 'set null' }),
  rootId: uuid('root_id').references((): AnyPgColumn => posts.id, { onDelete: 'set null' }),
  body: text('body').notNull(),
  editedAt: tstz('edited_at'),
  deletedAt: tstz('deleted_at'),
  hiddenAt: tstz('hidden_at'),
  /** an update in a collab's thread (RFC §10.5); replies carry it too. Kept out of the main feed. */
  collabId: uuid('collab_id').references((): AnyPgColumn => collabs.id, { onDelete: 'cascade' }),
  /** an update on an event's page (a collab meetup, or any event); replies carry it too */
  eventId: uuid('event_id').references((): AnyPgColumn => events.id, { onDelete: 'cascade' }),
  /** RFC §10.17: this post is written as a pet; the author stays the owner */
  petId: uuid('pet_id').references((): AnyPgColumn => pets.id, { onDelete: 'cascade' }),
  /** a pet post's label: everyday | advice | health | help */
  petLabel: text('pet_label'),
  search: tsvector('search').generatedAlwaysAs(sql`to_tsvector('simple', body)`),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  check('posts_body_len', sql`char_length(${t.body}) <= 1500`),
  index('posts_feed').on(t.createdAt.desc(), t.id.desc())
    .where(sql`parent_id is null and deleted_at is null and hidden_at is null`),
  index('posts_thread').on(t.rootId, t.createdAt),
  index('posts_author').on(t.authorId, t.createdAt),
  index('posts_collab').on(t.collabId, t.createdAt).where(sql`collab_id is not null`),
  index('posts_event').on(t.eventId, t.createdAt).where(sql`event_id is not null`),
  index('posts_search').using('gin', t.search),
]);

/** RFC §10.17: a pet is a content identity owned by one member (up to three each). */
export const pets = pgTable('pets', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  species: text('species').notNull(), // 'dog' | 'cat' | 'bird'
  /** any non-negative number: it seeds one of the endless drawn looks for this species */
  avatarVariant: integer('avatar_variant').notNull().default(0),
  avatarKey: text('avatar_key'),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [index('pets_owner').on(t.ownerId, t.createdAt)]);

export const postImages = pgTable('post_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Null while the upload is pending (not yet attached to a post). */
  postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
  uploaderId: uuid('uploader_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  r2Key: text('r2_key').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  check('post_images_position', sql`${t.position} between 0 and 3`),
  index('post_images_post').on(t.postId),
  index('post_images_uploader').on(t.uploaderId),
]);

export const likes = pgTable('likes', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.postId] }), index('likes_post').on(t.postId)]);

/** RFC §10.16: who a post really mentions (@handle in the body, resolved when it is saved). */
export const postMentions = pgTable('post_mentions', {
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.postId, t.userId] }), index('post_mentions_user').on(t.userId, t.createdAt)]);

export const flags = pgTable('flags', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  reason: text('reason'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  resolvedAt: tstz('resolved_at'),
  resolution: text('resolution'), // 'restored' | 'removed'
}, (t) => [
  primaryKey({ columns: [t.userId, t.postId] }),
  index('flags_open').on(t.postId).where(sql`resolved_at is null`),
]);

// ─── Events ─────────────────────────────────────────────────────────────────

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  hostId: uuid('host_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  startsAt: tstz('starts_at').notNull(),
  endsAt: tstz('ends_at'),
  location: text('location').notNull(),
  locationRsvpOnly: boolean('location_rsvp_only').notNull().default(false),
  capacity: integer('capacity'),
  priceNote: text('price_note'),
  externalPaymentUrl: text('external_payment_url'),
  cancelledAt: tstz('cancelled_at'),
  /** a collab meetup (RFC §10.5) */
  collabId: uuid('collab_id').references((): AnyPgColumn => collabs.id, { onDelete: 'cascade' }),
  /** 'team': only the collab's team sees it; 'anyone': a normal event */
  audience: text('audience').notNull().default('anyone'),
  /** RFC §10.5: what people need to bring or know (shown on the page) */
  requirements: text('requirements').notNull().default(''),
  /** 'open': RSVP straight away; 'approve': ask with a note, the host accepts */
  joinMode: text('join_mode').notNull().default('open'),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  index('events_starts').on(t.startsAt),
  index('events_collab').on(t.collabId).where(sql`collab_id is not null`),
  check('events_join_mode', sql`(${t.joinMode} in ('open', 'approve'))`),
  check('events_requirements_len', sql`char_length(${t.requirements}) <= 500`),
  check('events_audience', sql`(${t.audience} = 'anyone') or (${t.audience} = 'team' and ${t.collabId} is not null)`),
]);

export const rsvpStatus = pgEnum('rsvp_status', ['going', 'waitlisted', 'cancelled']);

export const eventRsvps = pgTable('event_rsvps', {
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: rsvpStatus('status').notNull(),
  attendedConfirmedAt: tstz('attended_confirmed_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.eventId, t.userId] })]);

/** Ledger read by the lurker check. kind: 'post' | 'reply' | 'event_hosted' | 'event_attended'. */
export const contributions = pgTable('contributions', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  refId: uuid('ref_id').notNull(),
  at: tstz('at').notNull().defaultNow(),
}, (t) => [
  index('contrib_user_at').on(t.userId, t.at),
  uniqueIndex('contrib_uniq').on(t.userId, t.kind, t.refId),
]);

// ─── Payments & notifications ───────────────────────────────────────────────

export const pricing = pgTable('pricing', {
  productKey: text('product_key').primaryKey(), // 'stay_fee_90d' | 'reinstatement'
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
  active: boolean('active').notNull().default(true),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  productKey: text('product_key').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
  stripeCheckoutSessionId: text('stripe_checkout_session_id').notNull().unique(),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  /** 'pending' → 'paid' | 'expired'; 'paid' → 'refund_pending' → 'refunded' when the paid-for transition is no longer possible. */
  status: text('status').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
  /** When the checkout session stops accepting payment. */
  expiresAt: tstz('expires_at'),
  paidAt: tstz('paid_at'),
  refundedAt: tstz('refunded_at'),
  refundReason: text('refund_reason'),
}, (t) => [
  index('payments_user').on(t.userId, t.createdAt),
  check('payments_status', sql`${t.status} in ('pending', 'paid', 'expired', 'refund_pending', 'refunded')`),
]);

export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  receivedAt: tstz('received_at').notNull().defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  payload: jsonb('payload').notNull(),
  readAt: tstz('read_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  /** Set once Web Push fan-out has handled this row (sent, or nothing to send). */
  pushedAt: tstz('pushed_at'),
}, (t) => [
  index('notif_inbox').on(t.userId, t.createdAt),
  index('notif_push_queue').on(t.createdAt).where(sql`pushed_at is null`),
]);

// ─── Picks: a member suggests a movie, book, place or food ───────────────────
export const suggestionKind = pgEnum('suggestion_kind', ['movie', 'book', 'place', 'food']);

export const suggestions = pgTable('suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: suggestionKind('kind').notNull(),
  title: text('title').notNull(),
  note: text('note'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  deletedAt: tstz('deleted_at'),
}, (t) => [
  check('suggestions_title_len', sql`char_length(${t.title}) between 1 and 80`),
  check('suggestions_note_len', sql`${t.note} is null or char_length(${t.note}) <= 140`),
  index('suggestions_author').on(t.authorId, t.createdAt),
  index('suggestions_live').on(t.createdAt).where(sql`deleted_at is null`),
]);

/**
 * "Tried it": one vote per member per pick (+1 good / -1 not for me) with an optional remark.
 * Voting means you have watched/read/been/eaten it. Never a lurker contribution.
 */
export const suggestionVotes = pgTable('suggestion_votes', {
  suggestionId: uuid('suggestion_id').notNull().references(() => suggestions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  vote: integer('vote').notNull(),
  remark: text('remark'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.suggestionId, t.userId] }),
  check('suggestion_votes_vote', sql`${t.vote} in (-1, 1)`),
  check('suggestion_votes_remark_len', sql`${t.remark} is null or char_length(${t.remark}) between 1 and 200`),
  index('suggestion_votes_user').on(t.userId),
]);

// ─── Interests (RFC §10.5): a fixed list admins can extend; members pick up to 10 ───

export const interests = pgTable('interests', {
  slug: text('slug').primaryKey(),
  label: text('label').notNull(),
  /** a member who added it (null = seeded or an admin's); admins can remove any */
  createdBy: uuid('created_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  check('interests_slug', sql`${t.slug} ~ '^[a-z0-9-]{2,30}$'`),
  check('interests_label_len', sql`char_length(${t.label}) between 2 and 30`),
]);

export const userInterests = pgTable('user_interests', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  interest: text('interest').notNull().references(() => interests.slug, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.userId, t.interest] }),
  index('user_interests_interest').on(t.interest),
]);

// ─── Collabs (RFC §10.5): ongoing projects people do together ───────────────

export const collabs = pgTable('collabs', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  requirements: text('requirements').notNull().default(''),
  /** "Looking for": short role tags */
  roles: jsonb('roles').notNull().default(sql`'[]'::jsonb`),
  teamMax: integer('team_max').notNull(),
  /** 'open' = anyone joins; 'approve' = requests the host accepts */
  joinMode: text('join_mode').notNull().default('approve'),
  /** 'recruiting' | 'closed' | 'finished' */
  status: text('status').notNull().default('recruiting'),
  priceNote: text('price_note'),
  paymentUrl: text('payment_url'),
  coverKey: text('cover_key'),
  coverWidth: integer('cover_width'),
  coverHeight: integer('cover_height'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  finishedAt: tstz('finished_at'),
  hiddenAt: tstz('hidden_at'),
  deletedAt: tstz('deleted_at'),
}, (t) => [
  check('collabs_title_len', sql`char_length(${t.title}) between 1 and 80`),
  check('collabs_team_max', sql`${t.teamMax} between 2 and 20`),
  check('collabs_join_mode', sql`${t.joinMode} in ('open', 'approve')`),
  check('collabs_status', sql`${t.status} in ('recruiting', 'closed', 'finished')`),
  index('collabs_live').on(t.createdAt).where(sql`deleted_at is null`),
]);

export const collabInterests = pgTable('collab_interests', {
  collabId: uuid('collab_id').notNull().references(() => collabs.id, { onDelete: 'cascade' }),
  interest: text('interest').notNull().references(() => interests.slug, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.collabId, t.interest] }), index('collab_interests_interest').on(t.interest)]);

/** The team. Exactly one 'host' while the collab has one; 'cohost' can manage; 'member'. */
export const collabMembers = pgTable('collab_members', {
  collabId: uuid('collab_id').notNull().references(() => collabs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  joinedAt: tstz('joined_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.collabId, t.userId] }),
  check('collab_members_role', sql`${t.role} in ('host', 'cohost', 'member')`),
  index('collab_members_user').on(t.userId),
]);

/** Asking to join an 'approve' collab: 'pending' | 'accepted' | 'declined' | 'withdrawn'. */
export const collabRequests = pgTable('collab_requests', {
  collabId: uuid('collab_id').notNull().references(() => collabs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  note: text('note'),
  status: text('status').notNull().default('pending'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  decidedAt: tstz('decided_at'),
}, (t) => [primaryKey({ columns: [t.collabId, t.userId] })]);

/** A host's invitation: 'pending' | 'accepted' | 'declined'. */
export const collabInvites = pgTable('collab_invites', {
  collabId: uuid('collab_id').notNull().references(() => collabs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending'),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.collabId, t.userId] })]);

/** Reports on a collab: the same shape and lifecycle as `flags` on posts (5 hide it until ops decide). */
export const collabFlags = pgTable('collab_flags', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  collabId: uuid('collab_id').notNull().references(() => collabs.id, { onDelete: 'cascade' }),
  reason: text('reason'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  resolvedAt: tstz('resolved_at'),
  resolution: text('resolution'), // 'restored' | 'removed'
}, (t) => [
  primaryKey({ columns: [t.userId, t.collabId] }),
  index('collab_flags_open').on(t.collabId).where(sql`resolved_at is null`),
]);

/** Events carry interest tags too (RFC §10.5), so "people who might fit" works the same way. */
export const eventInterests = pgTable('event_interests', {
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  interest: text('interest').notNull().references(() => interests.slug, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.eventId, t.interest] }), index('event_interests_interest').on(t.interest)]);

/** Asking to come to an 'approve' event: 'pending' | 'accepted' | 'declined' | 'withdrawn'. */
export const eventRequests = pgTable('event_requests', {
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  note: text('note'),
  status: text('status').notNull().default('pending'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  decidedAt: tstz('decided_at'),
}, (t) => [primaryKey({ columns: [t.eventId, t.userId] })]);

/** A host's invitation to an event: 'pending' | 'accepted' | 'declined'. Skips asking. */
export const eventInvites = pgTable('event_invites', {
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending'),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.eventId, t.userId] })]);

// ─── Portfolio: the profile laid out like a Behance portfolio ───────────────
// One row per member, created on first edit. Lists are jsonb: skills/tools are string[],
// experience/education are Entry[] ({ title, place, from, to | null, line }, newest first),
// links are { label, url }[] (https only). Nothing here is required.
export const portfolios = pgTable('portfolios', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  headline: text('headline').notNull().default(''),
  location: text('location').notNull().default(''),
  openToWork: boolean('open_to_work').notNull().default(false),
  about: text('about').notNull().default(''),
  skills: jsonb('skills').notNull().default(sql`'[]'::jsonb`),
  tools: jsonb('tools').notNull().default(sql`'[]'::jsonb`),
  experience: jsonb('experience').notNull().default(sql`'[]'::jsonb`),
  education: jsonb('education').notNull().default(sql`'[]'::jsonb`),
  links: jsonb('links').notNull().default(sql`'[]'::jsonb`),
  /** optional cover strip across the top (a moved upload: key + size) */
  coverKey: text('cover_key'),
  coverWidth: integer('cover_width'),
  coverHeight: integer('cover_height'),
  /** the look: 'archivo' | 'mono' | 'hand'; 'paper' | 'ink'; one of six accents */
  font: text('font').notNull().default('archivo'),
  bg: text('bg').notNull().default('paper'),
  accent: text('accent').notNull().default('red'),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
}, (t) => [
  check('portfolios_headline_len', sql`char_length(${t.headline}) <= 60`),
  check('portfolios_location_len', sql`char_length(${t.location}) <= 60`),
  check('portfolios_about_len', sql`char_length(${t.about}) <= 1200`),
  check('portfolios_font', sql`${t.font} in ('archivo', 'mono', 'hand')`),
  check('portfolios_bg', sql`${t.bg} in ('paper', 'ink')`),
  check('portfolios_accent', sql`${t.accent} in ('red', 'blue', 'green', 'yellow', 'violet', 'orange')`),
]);

// Projects: numbered case studies on a portfolio. `draft` = only the owner sees it.
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  body: text('body').notNull().default(''),
  year: integer('year'),
  role: text('role').notNull().default(''),
  tools: jsonb('tools').notNull().default(sql`'[]'::jsonb`),
  team: text('team').notNull().default(''),
  duration: text('duration').notNull().default(''),
  position: integer('position').notNull().default(0),
  draft: boolean('draft').notNull().default(false),
  /** set when enough members reported it (same threshold as posts); only the owner sees it until ops decide */
  hiddenAt: tstz('hidden_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
}, (t) => [
  check('projects_title_len', sql`char_length(${t.title}) between 1 and 80`),
  check('projects_summary_len', sql`char_length(${t.summary}) <= 200`),
  check('projects_body_len', sql`char_length(${t.body}) <= 4000`),
  index('projects_owner').on(t.userId, t.position),
]);

/**
 * An image on a project page, in order. Rows move here from post_images when a pending upload
 * is attached (same id, same blob), so the orphan sweep never touches them. layout: 'full' |
 * 'left' | 'right' (where the text panel sits; the panel is heading + text).
 */
export const projectImages = pgTable('project_images', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  r2Key: text('r2_key').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  position: integer('position').notNull().default(0),
  layout: text('layout').notNull().default('full'),
  heading: text('heading').notNull().default(''),
  text: text('text').notNull().default(''),
  caption: text('caption').notNull().default(''),
}, (t) => [
  check('project_images_layout', sql`${t.layout} in ('full', 'left', 'right')`),
  check('project_images_position', sql`${t.position} between 0 and 9`),
  index('project_images_project').on(t.projectId, t.position),
]);

/** Reports on a project: the same shape and lifecycle as `flags` on posts. */
export const projectFlags = pgTable('project_flags', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  reason: text('reason'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  resolvedAt: tstz('resolved_at'),
  resolution: text('resolution'), // 'restored' | 'removed'
}, (t) => [
  primaryKey({ columns: [t.userId, t.projectId] }),
  index('project_flags_open').on(t.projectId).where(sql`resolved_at is null`),
]);

// ─── Consultations (RFC §10.6): book a member's time ─────────────────────────
// Anti never handles the money (a price note and the consultant's own link at most) and never
// shows a contact until the consultant accepts; then both sides see each other's, for a while.

/** A member's offer. No row = never set up. `active` false = paused. */
export const consultOffers = pgTable('consult_offers', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  active: boolean('active').notNull().default(false),
  /** what they can help with, in their own words (optional): the portfolio says who they are */
  description: text('description').notNull().default(''),
  minutes: integer('minutes').notNull().default(60),
  /** what new requests start from; the consultant decides per request when accepting */
  pricing: text('pricing').notNull().default('free'),
  priceNote: text('price_note'),
  paymentUrl: text('payment_url'),
  /** private: copied onto a request only when it is accepted */
  contact: text('contact').notNull().default(''),
  /** an admin switched their consulting off */
  blockedAt: tstz('blocked_at'),
  /** hidden after reports until an admin decides */
  hiddenAt: tstz('hidden_at'),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
}, (t) => [
  check('consult_offers_pricing', sql`${t.pricing} in ('free', 'paid')`),
  check('consult_offers_description_len', sql`char_length(${t.description}) <= 500`),
  check('consult_offers_contact_len', sql`char_length(${t.contact}) <= 300`),
]);

/**
 * One request. pending → accepted (paid: waiting for the requester to agree) → revealed → done;
 * or declined / expired / closed. Contacts are copies made at the reveal and wiped when hidden.
 */
export const consultations = pgTable('consultations', {
  id: uuid('id').primaryKey().defaultRandom(),
  consultantId: uuid('consultant_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  requesterId: uuid('requester_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  need: text('need').notNull(),
  whenText: text('when_text').notNull().default(''),
  minutes: integer('minutes').notNull(),
  status: text('status').notNull().default('pending'),
  /** set when accepted */
  pricing: text('pricing'),
  priceNote: text('price_note'),
  paymentUrl: text('payment_url'),
  requesterContact: text('requester_contact'),
  consultantContact: text('consultant_contact'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  decidedAt: tstz('decided_at'),
  revealedAt: tstz('revealed_at'),
  doneAt: tstz('done_at'),
  closedAt: tstz('closed_at'),
  closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
  contactsHiddenAt: tstz('contacts_hidden_at'),
  /** the requester's public thank-you after a done session; the consultant can hide it */
  thanks: text('thanks'),
  thanksAt: tstz('thanks_at'),
  thanksHidden: boolean('thanks_hidden').notNull().default(false),
}, (t) => [
  check('consultations_status', sql`${t.status} in ('pending', 'accepted', 'revealed', 'done', 'declined', 'expired', 'closed')`),
  check('consultations_pricing', sql`${t.pricing} is null or ${t.pricing} in ('free', 'paid')`),
  check('consultations_need_len', sql`char_length(${t.need}) between 1 and 1000`),
  check('consultations_when_len', sql`char_length(${t.whenText}) <= 200`),
  check('consultations_thanks_len', sql`${t.thanks} is null or char_length(${t.thanks}) between 1 and 300`),
  check('consultations_two_people', sql`${t.consultantId} <> ${t.requesterId}`),
  index('consultations_consultant').on(t.consultantId, t.createdAt),
  index('consultations_requester').on(t.requesterId, t.createdAt),
]);

/** Reports on an offer (5 hide it) or on a request (one goes straight to the admins). */
export const consultFlags = pgTable('consult_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  offerUserId: uuid('offer_user_id').references(() => users.id, { onDelete: 'cascade' }),
  consultationId: uuid('consultation_id').references(() => consultations.id, { onDelete: 'cascade' }),
  reason: text('reason'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  resolvedAt: tstz('resolved_at'),
  resolution: text('resolution'), // 'restored' | 'removed'
}, (t) => [
  check('consult_flags_one_target', sql`(${t.offerUserId} is null) <> (${t.consultationId} is null)`),
  uniqueIndex('consult_flags_offer_once').on(t.userId, t.offerUserId).where(sql`offer_user_id is not null and resolved_at is null`),
  uniqueIndex('consult_flags_request_once').on(t.userId, t.consultationId).where(sql`consultation_id is not null and resolved_at is null`),
]);

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(), // 'webpush' | 'apns' | 'fcm'
  endpoint: text('endpoint').notNull().unique(),
  keys: jsonb('keys').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

// ─── Rate limiting (fixed windows; shared by all API instances) ─────────────

export const rateLimits = pgTable('rate_limits', {
  key: text('key').notNull(),            // e.g. 'like:<userId>', 'auth:<ip>'
  windowStart: tstz('window_start').notNull(),
  count: integer('count').notNull(),
}, (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index('rate_limits_window').on(t.windowStart)]);

// ─── Media blobs (STORAGE=db: images kept in Postgres for hosts without a disk) ─

export const mediaBlobs = pgTable('media_blobs', {
  key: text('key').primaryKey(),
  contentType: text('content_type').notNull(),
  bytes: bytea('bytes').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});
