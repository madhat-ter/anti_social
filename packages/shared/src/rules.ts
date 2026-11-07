/**
 * Product rules from RFC-0001 §3. These are the defaults seeded into the `settings`
 * table; the SQL functions read the table at runtime, so tune values there in production.
 */
export const RULES = {
  seat_cap: 100,
  max_open_invites: 2,
  invite_expiry_days: 7,
  inactivity_days: 30,
  lurker_window_days: 30,
  lurker_min_seen_days: 8,
  lurker_min_contributions: 2,
  new_member_exempt_days: 21,
  lurker_grace_days: 7,
  stay_fee_exempt_days: 90,
  reinstate_offer_hours: 72,
  waitlist_decay_days: 60,
  ban_invite_penalty_days: 30,
  session_days: 7,
} as const;

export type RuleKey = keyof typeof RULES;

export const USER_STATES = [
  'waitlisted',
  'active',
  'flagged_lurker',
  'archived',
  'banned',
  'deleted',
] as const;
export type UserState = (typeof USER_STATES)[number];

/** States that occupy one of the seats. */
export const SEATED_STATES: readonly UserState[] = ['active', 'flagged_lurker'];

// ─── Posts & media (RFC-0001 §10) ───────────────────────────────────────────
export const POST_MAX_CHARS = 500;
export const POST_MAX_IMAGES = 4;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_DIMENSION = 2048;
export const EDIT_WINDOW_MINUTES = 15;
export const POSTS_PER_HOUR = 20;
export const PAGE_DEFAULT_LIMIT = 20;
export const PAGE_MAX_LIMIT = 50;
export const SEARCH_QUERY_MAX = 100;

