/**
 * Setup (RFC §10.3) and closing an account.
 * Setup: every member writes "About you" (50–300 words, the portfolio's About), picks a gender
 * (it only shapes the drawn face) and gives a birthday, once, before using the site.
 */
import { sql } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';
import {
  ABOUT_MAX_WORDS, ABOUT_MIN_WORDS, MAX_AGE, PF_ABOUT_MAX, ageOn, countWords, parseIsoDate, utcToday,
} from '@anti/shared';
import { ApiError } from './errors';
import { dropFile } from './file';
import type { Storage } from './storage';

/** Normalised "About you" text, or a 400 that says what is wrong. */
export function checkAbout(v: unknown, code = 'about_invalid'): string {
  if (typeof v !== 'string') throw new ApiError(400, code, 'Write a few words about yourself.');
  const s = v.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const n = countWords(s);
  if (n < ABOUT_MIN_WORDS || n > ABOUT_MAX_WORDS) {
    throw new ApiError(400, code, `Write ${ABOUT_MIN_WORDS} to ${ABOUT_MAX_WORDS} words about yourself (this has ${n}).`);
  }
  if (s.length > PF_ABOUT_MAX) throw new ApiError(400, code, `That is too long: at most ${PF_ABOUT_MAX} characters.`);
  return s;
}

/** A birthday (YYYY-MM-DD) that is a real date, not in the future, and not over MAX_AGE; with the age today (UTC). */
export function checkBirthday(v: unknown): { iso: string; age: number } {
  const iso = typeof v === 'string' ? v.trim() : '';
  const age = parseIsoDate(iso) ? ageOn(iso, utcToday()) : null;
  if (age === null) throw new ApiError(400, 'birthday_invalid', 'Give your birthday as a date, like 2001-03-17.');
  if (age < 0) throw new ApiError(400, 'birthday_invalid', 'That date is in the future.');
  if (age > MAX_AGE) throw new ApiError(400, 'birthday_invalid', `That makes you ${age}. Check the year.`);
  return { iso, age };
}

/**
 * Close an account: the portfolio and projects (with their images) are removed, then
 * delete_account() frees the seat and strips the row of identity (handle, name, gender,
 * birthday...). Posts stay as "deleted user" so threads still read. `reason` goes to the state log.
 */
export async function closeAccount(db: Db, storage: Storage, userId: string, reason: 'self_delete' | 'underage', actorId: string | null) {
  const keys = await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const imgs = await rows<{ k: string }>(tx, sql`
      delete from project_images where project_id in (select id from projects where user_id = ${userId}::uuid) returning r2_key as k`);
    await tx.execute(sql`delete from projects where user_id = ${userId}::uuid`);
    const cover = await rows<{ k: string | null }>(tx, sql`delete from portfolios where user_id = ${userId}::uuid returning cover_key as k`);
    // RFC §10.22: a voice is the person: their monologues leave with them (sound erased, posts
    // deleted like an author delete, so replies to them still read), and waiting recordings too
    await tx.execute(sql`
      update posts set deleted_at = now(), body = ''
       where author_id = ${userId}::uuid and deleted_at is null
         and exists (select 1 from monologues m where m.post_id = posts.id)`);
    await tx.execute(sql`delete from contributions where user_id = ${userId}::uuid and ref_id in (select post_id from monologues where uploader_id = ${userId}::uuid and post_id is not null)`);
    const sounds = await rows<{ k: string }>(tx, sql`delete from monologues where uploader_id = ${userId}::uuid returning audio_key as k`);
    // RFC §10.24: the File goes too: the member's cards, cards made for them, cards they made for others
    const filePhotos = await dropFile(tx, userId);
    await tx.execute(sql`select delete_account(${userId}::uuid, ${reason}, ${actorId}::uuid)`);
    return [...filePhotos, ...imgs.map((r) => r.k), ...cover.map((r) => r.k).filter((k): k is string => !!k), ...sounds.map((r) => r.k)];
  });
  await Promise.all(keys.map((k) => storage.delete(k).catch((e) => console.error('storage delete failed', k, e))));
}
