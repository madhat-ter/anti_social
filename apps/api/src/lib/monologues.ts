/**
 * RFC §10.22, monologues: a post that is a recording (a song, a thought, a yap), drawn as a
 * cassette. The sound is uploaded first and waits (post_id null) until it is posted with a title
 * and a kind; the post itself holds the note, the likes and the replies, like any other post.
 */
import { sql, type SQL } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';
import { FEED, MONOLOGUE, MONOLOGUE_KINDS, type MonologueKind } from '@anti/shared';
import { ApiError } from './errors';
import { FEED_WHERE, type FeedVisit } from './feed';
import { TS_RE } from './posts';

/**
 * What the bytes really are, from their first bytes (never from the name or the browser's word):
 * WebM (Chrome, Firefox, new Safari), MP4/M4A (Safari, phones), Ogg, MP3.
 */
export function sniffAudio(b: Uint8Array): { type: string; ext: string } | null {
  if (b.length < 12) return null;
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { type: 'audio/webm', ext: 'webm' };
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return { type: 'audio/ogg', ext: 'ogg' };
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return { type: 'audio/mp4', ext: 'm4a' };
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return { type: 'audio/mpeg', ext: 'mp3' };
  if (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return { type: 'audio/mpeg', ext: 'mp3' };
  return null;
}

/**
 * The length the browser measured. The server cannot decode audio cheaply, so it trusts the
 * number within the rule (and the file-size cap bounds what a wrong number could hide).
 */
export function checkDuration(raw: unknown): number {
  const ms = Math.round(Number(raw));
  if (!Number.isFinite(ms) || ms < MONOLOGUE.minSeconds * 1000) {
    throw new ApiError(400, 'audio_too_short', 'That recording is too short.');
  }
  // half a second of slack: a recorder stopped at 5:00 can measure 5:00.3
  if (ms > MONOLOGUE.maxSeconds * 1000 + 500) {
    throw new ApiError(400, 'audio_too_long', `A monologue is at most ${MONOLOGUE.maxSeconds / 60} minutes.`);
  }
  return Math.min(ms, MONOLOGUE.maxSeconds * 1000);
}

/** The waveform: exactly MONOLOGUE.peaks whole numbers 0..100 (a bad list becomes a flat line). */
export function checkPeaks(raw: unknown): number[] {
  let list: unknown = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch { list = null; } }
  if (!Array.isArray(list) || list.length === 0) return Array(MONOLOGUE.peaks).fill(20);
  const out: number[] = [];
  for (let i = 0; i < MONOLOGUE.peaks; i++) {
    const v = Number(list[Math.floor((i * list.length) / MONOLOGUE.peaks)]);
    out.push(Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0);
  }
  return out;
}

export function checkTitle(raw: unknown): string {
  const t = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!t) throw new ApiError(400, 'title_invalid', 'Give it a title.');
  if (Array.from(t).length > MONOLOGUE.titleMax) {
    throw new ApiError(400, 'title_invalid', `Titles are at most ${MONOLOGUE.titleMax} characters.`);
  }
  return t;
}

export function checkKind(raw: unknown): MonologueKind {
  if (!MONOLOGUE_KINDS.includes(raw as MonologueKind)) throw new ApiError(400, 'kind_invalid', 'Choose Song, Thought or Yap.');
  return raw as MonologueKind;
}

/** Feed posts that are monologues, optionally of one kind. */
export const MONOLOGUE_WHERE = (kind?: MonologueKind, p = 'p'): SQL => sql`${FEED_WHERE(p)} and exists (
  select 1 from monologues mo2 where mo2.post_id = ${sql.raw(p)}.id ${kind ? sql`and mo2.kind = ${kind}` : sql``})`;

/** Removes the recordings of these posts (inside the caller's transaction) and returns their keys. */
export async function dropAudio(tx: Db, postIds: string[]): Promise<string[]> {
  if (!postIds.length) return [];
  const gone = await rows<{ k: string }>(tx, sql`
    delete from monologues where post_id in (${sql.join(postIds.map((id) => sql`${id}::uuid`), sql`, `)})
    returning audio_key as k`);
  return gone.map((g) => g.k);
}

const iso = (col: SQL) => sql`to_char((${col}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const windowStart = sql`(now() - make_interval(days => ${FEED.newWindowDays}::int))`;
const empty = { visitId: null, threads: [], events: [], nextEvent: null } as const;

/**
 * The Monologue page's "new since" line (RFC §10.22 follows §10.11): where this member last
 * reached the end of it, never further back than a week. `since` resumes a line after a reload.
 * Nothing is logged: the feed's visit log is the feed's.
 */
export async function monologueVisit(db: Db, viewerId: string, visitor: boolean, since?: string): Promise<FeedVisit> {
  if (since !== undefined && !TS_RE.test(since)) throw new ApiError(400, 'bad_request', 'since must be a timestamp.');
  const line = since !== undefined
    ? sql`least(greatest(${since}::timestamptz, ${windowStart}), now())`
    : visitor
      ? windowStart
      : sql`greatest(coalesce((select monologues_seen_through from users where id = ${viewerId}::uuid), '-infinity'::timestamptz), ${windowStart})`;
  const [r] = await rows<{ since: string; capped: boolean; n: number }>(db, sql`
    with s as (select ${line} as since)
    select ${iso(sql`s.since`)} as since, s.since <= ${windowStart} as capped,
           (select count(*)::int from posts p
             where ${MONOLOGUE_WHERE()} and p.created_at > s.since and p.author_id is distinct from ${viewerId}::uuid) as n
      from s`);
  return { since: r!.since, capped: !!r!.capped, newPosts: Number(r!.n), ...empty, threads: [], events: [] };
}

/** The end card was on screen: monologues up to `through` count as heard. Only ever forward. */
export async function monologuesCaughtUp(db: Db, viewerId: string, through: string) {
  if (!TS_RE.test(through)) throw new ApiError(400, 'bad_request', 'through must be a timestamp.');
  await db.execute(sql`
    update users
       set monologues_seen_through = greatest(coalesce(monologues_seen_through, '-infinity'::timestamptz), least(${through}::timestamptz, now()))
     where id = ${viewerId}::uuid`);
  return { ok: true as const };
}
