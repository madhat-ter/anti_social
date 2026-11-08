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

/**
 * Reports on a portfolio project: the same rule as posts. Drafts cannot be reported (nobody but
 * the owner can see them), and neither can your own project.
 */
export async function flagProject(db: Db, userId: string, projectId: string, reason: string | undefined) {
  return db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const [p] = await rows<{ user_id: string; hidden: boolean }>(tx, sql`
      select user_id, (hidden_at is not null) as hidden from projects
       where id = ${projectId}::uuid and draft = false for update`);
    if (!p) throw new ApiError(404, 'not_found');
    if (p.user_id === userId) throw new ApiError(409, 'own_project', 'You cannot report your own project.');
    await tx.execute(sql`
      insert into project_flags(user_id, project_id, reason) values (${userId}::uuid, ${projectId}::uuid, ${reason?.trim().slice(0, REASON_MAX) || null})
      on conflict do nothing`);
    const open = Number(await scalar<number>(tx, sql`
      select count(*)::int from project_flags where project_id = ${projectId}::uuid and resolved_at is null`));
    let hidden = !!p.hidden;
    if (!hidden && open >= FLAG_HIDE_THRESHOLD) {
      await tx.execute(sql`update projects set hidden_at = now() where id = ${projectId}::uuid`);
      await tx.execute(sql`
        insert into notifications(user_id, kind, payload)
        select id, 'flag_threshold', ${JSON.stringify({ projectId })}::jsonb from users where role = 'ops' and state <> 'deleted'`);
      hidden = true;
    }
    return { flagged: true as const, hidden };
  });
}

export type FlagQueueItem = {
  kind: 'post' | 'project';
  /** the reported post, for kind 'post' */
  postId?: string;
  /** the reported project, for kind 'project' */
  projectId?: string;
  /** the post body, or the project's title and summary */
  body: string; author: string | null; hidden: boolean; flags: number;
  reasons: string[]; firstFlaggedAt: string;
};

/** Posts and projects with unresolved flags, hidden ones first. */
export async function flagQueue(db: Db): Promise<FlagQueueItem[]> {
  const r = await rows<any>(db, sql`
    select * from (
      select 'post' as kind, p.id, p.body, u.handle, (p.hidden_at is not null) as hidden, count(*)::int as n,
             coalesce(array_agg(f.reason) filter (where f.reason is not null), '{}') as reasons,
             min(f.created_at) as first_at
        from flags f join posts p on p.id = f.post_id left join users u on u.id = p.author_id
       where f.resolved_at is null and p.deleted_at is null
       group by p.id, u.handle
      union all
      select 'project' as kind, pr.id, pr.title || case when pr.summary <> '' then ' — ' || pr.summary else '' end as body,
             u.handle, (pr.hidden_at is not null) as hidden, count(*)::int as n,
             coalesce(array_agg(f.reason) filter (where f.reason is not null), '{}') as reasons,
             min(f.created_at) as first_at
        from project_flags f join projects pr on pr.id = f.project_id left join users u on u.id = pr.user_id
       where f.resolved_at is null
       group by pr.id, u.handle
    ) q
    order by hidden desc, n desc, first_at
    limit 200`);
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
  return r.map((x) => ({
    kind: x.kind, ...(x.kind === 'post' ? { postId: x.id } : { projectId: x.id }),
    body: x.body, author: x.handle, hidden: !!x.hidden, flags: Number(x.n),
    reasons: Array.isArray(x.reasons) ? x.reasons : [], firstFlaggedAt: iso(x.first_at),
  }));
}

const dropFiles = (storage: Storage, keys: string[]) =>
  Promise.all(keys.map((k) => storage.delete(k).catch((e) => console.error('storage delete failed', k, e))));

/**
 * A moderator removes a project (inside the caller's transaction): its images and the project go
 * for good (there is no tombstone to keep a place in a numbered list), open reports are closed,
 * and the owner is told unless the moderator removed their own. Returns image keys to delete.
 */
async function moderatorDeleteProject(tx: Db, p: { id: string; user_id: string; title: string }, actorId: string | null) {
  await tx.execute(sql`update project_flags set resolved_at = now(), resolution = 'removed'
    where project_id = ${p.id}::uuid and resolved_at is null`);
  const gone = await rows<{ r2_key: string }>(tx, sql`delete from project_images where project_id = ${p.id}::uuid returning r2_key`);
  if (p.user_id !== actorId) {
    await tx.execute(sql`insert into notifications(user_id, kind, payload)
      values (${p.user_id}::uuid, 'project_removed', ${JSON.stringify({ projectId: p.id, title: p.title })}::jsonb)`);
  }
  await tx.execute(sql`delete from projects where id = ${p.id}::uuid`);
  return gone.map((g) => g.r2_key);
}

/**
 * A moderator removes a post (inside the caller's transaction): soft-deleted like an author
 * delete (body cleared, images dropped, contribution taken back), open reports closed, and the
 * author told unless it is the moderator's own. Returns image keys to delete.
 */
async function moderatorDeletePost(tx: Db, p: { id: string; author_id: string | null }, actorId: string | null) {
  await tx.execute(sql`update flags set resolved_at = now(), resolution = 'removed'
    where post_id = ${p.id}::uuid and resolved_at is null`);
  await tx.execute(sql`update posts set deleted_at = now(), body = '', hidden_at = null where id = ${p.id}::uuid`);
  await tx.execute(sql`delete from contributions where ref_id = ${p.id}::uuid and kind in ('post', 'reply')`);
  if (p.author_id && p.author_id !== actorId) {
    await tx.execute(sql`insert into notifications(user_id, kind, payload)
      values (${p.author_id}::uuid, 'post_removed', ${JSON.stringify({ postId: p.id })}::jsonb)`);
  }
  const gone = await rows<{ r2_key: string }>(tx, sql`delete from post_images where post_id = ${p.id}::uuid returning r2_key`);
  return gone.map((g) => g.r2_key);
}

/** 'restored': unhide, close the reports. 'removed': see moderatorDeleteProject. */
export async function resolveProjectFlags(db: Db, storage: Storage, projectId: string, resolution: 'restored' | 'removed') {
  const keys = await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const [p] = await rows<{ id: string; user_id: string; title: string }>(tx, sql`
      select id, user_id, title from projects where id = ${projectId}::uuid for update`);
    if (!p) throw new ApiError(404, 'not_found');
    const closed = await rows(tx, sql`
      update project_flags set resolved_at = now(), resolution = ${resolution}
       where project_id = ${projectId}::uuid and resolved_at is null returning 1`);
    if (!closed.length) throw new ApiError(409, 'no_open_flags', 'This project has no open reports.');
    if (resolution === 'restored') {
      await tx.execute(sql`update projects set hidden_at = null where id = ${projectId}::uuid`);
      return [] as string[];
    }
    return moderatorDeleteProject(tx, p, null);
  });
  await dropFiles(storage, keys);
  return { resolution };
}

/** 'restored': unhide, close the flags. 'removed': see moderatorDeletePost. */
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
    return moderatorDeletePost(tx, p, null);
  });
  await dropFiles(storage, keys);
  return { resolution };
}

/** A moderator removes any post directly, reported or not. */
export async function removePost(db: Db, storage: Storage, postId: string, actorId: string) {
  const keys = await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const [p] = await rows<{ id: string; author_id: string | null; deleted: boolean }>(tx, sql`
      select id, author_id, (deleted_at is not null) as deleted from posts where id = ${postId}::uuid for update`);
    if (!p || p.deleted) throw new ApiError(404, 'not_found');
    return moderatorDeletePost(tx, p, actorId);
  });
  await dropFiles(storage, keys);
  return { removed: true as const };
}

/** A moderator removes any project directly, reported or not. Drafts are the owner's alone: 404. */
export async function removeProject(db: Db, storage: Storage, projectId: string, actorId: string) {
  const keys = await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const [p] = await rows<{ id: string; user_id: string; title: string; draft: boolean }>(tx, sql`
      select id, user_id, title, draft from projects where id = ${projectId}::uuid for update`);
    if (!p || (p.draft && p.user_id !== actorId)) throw new ApiError(404, 'not_found');
    return moderatorDeleteProject(tx, p, actorId);
  });
  await dropFiles(storage, keys);
  return { removed: true as const };
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
