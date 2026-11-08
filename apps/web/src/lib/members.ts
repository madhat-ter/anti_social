import { RULES } from '@anti/shared';
import { api, type MemberSummary } from './api';

/** Every seated member, all pages: there are at most a hundred. */
export async function loadAllMembers(): Promise<MemberSummary[]> {
  const all: MemberSummary[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const page = await api.members(cursor, 50);
    all.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return all;
}

/**
 * How many seats the room has. Admins can change the cap, so it comes from the server; the
 * shared default is only the fallback while it loads (or if the request fails).
 */
let seatCache: { at: number; p: Promise<number> } | null = null;
export function seatCapCached(): Promise<number> {
  if (!seatCache || Date.now() - seatCache.at > 60_000) {
    seatCache = { at: Date.now(), p: api.seats().then((s) => s.cap).catch(() => { seatCache = null; return RULES.seat_cap; }) };
  }
  return seatCache.p;
}

/** Shared for 60 s so the side windows don't refetch on every page change. */
let cache: { at: number; p: Promise<MemberSummary[]> } | null = null;
export function membersCached(): Promise<MemberSummary[]> {
  if (!cache || Date.now() - cache.at > 60_000) {
    const p = loadAllMembers().catch((e) => { cache = null; throw e; });
    cache = { at: Date.now(), p };
  }
  return cache.p;
}
