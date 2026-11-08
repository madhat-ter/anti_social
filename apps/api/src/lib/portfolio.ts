/**
 * Portfolio: a member's profile laid out like a Behance portfolio.
 * One row per member, every field optional. Members only, like everything else.
 * Editing it is about yourself, not a conversation with the room, so it never counts
 * as a contribution for the lurker rule (RFC §3: posts, replies, events).
 */
import { sql, type SQL } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';
import {
  PF_ABOUT_MAX, PF_ACCENTS, PF_BACKGROUNDS, PF_EDUCATION_MAX, PF_ENTRY_LINE_MAX, PF_ENTRY_PLACE_MAX, PF_ENTRY_TITLE_MAX,
  PF_EXPERIENCE_MAX, PF_FONTS, PF_HEADLINE_MAX, PF_LINKS_MAX, PF_LINK_LABEL_MAX, PF_LINK_URL_MAX, PF_LOCATION_MAX,
  PF_TAGS_MAX, PF_TAG_MAX, PF_YEAR_AHEAD, PF_YEAR_MIN, type PfAccent, type PfBackground, type PfFont,
} from '@anti/shared';
import { ApiError } from './errors';
import { mediaUrl, UUID_RE } from './posts';
import type { Storage } from './storage';

/** One line of experience or education. `to` null = still there ("present"). */
export type Entry = { title: string; place: string; from: number; to: number | null; line: string };
export type PfLink = { label: string; url: string };
export type PfStyle = { font: PfFont; bg: PfBackground; accent: PfAccent };
export type Cover = { url: string; width: number; height: number };

/** The CV fields a member edits, plus the look. */
export type PortfolioFields = PfStyle & {
  headline: string; location: string; openToWork: boolean; about: string;
  skills: string[]; tools: string[]; experience: Entry[]; education: Entry[]; links: PfLink[];
};
export type Portfolio = PortfolioFields & {
  handle: string;
  cover: Cover | null;
  /** nothing filled in yet: the page shows the plain profile */
  empty: boolean;
  updatedAt: string | null;
  mine: boolean;
};

export const DEFAULT_STYLE: PfStyle = { font: 'archivo', bg: 'paper', accent: 'red' };
export const EMPTY_FIELDS: PortfolioFields = {
  ...DEFAULT_STYLE,
  headline: '', location: '', openToWork: false, about: '',
  skills: [], tools: [], experience: [], education: [], links: [],
};

type Row = {
  user_id: string; handle: string; headline: string | null; location: string | null; open_to_work: boolean | null;
  about: string | null; skills: unknown; tools: unknown; experience: unknown; education: unknown; links: unknown;
  cover_key: string | null; cover_width: number | null; cover_height: number | null;
  font: PfFont | null; bg: PfBackground | null; accent: PfAccent | null;
  updated_iso: string | null;
};

const iso = (col: SQL) => sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** jsonb comes back parsed from postgres-js and as text from some drivers. */
function j<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
}

/** Content only: the look choices do not make a portfolio, a cover does. */
export function isEmpty(f: PortfolioFields, cover: Cover | null): boolean {
  return !cover && !f.headline && !f.location && !f.openToWork && !f.about
    && !f.skills.length && !f.tools.length && !f.experience.length && !f.education.length && !f.links.length;
}

function toPortfolio(r: Row, viewerId: string): Portfolio {
  const f: PortfolioFields = {
    headline: r.headline ?? '', location: r.location ?? '', openToWork: !!r.open_to_work, about: r.about ?? '',
    skills: j<string[]>(r.skills, []), tools: j<string[]>(r.tools, []),
    experience: j<Entry[]>(r.experience, []), education: j<Entry[]>(r.education, []), links: j<PfLink[]>(r.links, []),
    font: r.font ?? DEFAULT_STYLE.font, bg: r.bg ?? DEFAULT_STYLE.bg, accent: r.accent ?? DEFAULT_STYLE.accent,
  };
  const cover: Cover | null = r.cover_key ? { url: mediaUrl(r.cover_key), width: r.cover_width ?? 0, height: r.cover_height ?? 0 } : null;
  return { handle: r.handle, ...f, cover, empty: isEmpty(f, cover), updatedAt: r.updated_iso, mine: r.user_id === viewerId };
}

const select = sql`
  select u.id as user_id, u.handle, p.headline, p.location, p.open_to_work, p.about,
    p.skills, p.tools, p.experience, p.education, p.links, p.cover_key, p.cover_width, p.cover_height,
    p.font, p.bg, p.accent, ${iso(sql`p.updated_at`)} as updated_iso
  from users u
  left join portfolios p on p.user_id = u.id`;

/** The portfolio of a visible member (seated or archived), or null when there is no such member. */
export async function portfolioByHandle(db: Db, viewerId: string, handle: string): Promise<Portfolio | null> {
  const [r] = await rows<Row>(db, sql`${select}
    where lower(u.handle) = lower(${handle}) and u.state in ('active', 'flagged_lurker', 'archived')`);
  return r ? toPortfolio(r, viewerId) : null;
}

export async function portfolioByUser(db: Db, userId: string): Promise<Portfolio> {
  const [r] = await rows<Row>(db, sql`${select} where u.id = ${userId}::uuid`);
  if (!r) throw new ApiError(401, 'unauthenticated');
  return toPortfolio(r, userId);
}

const rowsOf = <T>(res: unknown): T[] => (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];

/**
 * Whole-row upsert: the caller merges the patch into the current fields first.
 * `coverId`: undefined = keep the cover; null = remove it; an id = one of the caller's pending
 * uploads, moved in (the old blob is removed after the transaction commits).
 */
export async function savePortfolio(db: Db, storage: Storage, userId: string, f: PortfolioFields, coverId?: string | null): Promise<Portfolio> {
  if (typeof coverId === 'string' && !UUID_RE.test(coverId)) throw bad('That cover image is not valid.');
  const gone = await db.transaction(async (tx) => {
    await tx.execute(sql`
      insert into portfolios (user_id, headline, location, open_to_work, about, skills, tools, experience, education, links,
        font, bg, accent, updated_at)
      values (${userId}::uuid, ${f.headline}, ${f.location}, ${f.openToWork}, ${f.about},
        ${JSON.stringify(f.skills)}::jsonb, ${JSON.stringify(f.tools)}::jsonb, ${JSON.stringify(f.experience)}::jsonb,
        ${JSON.stringify(f.education)}::jsonb, ${JSON.stringify(f.links)}::jsonb, ${f.font}, ${f.bg}, ${f.accent}, now())
      on conflict (user_id) do update set
        headline = excluded.headline, location = excluded.location, open_to_work = excluded.open_to_work,
        about = excluded.about, skills = excluded.skills, tools = excluded.tools, experience = excluded.experience,
        education = excluded.education, links = excluded.links, font = excluded.font, bg = excluded.bg,
        accent = excluded.accent, updated_at = now()`);
    if (coverId === undefined) return [] as string[];
    const [old] = rowsOf<{ cover_key: string | null }>(await tx.execute(sql`
      select cover_key from portfolios where user_id = ${userId}::uuid for update`));
    if (coverId === null) {
      await tx.execute(sql`update portfolios set cover_key = null, cover_width = null, cover_height = null where user_id = ${userId}::uuid`);
    } else {
      const moved = rowsOf<{ id: string }>(await tx.execute(sql`
        with up as (
          delete from post_images where id = ${coverId}::uuid and uploader_id = ${userId}::uuid and post_id is null
          returning r2_key, width, height)
        update portfolios set cover_key = up.r2_key, cover_width = up.width, cover_height = up.height
        from up where user_id = ${userId}::uuid returning user_id as id`));
      if (moved.length !== 1) throw bad('That cover image is not available.');
    }
    return old?.cover_key ? [old.cover_key] : [];
  });
  await Promise.all(gone.map((k) => storage.delete(k).catch((e) => console.error('storage delete failed', k, e))));
  return portfolioByUser(db, userId);
}

/** Blob keys a member's portfolio holds (the cover), for removal when the account goes. */
export async function portfolioBlobKeys(db: Db, userId: string): Promise<string[]> {
  const found = await rows<{ cover_key: string | null }>(db, sql`select cover_key from portfolios where user_id = ${userId}::uuid`);
  return found.map((r) => r.cover_key).filter((k): k is string => !!k);
}

// ─── Validation ─────────────────────────────────────────────────────────────

const bad = (detail: string) => new ApiError(400, 'portfolio_invalid', detail);

/** Trim, collapse runs of blank lines, enforce a length. */
function str(v: unknown, what: string, max: number, { multiline = false } = {}): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw bad(`${what} must be text.`);
  const s = (multiline ? v.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : v.replace(/\s+/g, ' ')).trim();
  if (s.length > max) throw bad(`${what} can be at most ${max} characters.`);
  return s;
}

function tags(v: unknown, what: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad(`${what} must be a list.`);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    const s = str(raw, what, PF_TAG_MAX);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  if (out.length > PF_TAGS_MAX) throw bad(`Up to ${PF_TAGS_MAX} ${what.toLowerCase()}.`);
  return out;
}

function year(v: unknown, what: string, max: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw bad(`${what} must be a year.`);
  if (n < PF_YEAR_MIN || n > max) throw bad(`${what} must be between ${PF_YEAR_MIN} and ${max}.`);
  return n;
}

function entries(v: unknown, what: string, max: number): Entry[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad(`${what} must be a list.`);
  if (v.length > max) throw bad(`Up to ${max} ${what.toLowerCase()} entries.`);
  const latest = new Date().getUTCFullYear() + PF_YEAR_AHEAD;
  const out: Entry[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') throw bad(`${what} entries must be objects.`);
    const e = raw as Record<string, unknown>;
    const title = str(e.title, `${what} title`, PF_ENTRY_TITLE_MAX);
    const place = str(e.place, `${what} place`, PF_ENTRY_PLACE_MAX);
    const line = str(e.line, `${what} line`, PF_ENTRY_LINE_MAX);
    if (!title && !place && !line) continue; // a blank row the editor left behind
    if (!title) throw bad(`Each ${what.toLowerCase()} entry needs a title.`);
    const from = year(e.from, `${what} start year`, latest);
    const toRaw = e.to === '' ? null : e.to;
    const to = toRaw === null || toRaw === undefined ? null : year(toRaw, `${what} end year`, latest);
    if (to !== null && to < from) throw bad(`${what}: the end year is before the start year.`);
    out.push({ title, place, from, to, line });
  }
  // newest first: still there ("present") above anything finished, then by start year
  return out.sort((a, b) => (b.to ?? 9999) - (a.to ?? 9999) || b.from - a.from);
}

function links(v: unknown): PfLink[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad('Links must be a list.');
  if (v.length > PF_LINKS_MAX) throw bad(`Up to ${PF_LINKS_MAX} links.`);
  const out: PfLink[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') throw bad('Links must be objects.');
    const l = raw as Record<string, unknown>;
    const label = str(l.label, 'Link label', PF_LINK_LABEL_MAX);
    const urlText = str(l.url, 'Link', PF_LINK_URL_MAX);
    if (!label && !urlText) continue;
    if (!urlText) throw bad('Each link needs a web address.');
    let u: URL;
    try { u = new URL(urlText); } catch { throw bad(`"${urlText}" is not a web address.`); }
    if (u.protocol !== 'https:') throw bad('Links must start with https://.');
    if (u.username || u.password) throw bad('Links cannot carry a username or password.');
    out.push({ label: label || u.hostname.replace(/^www\./, ''), url: u.href });
  }
  return out;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], what: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw bad(`${what} must be one of: ${allowed.join(', ')}.`);
  return v as T;
}

/** Merge a partial body into the current fields and validate the whole thing. */
export function mergePortfolio(current: PortfolioFields, body: Record<string, unknown>): PortfolioFields {
  const has = (k: string) => body[k] !== undefined;
  const openToWork = has('openToWork') ? body.openToWork : current.openToWork;
  if (typeof openToWork !== 'boolean') throw bad('Open to work must be yes or no.');
  return {
    font: has('font') ? oneOf(body.font, PF_FONTS, 'Typeface') : current.font,
    bg: has('bg') ? oneOf(body.bg, PF_BACKGROUNDS, 'Background') : current.bg,
    accent: has('accent') ? oneOf(body.accent, PF_ACCENTS, 'Accent') : current.accent,
    headline: has('headline') ? str(body.headline, 'Headline', PF_HEADLINE_MAX) : current.headline,
    location: has('location') ? str(body.location, 'Location', PF_LOCATION_MAX) : current.location,
    openToWork,
    about: has('about') ? str(body.about, 'About', PF_ABOUT_MAX, { multiline: true }) : current.about,
    skills: has('skills') ? tags(body.skills, 'Skills') : current.skills,
    tools: has('tools') ? tags(body.tools, 'Tools') : current.tools,
    experience: has('experience') ? entries(body.experience, 'Experience', PF_EXPERIENCE_MAX) : current.experience,
    education: has('education') ? entries(body.education, 'Education', PF_EDUCATION_MAX) : current.education,
    links: has('links') ? links(body.links) : current.links,
  };
}
