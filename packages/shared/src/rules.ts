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
  /** RFC §10.10: half an hour of looking, then an hour locked out; nudges at these seconds */
  screen_time_limit_s: 1800,
  screen_time_rest_s: 3600,
  screen_time_nudges_s: [600, 1200, 1500] as readonly number[],
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
/** "Tried it" remark on a pick (optional, one per member per pick). */
export const SUGGESTION_REMARK_MAX = 200;
/** Picks recently seen that the rotation (and Another) skips. */
export const PICK_NO_REPEAT = 5;
/** The pick window changes on its own this often. */
export const PICK_ROTATE_MS = 60_000;
/** Interest tags a member can pick (RFC §10.5). */
export const INTERESTS_MAX = 10;
// ─── Collabs (RFC §10.5): ongoing projects people do together ───────────────
export const COLLAB_TITLE_MAX = 80;
export const COLLAB_DESCRIPTION_MAX = 2000;
export const COLLAB_REQUIREMENTS_MAX = 500;
export const COLLAB_INTERESTS_MAX = 5;
export const COLLAB_ROLES_MAX = 5;
export const COLLAB_ROLE_MAX = 30;
export const COLLAB_TEAM_MIN = 2;
export const COLLAB_TEAM_MAX = 20;
export const COLLAB_NOTE_MAX = 300;
export const COLLAB_PRICE_NOTE_MAX = 100;
/** recruiting collabs one member can host at a time (activities and projects together, RFC §10.21) */
export const COLLAB_HOSTING_MAX = 3;
/** open invitations per collab */
export const COLLAB_INVITES_MAX = 20;
// ─── One Collab (RFC §10.21): an event, an activity or a project ────────────
export const COLLAB_KINDS = ['event', 'activity', 'project'] as const;
export type CollabKind = (typeof COLLAB_KINDS)[number];
/** the kinds that live in the `collabs` table (events are still `events`) */
export const COLLAB_TABLE_KINDS = ['activity', 'project'] as const;
/** the activity's plain "When we meet" line */
export const COLLAB_MEETS_MAX = 120;
/** an activity's optional size limit */
export const ACTIVITY_SIZE_MAX = 1000;
/** a request to join nobody answers gets a reminder after this many days… */
export const REQUEST_REMIND_DAYS = 3;
/** …and closes after this many, telling the person it was not answered in time */
export const REQUEST_EXPIRE_DAYS = 7;
/** a project with nothing new for this long asks its host once: finish, keep going, or close */
export const QUIET_PROJECT_DAYS = 21;
/** an activity with nothing new for this long asks: keep it running, or end it */
export const QUIET_ACTIVITY_DAYS = 42;
/** events get the same tags, requirements and ask-to-join (RFC §10.5) */
export const EVENT_REQUIREMENTS_MAX = 500;
export const EVENT_INTERESTS_MAX = 5;
export const EVENT_INVITES_MAX = 20;
export const COLLAB_STATUSES = ['recruiting', 'closed', 'finished'] as const;
export type CollabStatus = (typeof COLLAB_STATUSES)[number];

// ─── Consultations (RFC §10.6): book a member's time; contacts swap on acceptance ───
/** Both sides must be at least this old: contact details and money between strangers. */
export const CONSULT_MIN_AGE = 18;
export const CONSULT_DESCRIPTION_MAX = 500;
/** session lengths a consultant can offer, in minutes */
export const CONSULT_MINUTES = [30, 45, 60, 90, 120] as const;
export const CONSULT_PRICE_NOTE_MAX = 100;
/** free text: "WhatsApp +977…, Telegram @x". Only ever shown to the other side after acceptance. */
export const CONSULT_CONTACT_MAX = 300;
export const CONSULT_NEED_MAX = 1000;
export const CONSULT_WHEN_MAX = 200;
export const CONSULT_THANKS_MAX = 300;
/** open requests (waiting, accepted or under way) one member can have with the same consultant */
export const CONSULT_OPEN_PER_PAIR = 3;
/** a request nobody answered (or a paid acceptance nobody agreed to) expires after this */
export const CONSULT_ANSWER_DAYS = 7;
/** contacts disappear again this long after a session is marked done… */
export const CONSULT_CONTACT_DONE_DAYS = 14;
/** …or this long after they were revealed, if it never is */
export const CONSULT_CONTACT_MAX_DAYS = 60;
export const CONSULT_STATUSES = ['pending', 'accepted', 'revealed', 'done', 'declined', 'expired', 'closed'] as const;
export type ConsultStatus = (typeof CONSULT_STATUSES)[number];
export type ConsultPricing = 'free' | 'paid';

// ─── Setup: what every member fills in once, right after joining ────────────
/** Gender only shapes the drawn face; it is never shown as text. */
export const GENDERS = ['woman', 'man', 'nonbinary', 'undisclosed'] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABEL: Record<Gender, string> = {
  woman: 'Woman', man: 'Man', nonbinary: 'Non-binary', undisclosed: 'Prefer not to say',
};
/** "About you": the portfolio's About, required, counted in words (runs of non-space). */
export const ABOUT_MIN_WORDS = 50;
export const ABOUT_MAX_WORDS = 300;
/** Below this age the account is closed (the usual legal minimum for online services). */
export const MIN_AGE = 13;
export const MAX_AGE = 120;

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** A valid calendar date written YYYY-MM-DD, or null. */
export function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/** Whole years from `iso` (YYYY-MM-DD) to `today` ({y, m, d}). Negative for a date in the future. */
export function ageOn(iso: string, today: { y: number; m: number; d: number }): number | null {
  const b = parseIsoDate(iso);
  if (!b) return null;
  const beforeBirthday = today.m < b.m || (today.m === b.m && today.d < b.d);
  return today.y - b.y - (beforeBirthday ? 1 : 0);
}

/** Today's date in UTC, the way the server sees it. */
export const utcToday = (now = new Date()) => ({ y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: now.getUTCDate() });
/** Today's date where the viewer is. */
export const localToday = (now = new Date()) => ({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** Is it this birthday today? 29 February is celebrated on 28 February in other years. */
export function isBirthdayOn(b: { month: number; day: number }, today: { y: number; m: number; d: number }): boolean {
  if (b.month === 2 && b.day === 29 && !isLeap(today.y)) return today.m === 2 && today.d === 28;
  return b.month === today.m && b.day === today.d;
}

// ─── Portfolio: the profile laid out like a Behance portfolio ───────────────
// Every field is optional except About (filled in at setup); none asks for a real name, email or phone.
export const PF_HEADLINE_MAX = 60;
export const PF_LOCATION_MAX = 60;
/** characters; the real limit is ABOUT_MAX_WORDS, this only stops a few giant "words" */
export const PF_ABOUT_MAX = 2400;
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
/** The look of a portfolio: a fixed set of choices, no custom fonts or CSS. */
export const PF_FONTS = ['archivo', 'mono', 'hand'] as const;
export type PfFont = (typeof PF_FONTS)[number];
export const PF_BACKGROUNDS = ['paper', 'ink'] as const;
export type PfBackground = (typeof PF_BACKGROUNDS)[number];
export const PF_ACCENTS = ['red', 'blue', 'green', 'yellow', 'violet', 'orange'] as const;
export type PfAccent = (typeof PF_ACCENTS)[number];

// ─── Projects: numbered case studies on a portfolio ─────────────────────────
export const PROJECTS_MAX = 12;
export const PROJECT_IMAGES_MAX = 10;
export const PROJECT_TITLE_MAX = 80;
export const PROJECT_SUMMARY_MAX = 200;
export const PROJECT_BODY_MAX = 4000;
export const PROJECT_ROLE_MAX = 60;
export const PROJECT_TEAM_MAX = 40;
export const PROJECT_DURATION_MAX = 40;
export const PROJECT_TOOLS_MAX = 10;
export const PROJECT_CAPTION_MAX = 140;
/** a text panel beside an image: a heading and a paragraph */
export const PROJECT_PANEL_HEADING_MAX = 60;
export const PROJECT_PANEL_TEXT_MAX = 600;
/** how an image sits on the page: full width, or beside a text panel on the left or right */
export const PROJECT_LAYOUTS = ['full', 'left', 'right'] as const;
export type ProjectLayout = (typeof PROJECT_LAYOUTS)[number];

// ─── Posts & media (RFC-0001 §10) ───────────────────────────────────────────
/** raised from 500 on 2026-11-09 (owner's call); the DB check in schema.ts must match */
export const POST_MAX_CHARS = 1500;
export const POST_MAX_IMAGES = 4;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_DIMENSION = 2048;
export const EDIT_WINDOW_MINUTES = 15;
export const POSTS_PER_HOUR = 20;
export const PAGE_DEFAULT_LIMIT = 20;
export const PAGE_MAX_LIMIT = 50;
export const SEARCH_QUERY_MAX = 100;

/**
 * RFC §10.22, monologues: a post that is a recording (a song, a thought, a yap) drawn as a
 * cassette. Five minutes at most, recorded on the site or uploaded; no limit on how many.
 */
export const MONOLOGUE = {
  /** the longest recording, recorded or uploaded */
  maxSeconds: 300,
  /** the shortest worth posting */
  minSeconds: 1,
  /** an uploaded file (a song made elsewhere) */
  maxBytes: 15 * 1024 * 1024,
  titleMax: 80,
  /** the waveform under the cassette: this many bars, each 0..100 */
  peaks: 96,
  /** recordings waiting to be posted, per member */
  maxPending: 5,
} as const;
export const MONOLOGUE_KINDS = ['song', 'thought', 'yap'] as const;
export type MonologueKind = (typeof MONOLOGUE_KINDS)[number];
export const MONOLOGUE_KIND_LABEL: Record<MonologueKind, string> = { song: 'Song', thought: 'Thought', yap: 'Yap' };

/**
 * RFC §10.11, the feed: newest first, never ranked. These numbers drive the display rules on top
 * of it, and live here (not in `settings`) because the browser's fold must use the same ones as
 * the server. First guesses tied to anti's other rules; tune them from the feed_visits numbers.
 * The "new here" window is `new_member_exempt_days` in `settings`, shared with the lurker rule.
 */
export const FEED = {
  /** a visit starts when the feed opens after this long with no feed activity on the device */
  visitGapMinutes: 30,
  /** "new since" never reaches further back than this */
  newWindowDays: 7,
  /** an author's posts after this many on one day fold into "N more from X today" */
  foldAfter: 2,
  /** an older post gets a "people replied" row when at least this many others replied */
  threadMinRepliers: 2,
  /** …within this long of the post */
  threadWindowHours: 72,
  /** RFC §10.15: a text post this short (and on at most this many lines) is set large, as a note */
  shortMaxChars: 140,
  shortMaxLines: 3,
  /** a longer text post shows this many lines in a list, then "Read more" */
  clampLines: 6,
} as const;


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
