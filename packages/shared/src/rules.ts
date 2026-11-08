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

// ─── Picks: members suggest a movie, book, place or food ─────────────────────
export const SUGGESTION_KINDS = ['movie', 'book', 'place', 'food'] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];
export const SUGGESTION_TITLE_MAX = 80;
export const SUGGESTION_NOTE_MAX = 140;
export const SUGGESTIONS_PER_DAY = 10;

// ─── Portfolio: the profile laid out like a Behance portfolio ───────────────
// Every field is optional; none asks for a real name, email or phone number.
export const PF_HEADLINE_MAX = 60;
export const PF_LOCATION_MAX = 60;
export const PF_ABOUT_MAX = 1200;
/** skills and tools: up to this many tags, each up to PF_TAG_MAX characters */
export const PF_TAGS_MAX = 30;
export const PF_TAG_MAX = 30;
export const PF_EXPERIENCE_MAX = 10;
export const PF_EDUCATION_MAX = 6;
export const PF_ENTRY_TITLE_MAX = 80;
export const PF_ENTRY_PLACE_MAX = 80;
export const PF_ENTRY_LINE_MAX = 140;
export const PF_YEAR_MIN = 1950;
/** an end year may sit a little in the future ("graduating 2027") */
export const PF_YEAR_AHEAD = 10;
export const PF_LINKS_MAX = 6;
export const PF_LINK_LABEL_MAX = 30;
export const PF_LINK_URL_MAX = 500;

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


// ─── Events (RFC-0001 §10) ──────────────────────────────────────────────────
export const EVENT_TITLE_MAX = 120;
export const EVENT_DESCRIPTION_MAX = 2000;
export const EVENT_LOCATION_MAX = 200;
export const EVENT_PRICE_NOTE_MAX = 100;
export const EVENT_URL_MAX = 500;
export const EVENT_CAPACITY_MAX = 1000;
/** Events a member can create per rolling 24 hours. */
export const EVENTS_PER_DAY = 5;
/** Host can confirm attendance from the start time until this many days after it. */
export const ATTENDANCE_WINDOW_DAYS = 14;
/** How far ahead an event can be scheduled. */
export const EVENT_MAX_DAYS_AHEAD = 365;
/** Without an end time, an event counts as "happening now" for this many hours after it starts. */
export const EVENT_DEFAULT_HOURS = 3;
