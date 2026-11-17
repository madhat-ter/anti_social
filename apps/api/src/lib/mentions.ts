import { sql } from 'drizzle-orm';
import { notifications, rows, type Db } from '@anti/db';

/**
 * RFC §10.16: @mentions. The post body stays plain text; the handles that really belong to a
 * seated member are written to `post_mentions` when the post is saved. That keeps links correct
 * after a handle change, lets an edit diff old against new, and records notifications once.
 */
export const MENTIONS_MAX = 10;

/** `@handle` tokens in order, unique, lowercased. A word before the @ (an email) does not count. */
export function mentionsIn(body: string): string[] {
  const found: string[] = [];
  for (const m of body.matchAll(/(?<![\w@])@([a-zA-Z][a-zA-Z0-9_]{2,19})/g)) {
    const h = m[1]!.toLowerCase();
    if (!found.includes(h)) found.push(h);
  }
  return found;
}

type Mentioned = { id: string; handle: string };

/** The seated members among `handles` (self excluded), in the order they were written, max 10. */
export async function resolveMentionUsers(db: Db, handles: string[], selfId: string): Promise<Mentioned[]> {
  if (!handles.length) return [];
  const states = sql.join(['active', 'flagged_lurker'].map((s) => sql`${s}`), sql`, `);
  // handles are [a-z0-9_] only, so they can be sent as one array literal
  const arr = `{${handles.join(',')}}`;
  return rows<Mentioned>(db, sql`
    select u.id, u.handle
      from users u
     where lower(u.handle) = any(${arr}::text[])
       and u.id <> ${selfId}::uuid
       and u.state in (${states})
     order by array_position(${arr}::text[], lower(u.handle))
     limit ${MENTIONS_MAX}`);
}

/** User ids already recorded as mentioned on a post. */
export async function mentionIds(db: Db, postId: string): Promise<string[]> {
  const found = await rows<{ user_id: string }>(db, sql`
    select user_id from post_mentions where post_id = ${postId}::uuid`);
  return found.map((r) => r.user_id);
}

export async function addMentions(db: Db, postId: string, userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    await db.execute(sql`
      insert into post_mentions(post_id, user_id) values (${postId}::uuid, ${userId}::uuid)
      on conflict do nothing`);
  }
}

export async function removeMentions(db: Db, postId: string, userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    await db.execute(sql`delete from post_mentions where post_id = ${postId}::uuid and user_id = ${userId}::uuid`);
  }
}

/**
 * One in-app notification per mentioned person, unless they are the actor or were already told
 * about this post (the thread's parent author gets the reply notification instead).
 */
export async function notifyMentions(
  db: Db,
  opts: { postId: string; rootId: string | null; actorId: string; userIds: string[]; skip?: string | null },
): Promise<void> {
  for (const userId of opts.userIds) {
    if (userId === opts.actorId || userId === opts.skip) continue;
    await db.insert(notifications).values({
      userId,
      kind: 'mention',
      payload: { postId: opts.postId, rootId: opts.rootId, actorId: opts.actorId },
    });
  }
}
