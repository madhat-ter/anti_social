import {
  pgTable, pgEnum, uuid, text, timestamp, integer, boolean, date, primaryKey, index,
  uniqueIndex, jsonb, bigint, customType, check, type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
const tstz = (name: string) => timestamp(name, { withTimezone: true });

// ─── Users & lifecycle ──────────────────────────────────────────────────────

export const userState = pgEnum('user_state', [
  'waitlisted', 'active', 'flagged_lurker', 'archived', 'banned', 'deleted',
]);
export const userRole = pgEnum('user_role', ['member', 'ops']);

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
}, (t) => [
  index('users_state_idx').on(t.state),
  uniqueIndex('users_handle_lower').on(sql`lower(${t.handle})`),
]);

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
  search: tsvector('search').generatedAlwaysAs(sql`to_tsvector('simple', body)`),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  check('posts_body_len', sql`char_length(${t.body}) <= 500`),
  index('posts_feed').on(t.createdAt.desc(), t.id.desc())
    .where(sql`parent_id is null and deleted_at is null and hidden_at is null`),
  index('posts_thread').on(t.rootId, t.createdAt),
  index('posts_author').on(t.authorId, t.createdAt),
  index('posts_search').using('gin', t.search),
]);

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
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [index('events_starts').on(t.startsAt)]);

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
