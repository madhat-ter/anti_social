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
