import { sql } from 'drizzle-orm';
import { rows, scalar, type Db } from '@anti/db';
import { ApiError, rethrowDb } from './errors';
import type { Storage } from './storage';

/** RFC §3: this many distinct members flagging a post hides it until ops review. */
export const FLAG_HIDE_THRESHOLD = 5;
const REASON_MAX = 200;

/** Records one member's flag; hides the post on the threshold and alerts ops. Idempotent per member. */
export async function flagPost(db: Db, userId: string, postId: string, reason: string | undefined) {
  return db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const [p] = await rows<{ author_id: string | null; hidden: boolean }>(tx, sql`
      select author_id, (hidden_at is not null) as hidden from posts
       where id = ${postId}::uuid and deleted_at is null for update`);
    if (!p) throw new ApiError(404, 'not_found');
    if (p.author_id === userId) throw new ApiError(409, 'own_post', 'You cannot report your own post.');
    await tx.execute(sql`
      insert into flags(user_id, post_id, reason) values (${userId}::uuid, ${postId}::uuid, ${reason?.trim().slice(0, REASON_MAX) || null})
      on conflict do nothing`);
    const open = Number(await scalar<number>(tx, sql`
      select count(*)::int from flags where post_id = ${postId}::uuid and resolved_at is null`));
    let hidden = !!p.hidden;
    if (!hidden && open >= FLAG_HIDE_THRESHOLD) {
      await tx.execute(sql`update posts set hidden_at = now() where id = ${postId}::uuid`);
      await tx.execute(sql`
        insert into notifications(user_id, kind, payload)
        select id, 'flag_threshold', ${JSON.stringify({ postId })}::jsonb from users where role = 'ops' and state <> 'deleted'`);
      hidden = true;
    }
    return { flagged: true as const, hidden };
  });
}

export type FlagQueueItem = {
  postId: string; body: string; author: string | null; hidden: boolean; flags: number;
  reasons: string[]; firstFlaggedAt: string;
};

/** Posts with unresolved flags, hidden ones first. */
export async function flagQueue(db: Db): Promise<FlagQueueItem[]> {
  const r = await rows<any>(db, sql`
    select p.id, p.body, u.handle, (p.hidden_at is not null) as hidden, count(*)::int as n,
           coalesce(array_agg(f.reason) filter (where f.reason is not null), '{}') as reasons,
           to_char(min(f.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as first_at
      from flags f join posts p on p.id = f.post_id left join users u on u.id = p.author_id
     where f.resolved_at is null and p.deleted_at is null
     group by p.id, u.handle
     order by (p.hidden_at is not null) desc, count(*) desc, min(f.created_at)
     limit 200`);
  return r.map((x) => ({
    postId: x.id, body: x.body, author: x.handle, hidden: !!x.hidden, flags: Number(x.n),
    reasons: Array.isArray(x.reasons) ? x.reasons : [], firstFlaggedAt: x.first_at,
  }));
}

/**
 * 'restored': unhide, close the flags. 'removed': soft-delete like an author delete (body
 * cleared, images dropped, contribution taken back) and close the flags.
 */
export async function resolveFlags(db: Db, storage: Storage, postId: string, resolution: 'restored' | 'removed') {
  const keys = await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const [p] = await rows<{ id: string; author_id: string | null }>(tx, sql`
      select id, author_id from posts where id = ${postId}::uuid for update`);
    if (!p) throw new ApiError(404, 'not_found');
    const closed = await rows(tx, sql`
      update flags set resolved_at = now(), resolution = ${resolution}
       where post_id = ${postId}::uuid and resolved_at is null returning 1`);
    if (!closed.length) throw new ApiError(409, 'no_open_flags', 'This post has no open reports.');
    if (resolution === 'restored') {
      await tx.execute(sql`update posts set hidden_at = null where id = ${postId}::uuid`);
      return [] as string[];
    }
    await tx.execute(sql`update posts set deleted_at = now(), body = '', hidden_at = null where id = ${postId}::uuid`);
    await tx.execute(sql`delete from contributions where ref_id = ${postId}::uuid and kind in ('post', 'reply')`);
    if (p.author_id) {
      await tx.execute(sql`insert into notifications(user_id, kind, payload)
        values (${p.author_id}::uuid, 'post_removed', ${JSON.stringify({ postId })}::jsonb)`);
    }
    const gone = await rows<{ r2_key: string }>(tx, sql`delete from post_images where post_id = ${postId}::uuid returning r2_key`);
    return gone.map((g) => g.r2_key);
  });
  await Promise.all(keys.map((k) => storage.delete(k).catch((e) => console.error('storage delete failed', k, e))));
  return { resolution };
}

export async function userIdByHandle(db: Db, handle: string): Promise<{ id: string; role: string; state: string }> {
  const [u] = await rows<{ id: string; role: string; state: string }>(db, sql`
    select id, role, state from users where lower(handle) = lower(${handle})`);
  if (!u) throw new ApiError(404, 'not_found', `No member @${handle}.`);
  return u;
}

/** RFC §8.2 ban_user: frees the seat, revokes sessions/invites, penalises the inviter. */
export async function banUser(db: Db, handle: string, actorId: string | null) {
  const u = await userIdByHandle(db, handle);
  if (u.role === 'ops') throw new ApiError(409, 'cannot_ban_ops', 'Remove the ops role first.');
  if (u.state === 'banned' || u.state === 'deleted') throw new ApiError(409, 'already_gone', `@${handle} is already ${u.state}.`);
  try {
    await db.execute(sql`select ban_user(${u.id}::uuid, ${actorId}::uuid)`);
  } catch (e) {
    rethrowDb(e);
  }
  return { banned: handle };
}

export async function setOps(db: Db, handle: string, on: boolean) {
  const u = await userIdByHandle(db, handle);
  await db.execute(sql`update users set role = ${on ? 'ops' : 'member'}::user_role where id = ${u.id}::uuid`);
  return { handle, role: on ? 'ops' : 'member' };
}
