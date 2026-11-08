/**
 * Collabs (RFC §10.5): ongoing projects members do together. A host (plus co-hosts) runs it;
 * people join directly ("open") or ask and get accepted ("approve"); hosts invite people whose
 * interests match. Recruiting → closed (team set, still working) → finished.
 * Anti never handles money: a price/donation note and an outside link at most.
 */
import { sql, type SQL } from 'drizzle-orm';
import { rows, scalar, type Db } from '@anti/db';
import {
  COLLAB_DESCRIPTION_MAX, COLLAB_HOSTING_MAX, COLLAB_INTERESTS_MAX, COLLAB_INVITES_MAX, COLLAB_NOTE_MAX,
  COLLAB_PRICE_NOTE_MAX, COLLAB_REQUIREMENTS_MAX, COLLAB_ROLE_MAX, COLLAB_ROLES_MAX, COLLAB_STATUSES,
  COLLAB_TEAM_MAX, COLLAB_TEAM_MIN, COLLAB_TITLE_MAX, PROJECTS_MAX, PROJECT_SUMMARY_MAX, type CollabStatus,
} from '@anti/shared';
import { ApiError } from './errors';
import { listPosts, mediaUrl, UUID_RE } from './posts';
import { hit } from './ratelimit';
import type { Storage } from './storage';

export type Person = { handle: string; displayName: string; gender: string | null };
export type CollabRole = 'host' | 'cohost' | 'member';
export type CollabSummary = {
  id: string; title: string; status: CollabStatus; joinMode: 'open' | 'approve';
  interests: string[]; roles: string[]; teamCount: number; teamMax: number;
  host: Person | null; cover: { url: string; width: number; height: number } | null;
  /** interests shared with the viewer */
  match: number;
  my: { role: CollabRole | null; request: 'pending' | 'declined' | null; invited: boolean };
  createdAt: string;
};
export type Collab = CollabSummary & {
  description: string; requirements: string; priceNote: string | null; paymentUrl: string | null;
  team: (Person & { role: CollabRole; joinedAt: string })[];
  canManage: boolean;
  /** managers only */
  requests: (Person & { note: string | null; at: string })[] | null;
  invites: Person[] | null;
  /** hidden after reports (only the team and admins ever get true) */
  hidden: boolean;
  canReport: boolean;
  /** the viewer is an admin: can remove it */
  canModerate: boolean;
  /** meetups the viewer can see, soonest upcoming first, then past */
  meetups: Meetup[];
};
export type Meetup = { id: string; title: string; startsAt: string; audience: 'anyone' | 'team'; goingCount: number; past: boolean };

const iso = (col: SQL) => sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const LIVE = sql`('banned', 'deleted')`;
const bad = (detail: string) => new ApiError(400, 'collab_invalid', detail);

type Row = {
  id: string; title: string; status: CollabStatus; join_mode: 'open' | 'approve'; roles: unknown; team_max: number;
  cover_key: string | null; cover_width: number | null; cover_height: number | null; created_iso: string;
  description: string; requirements: string; price_note: string | null; payment_url: string | null;
  interests: string[] | null; team_count: number; h_handle: string | null; h_display: string | null; h_gender: string | null;
  match: number; my_role: CollabRole | null; my_request: string | null; my_invited: boolean;
  hidden: boolean; viewer_ops: boolean;
};

const select = (me: string) => sql`
  select c.id, c.title, c.status, c.join_mode, c.roles, c.team_max, c.cover_key, c.cover_width, c.cover_height,
    ${iso(sql`c.created_at`)} as created_iso, c.description, c.requirements, c.price_note, c.payment_url,
    array(select ci.interest from collab_interests ci where ci.collab_id = c.id order by ci.interest) as interests,
    (select count(*)::int from collab_members m join users mu on mu.id = m.user_id and mu.state not in ${LIVE}
      where m.collab_id = c.id) as team_count,
    h.handle as h_handle, h.display_name as h_display, h.gender as h_gender,
    (select count(*)::int from collab_interests ci join user_interests ui on ui.interest = ci.interest
      where ci.collab_id = c.id and ui.user_id = ${me}::uuid) as match,
    (select m.role from collab_members m where m.collab_id = c.id and m.user_id = ${me}::uuid) as my_role,
    (select r.status from collab_requests r where r.collab_id = c.id and r.user_id = ${me}::uuid) as my_request,
    exists (select 1 from collab_invites i where i.collab_id = c.id and i.user_id = ${me}::uuid and i.status = 'pending') as my_invited,
    (c.hidden_at is not null) as hidden,
    exists (select 1 from users v where v.id = ${me}::uuid and v.role = 'ops') as viewer_ops
  from collabs c
  left join collab_members hm on hm.collab_id = c.id and hm.role = 'host'
  left join users h on h.id = hm.user_id and h.state not in ${LIVE}
  where c.deleted_at is null
    -- hidden after reports: only the team and admins see it until ops decide (RFC §10.5)
    and (c.hidden_at is null or exists (select 1 from collab_members m where m.collab_id = c.id and m.user_id = ${me}::uuid)
         or exists (select 1 from users v where v.id = ${me}::uuid and v.role = 'ops'))`;

const json = <T,>(v: unknown, d: T): T => (v == null ? d : typeof v === 'string' ? JSON.parse(v) as T : v as T);

function toSummary(r: Row): CollabSummary {
  return {
    id: r.id, title: r.title, status: r.status, joinMode: r.join_mode,
    interests: r.interests ?? [], roles: json<string[]>(r.roles, []), teamCount: Number(r.team_count), teamMax: Number(r.team_max),
    host: r.h_handle ? { handle: r.h_handle, displayName: r.h_display ?? r.h_handle, gender: r.h_gender } : null,
    cover: r.cover_key ? { url: mediaUrl(r.cover_key), width: r.cover_width ?? 0, height: r.cover_height ?? 0 } : null,
    match: Number(r.match),
    my: {
      role: r.my_role,
      request: r.my_request === 'pending' || r.my_request === 'declined' ? r.my_request : null,
      invited: !!r.my_invited,
    },
    createdAt: r.created_iso,
  };
}

/** "For you": recruiting, sharing an interest with you, best match first. "All": everything, recruiting first. */
export async function listCollabs(db: Db, me: string, opts: { tab: 'for-you' | 'all'; interest?: string }): Promise<CollabSummary[]> {
  const filter = opts.interest ? sql`and exists (select 1 from collab_interests ci where ci.collab_id = q.id and ci.interest = ${opts.interest})` : sql``;
  const r = opts.tab === 'for-you'
    ? await rows<Row>(db, sql`select * from (${select(me)}) q where q.status = 'recruiting' and q.match > 0 ${filter}
        order by q.match desc, q.created_iso desc limit 100`)
    : await rows<Row>(db, sql`select * from (${select(me)}) q where true ${filter}
        order by (q.status = 'recruiting') desc, (q.status = 'finished'), q.created_iso desc limit 100`);
  return r.map(toSummary);
}

/** The collabs a member hosts or is on. */
export async function memberCollabs(db: Db, me: string, handle: string): Promise<CollabSummary[]> {
  const r = await rows<Row>(db, sql`select * from (${select(me)}) q
    where exists (select 1 from collab_members m join users u on u.id = m.user_id
                   where m.collab_id = q.id and lower(u.handle) = lower(${handle}))
    order by (q.status = 'finished'), q.created_iso desc limit 100`);
  return r.map(toSummary);
}

async function load(db: Db, me: string, id: string): Promise<Row> {
  if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found');
  const [r] = await rows<Row>(db, sql`${select(me)} and c.id = ${id}::uuid`);
  if (!r) throw new ApiError(404, 'not_found');
  return r;
}

const canManage = (r: Row) => r.my_role === 'host' || r.my_role === 'cohost';
function requireManager(r: Row) {
  if (!canManage(r)) throw new ApiError(403, 'not_host', 'Only the host and co-hosts can do that.');
}

export async function getCollab(db: Db, me: string, id: string): Promise<Collab> {
  const r = await load(db, me, id);
  const team = await rows<{ handle: string; display_name: string; gender: string | null; role: CollabRole; joined: string }>(db, sql`
    select u.handle, u.display_name, u.gender, m.role, ${iso(sql`m.joined_at`)} as joined
      from collab_members m join users u on u.id = m.user_id and u.state not in ${LIVE}
     where m.collab_id = ${r.id}::uuid
     order by case m.role when 'host' then 0 when 'cohost' then 1 else 2 end, m.joined_at`);
  const manage = canManage(r);
  let requests: Collab['requests'] = null;
  let invites: Collab['invites'] = null;
  if (manage) {
    requests = (await rows<{ handle: string; display_name: string; gender: string | null; note: string | null; at: string }>(db, sql`
      select u.handle, u.display_name, u.gender, q.note, ${iso(sql`q.created_at`)} as at
        from collab_requests q join users u on u.id = q.user_id and u.state not in ${LIVE}
       where q.collab_id = ${r.id}::uuid and q.status = 'pending' order by q.created_at`))
      .map((x) => ({ handle: x.handle, displayName: x.display_name, gender: x.gender, note: x.note, at: x.at }));
    invites = (await rows<{ handle: string; display_name: string; gender: string | null }>(db, sql`
      select u.handle, u.display_name, u.gender
        from collab_invites i join users u on u.id = i.user_id and u.state not in ${LIVE}
       where i.collab_id = ${r.id}::uuid and i.status = 'pending' order by i.created_at`))
      .map((x) => ({ handle: x.handle, displayName: x.display_name, gender: x.gender }));
  }
  const meetups = await rows<{ id: string; title: string; starts: string; audience: 'anyone' | 'team'; going: number; past: boolean }>(db, sql`
    select e.id, e.title, ${iso(sql`e.starts_at`)} as starts, e.audience, (e.starts_at < now() - interval '3 hours') as past,
      (select count(*)::int from event_rsvps x where x.event_id = e.id and x.status = 'going') as going
      from events e where e.collab_id = ${r.id}::uuid and e.cancelled_at is null and (e.audience = 'anyone' or ${!!r.my_role})
     order by (e.starts_at < now() - interval '3 hours'), case when e.starts_at >= now() - interval '3 hours' then e.starts_at end asc, e.starts_at desc
     limit 50`);
  return {
    ...toSummary(r), description: r.description, requirements: r.requirements, priceNote: r.price_note, paymentUrl: r.payment_url,
    team: team.map((t) => ({ handle: t.handle, displayName: t.display_name, gender: t.gender, role: t.role, joinedAt: t.joined })),
    canManage: manage, requests, invites,
    hidden: !!r.hidden, canReport: !r.my_role && !r.hidden, canModerate: !!r.viewer_ops,
    meetups: meetups.map((m) => ({ id: m.id, title: m.title, startsAt: m.starts, audience: m.audience, goingCount: Number(m.going), past: !!m.past })),
  };
}

// ─── Writing ────────────────────────────────────────────────────────────────

type Fields = {
  title: string; description: string; requirements: string; roles: string[]; teamMax: number;
  joinMode: 'open' | 'approve'; priceNote: string | null; paymentUrl: string | null; interests: string[];
};

const text = (v: unknown, what: string, max: number, multiline = false): string => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw bad(`${what} must be text.`);
  const s = (multiline ? v.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : v.replace(/\s+/g, ' ')).trim();
  if (s.length > max) throw bad(`${what} can be at most ${max} characters.`);
  return s;
};

async function checkFields(db: Db, body: Record<string, unknown>, current?: Fields): Promise<Fields> {
  const has = (k: string) => body[k] !== undefined;
  const title = has('title') ? text(body.title, 'Title', COLLAB_TITLE_MAX) : current?.title ?? '';
  if (!title) throw bad('Give it a title.');
  const roles = has('roles') ? body.roles : current?.roles ?? [];
  if (!Array.isArray(roles) || roles.length > COLLAB_ROLES_MAX) throw bad(`Up to ${COLLAB_ROLES_MAX} roles.`);
  const cleanRoles = [...new Set(roles.map((x) => text(x, 'A role', COLLAB_ROLE_MAX)).filter(Boolean))];
  const teamMax = has('teamMax') ? Number(body.teamMax) : current?.teamMax ?? 0;
  if (!Number.isInteger(teamMax) || teamMax < COLLAB_TEAM_MIN || teamMax > COLLAB_TEAM_MAX) {
    throw bad(`The team is ${COLLAB_TEAM_MIN} to ${COLLAB_TEAM_MAX} people, you included.`);
  }
  const joinMode = has('joinMode') ? body.joinMode : current?.joinMode ?? 'approve';
  if (joinMode !== 'open' && joinMode !== 'approve') throw bad('Joining is "open" or "approve".');
  const interests = has('interests') ? body.interests : current?.interests ?? [];
  if (!Array.isArray(interests) || interests.length < 1 || interests.length > COLLAB_INTERESTS_MAX) {
    throw bad(`Pick 1 to ${COLLAB_INTERESTS_MAX} interests.`);
  }
  const picked = [...new Set(interests.map(String))];
  const known = Number(await scalar(db, sql`select count(*)::int from interests where slug in (${sql.join(picked.map((s) => sql`${s}`), sql`, `)})`));
  if (known !== picked.length) throw bad('One of those interests does not exist.');
  const priceNote = (has('priceNote') ? text(body.priceNote, 'The price note', COLLAB_PRICE_NOTE_MAX) : current?.priceNote ?? '') || null;
  const urlText = (has('paymentUrl') ? text(body.paymentUrl, 'The payment link', 500) : current?.paymentUrl ?? '') || null;
  if (urlText) {
    let u: URL;
    try { u = new URL(urlText); } catch { throw bad('The payment link is not a web address.'); }
    if (u.protocol !== 'https:' || u.username || u.password) throw bad('The payment link must start with https://.');
  }
  return {
    title, roles: cleanRoles, teamMax, joinMode, interests: picked, priceNote, paymentUrl: urlText,
    description: has('description') ? text(body.description, 'The description', COLLAB_DESCRIPTION_MAX, true) : current?.description ?? '',
    requirements: has('requirements') ? text(body.requirements, 'The requirements', COLLAB_REQUIREMENTS_MAX, true) : current?.requirements ?? '',
  };
}

async function saveInterests(tx: Db, id: string, slugs: string[]) {
  await tx.execute(sql`delete from collab_interests where collab_id = ${id}::uuid`);
  for (const s of slugs) await tx.execute(sql`insert into collab_interests (collab_id, interest) values (${id}::uuid, ${s})`);
}

/** `coverId`: one of your pending uploads (moved in), null = remove, undefined = keep. Returns the old blob key. */
async function saveCover(tx: Db, id: string, me: string, coverId: unknown): Promise<string | null> {
  if (coverId === undefined) return null;
  const [old] = await rows<{ cover_key: string | null }>(tx, sql`select cover_key from collabs where id = ${id}::uuid`);
  if (coverId === null) {
    await tx.execute(sql`update collabs set cover_key = null, cover_width = null, cover_height = null where id = ${id}::uuid`);
  } else {
    if (typeof coverId !== 'string' || !UUID_RE.test(coverId)) throw bad('That cover image is not valid.');
    const moved = await rows<{ id: string }>(tx, sql`
      with up as (delete from post_images where id = ${coverId}::uuid and uploader_id = ${me}::uuid and post_id is null
                  returning r2_key, width, height)
      update collabs set cover_key = up.r2_key, cover_width = up.width, cover_height = up.height
        from up where collabs.id = ${id}::uuid returning collabs.id`);
    if (moved.length !== 1) throw bad('That cover image is not available.');
  }
  return old?.cover_key ?? null;
}

export async function createCollab(db: Db, storage: Storage, me: string, body: Record<string, unknown>): Promise<Collab> {
  const f = await checkFields(db, body);
  const hosting = Number(await scalar(db, sql`
    select count(*)::int from collabs c join collab_members m on m.collab_id = c.id and m.user_id = ${me}::uuid and m.role = 'host'
     where c.deleted_at is null and c.status = 'recruiting'`));
  if (hosting >= COLLAB_HOSTING_MAX) {
    throw new ApiError(409, 'collab_limit', `You can host ${COLLAB_HOSTING_MAX} recruiting collabs at a time. Close or finish one first.`);
  }
  const id = await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const [c] = await rows<{ id: string }>(tx, sql`
      insert into collabs (title, description, requirements, roles, team_max, join_mode, price_note, payment_url)
      values (${f.title}, ${f.description}, ${f.requirements}, ${JSON.stringify(f.roles)}::jsonb, ${f.teamMax}, ${f.joinMode},
              ${f.priceNote}, ${f.paymentUrl}) returning id`);
    await tx.execute(sql`insert into collab_members (collab_id, user_id, role) values (${c!.id}::uuid, ${me}::uuid, 'host')`);
    await saveInterests(tx, c!.id, f.interests);
    await saveCover(tx, c!.id, me, body.coverId);
    return c!.id;
  });
  void storage;
  return getCollab(db, me, id);
}

export async function updateCollab(db: Db, storage: Storage, me: string, id: string, body: Record<string, unknown>): Promise<Collab> {
  const r = await load(db, me, id);
  requireManager(r);
  const f = await checkFields(db, body, {
    title: r.title, description: r.description, requirements: r.requirements, roles: json<string[]>(r.roles, []),
    teamMax: Number(r.team_max), joinMode: r.join_mode, priceNote: r.price_note, paymentUrl: r.payment_url, interests: r.interests ?? [],
  });
  if (f.teamMax < Number(r.team_count)) throw bad(`The team already has ${r.team_count} people.`);
  let status = r.status;
  if (body.status !== undefined) {
    if (!(COLLAB_STATUSES as readonly string[]).includes(String(body.status))) throw bad('Unknown status.');
    status = body.status as CollabStatus;
  }
  const old = await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const firstFinish = status === 'finished' && !!(await scalar<boolean>(tx, sql`select finished_at is null from collabs where id = ${r.id}::uuid for update`));
    await tx.execute(sql`update collabs set title = ${f.title}, description = ${f.description}, requirements = ${f.requirements},
      roles = ${JSON.stringify(f.roles)}::jsonb, team_max = ${f.teamMax}, join_mode = ${f.joinMode}, price_note = ${f.priceNote},
      payment_url = ${f.paymentUrl}, status = ${status}, updated_at = now(),
      finished_at = coalesce(finished_at, case when ${status} = 'finished' then now() end)
      where id = ${r.id}::uuid`);
    await saveInterests(tx, r.id, f.interests);
    if (firstFinish) await offerDrafts(tx, r.id, f.title, f.description);
    return saveCover(tx, r.id, me, body.coverId);
  });
  if (old && body.coverId !== undefined) await storage.delete(old).catch((e) => console.error('storage delete failed', old, e));
  return getCollab(db, me, r.id);
}

export async function deleteCollab(db: Db, me: string, id: string, asAdmin = false) {
  const r = await load(db, me, id);
  if (r.my_role !== 'host' && !asAdmin) throw new ApiError(403, 'not_host', 'Only the host can delete a collab.');
  await db.execute(sql`update collabs set deleted_at = now() where id = ${r.id}::uuid`);
  return { ok: true as const };
}

// ─── Joining ────────────────────────────────────────────────────────────────

async function notify(db: Db, userIds: string[], kind: string, r: { id: string; title: string }, actorId: string | null) {
  for (const u of userIds) {
    if (u === actorId) continue;
    await db.execute(sql`insert into notifications (user_id, kind, payload)
      values (${u}::uuid, ${kind}, ${JSON.stringify({ collabId: r.id, title: r.title, actorId })}::jsonb)`);
  }
}
async function managerIds(db: Db, id: string): Promise<string[]> {
  return (await rows<{ user_id: string }>(db, sql`
    select user_id from collab_members where collab_id = ${id}::uuid and role in ('host', 'cohost')`)).map((x) => x.user_id);
}
async function addMember(db: Db, r: Row, userId: string) {
  if (Number(r.team_count) >= Number(r.team_max)) throw new ApiError(409, 'collab_full', 'The team is full.');
  await db.execute(sql`insert into collab_members (collab_id, user_id, role) values (${r.id}::uuid, ${userId}::uuid, 'member')
    on conflict do nothing`);
  await db.execute(sql`update collab_invites set status = 'accepted' where collab_id = ${r.id}::uuid and user_id = ${userId}::uuid and status = 'pending'`);
  await db.execute(sql`update collab_requests set status = 'accepted', decided_at = now()
    where collab_id = ${r.id}::uuid and user_id = ${userId}::uuid and status = 'pending'`);
}

/** Open collabs: you are in. Approve collabs: a request (with an optional note) for the hosts. */
export async function joinCollab(db: Db, me: string, id: string, note: string | undefined) {
  const r = await load(db, me, id);
  if (r.my_role) throw new ApiError(409, 'already_member', 'You are already on this team.');
  if (r.my_invited) { await addMember(db, r, me); await notify(db, await managerIds(db, r.id), 'collab_joined', r, me); return { joined: true }; }
  if (r.status !== 'recruiting') throw new ApiError(409, 'not_recruiting', 'This collab is not looking for people right now.');
  if (r.join_mode === 'open') {
    await addMember(db, r, me);
    await notify(db, await managerIds(db, r.id), 'collab_joined', r, me);
    return { joined: true };
  }
  if (r.my_request === 'pending') throw new ApiError(409, 'already_requested', 'You have already asked to join.');
  if (r.my_request === 'declined') throw new ApiError(409, 'request_declined', 'The host decided not to take more people from requests.');
  if (Number(r.team_count) >= Number(r.team_max)) throw new ApiError(409, 'collab_full', 'The team is full.');
  const n = text(note, 'Your note', COLLAB_NOTE_MAX, true) || null;
  await hit(db, 'collabRequest', me);
  await db.execute(sql`insert into collab_requests (collab_id, user_id, note) values (${r.id}::uuid, ${me}::uuid, ${n})
    on conflict (collab_id, user_id) do update set note = excluded.note, status = 'pending', created_at = now(), decided_at = null`);
  await notify(db, await managerIds(db, r.id), 'collab_request', r, me);
  return { requested: true };
}

export async function withdrawRequest(db: Db, me: string, id: string) {
  const r = await load(db, me, id);
  await db.execute(sql`update collab_requests set status = 'withdrawn', decided_at = now()
    where collab_id = ${r.id}::uuid and user_id = ${me}::uuid and status = 'pending'`);
  return { ok: true as const };
}

/** A member who can take part (active or flagged), by handle; 404 otherwise. */
export async function userByHandle(db: Db, handle: string): Promise<{ id: string; handle: string; state: string }> {
  const [u] = await rows<{ id: string; handle: string; state: string }>(db, sql`
    select id, handle, state from users where lower(handle) = lower(${handle}) and state in ('active', 'flagged_lurker')`);
  if (!u) throw new ApiError(404, 'not_found', `No member @${handle}.`);
  return u;
}

export async function decideRequest(db: Db, me: string, id: string, handle: string, accept: boolean) {
  const r = await load(db, me, id);
  requireManager(r);
  const u = await userByHandle(db, handle);
  const pending = await scalar<boolean>(db, sql`select exists (select 1 from collab_requests
    where collab_id = ${r.id}::uuid and user_id = ${u.id}::uuid and status = 'pending')`);
  if (!pending) throw new ApiError(404, 'not_found', 'No pending request from them.');
  if (accept) {
    await addMember(db, r, u.id);
    await notify(db, [u.id], 'collab_accepted', r, null);
  } else {
    await db.execute(sql`update collab_requests set status = 'declined', decided_at = now()
      where collab_id = ${r.id}::uuid and user_id = ${u.id}::uuid`);
    // never says who declined
    await notify(db, [u.id], 'collab_declined', r, null);
  }
  return getCollab(db, me, r.id);
}

/** Members whose interests overlap, best first; not already on the team, invited or asking. */
export async function suggestPeople(db: Db, me: string, id: string) {
  const r = await load(db, me, id);
  requireManager(r);
  const found = await rows<{ handle: string; display_name: string; gender: string | null; shared: string[]; n: number }>(db, sql`
    select u.handle, u.display_name, u.gender, array_agg(ui.interest order by ui.interest) as shared, count(*)::int as n
      from users u
      join user_interests ui on ui.user_id = u.id
      join collab_interests ci on ci.interest = ui.interest and ci.collab_id = ${r.id}::uuid
     where u.state in ('active', 'flagged_lurker')
       and not exists (select 1 from collab_members m where m.collab_id = ${r.id}::uuid and m.user_id = u.id)
       and not exists (select 1 from collab_invites i where i.collab_id = ${r.id}::uuid and i.user_id = u.id)
       and not exists (select 1 from collab_requests q where q.collab_id = ${r.id}::uuid and q.user_id = u.id and q.status = 'pending')
     group by u.id order by n desc, u.handle limit 20`);
  return { items: found.map((x) => ({ handle: x.handle, displayName: x.display_name, gender: x.gender, shared: x.shared, match: Number(x.n) })) };
}

export async function inviteMember(db: Db, me: string, id: string, handle: string) {
  const r = await load(db, me, id);
  requireManager(r);
  const u = await userByHandle(db, handle);
  if (await scalar<boolean>(db, sql`select exists (select 1 from collab_members where collab_id = ${r.id}::uuid and user_id = ${u.id}::uuid)`)) {
    throw new ApiError(409, 'already_member', `@${u.handle} is already on the team.`);
  }
  const open = Number(await scalar(db, sql`select count(*)::int from collab_invites where collab_id = ${r.id}::uuid and status = 'pending'`));
  if (open >= COLLAB_INVITES_MAX) throw new ApiError(409, 'invite_limit', `Up to ${COLLAB_INVITES_MAX} open invitations per collab.`);
  const inserted = await rows(db, sql`insert into collab_invites (collab_id, user_id, invited_by) values (${r.id}::uuid, ${u.id}::uuid, ${me}::uuid)
    on conflict do nothing returning 1`);
  if (!inserted.length) throw new ApiError(409, 'already_invited', `@${u.handle} was already invited.`);
  await notify(db, [u.id], 'collab_invite', r, me);
  return getCollab(db, me, r.id);
}

export async function declineInvite(db: Db, me: string, id: string) {
  const r = await load(db, me, id);
  await db.execute(sql`update collab_invites set status = 'declined' where collab_id = ${r.id}::uuid and user_id = ${me}::uuid and status = 'pending'`);
  return { ok: true as const };
}

/** Anyone can leave. A leaving host hands over to the longest-standing co-host; with none, the collab closes. */
export async function leaveCollab(db: Db, me: string, id: string) {
  const r = await load(db, me, id);
  if (!r.my_role) throw new ApiError(409, 'not_member', 'You are not on this team.');
  await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    await tx.execute(sql`delete from collab_members where collab_id = ${r.id}::uuid and user_id = ${me}::uuid`);
    if (r.my_role === 'host') {
      const [next] = await rows<{ user_id: string }>(tx, sql`select user_id from collab_members
        where collab_id = ${r.id}::uuid and role = 'cohost' order by joined_at limit 1`);
      if (next) await tx.execute(sql`update collab_members set role = 'host' where collab_id = ${r.id}::uuid and user_id = ${next.user_id}::uuid`);
      else if (r.status === 'recruiting') await tx.execute(sql`update collabs set status = 'closed', updated_at = now() where id = ${r.id}::uuid`);
    }
  });
  return { ok: true as const };
}

/** The host makes a team member a co-host, or back. */
export async function setTeamRole(db: Db, me: string, id: string, handle: string, role: 'cohost' | 'member') {
  const r = await load(db, me, id);
  if (r.my_role !== 'host') throw new ApiError(403, 'not_host', 'Only the host can do that.');
  const u = await userByHandle(db, handle);
  const done = await rows(db, sql`update collab_members set role = ${role}
    where collab_id = ${r.id}::uuid and user_id = ${u.id}::uuid and role <> 'host' returning 1`);
  if (!done.length) throw new ApiError(404, 'not_found', `@${u.handle} is not on the team.`);
  return getCollab(db, me, r.id);
}

/** Hosts remove anyone but themselves; co-hosts remove plain members. */
export async function removeFromTeam(db: Db, me: string, id: string, handle: string) {
  const r = await load(db, me, id);
  requireManager(r);
  const u = await userByHandle(db, handle);
  const [m] = await rows<{ role: CollabRole }>(db, sql`select role from collab_members where collab_id = ${r.id}::uuid and user_id = ${u.id}::uuid`);
  if (!m) throw new ApiError(404, 'not_found', `@${u.handle} is not on the team.`);
  if (m.role === 'host' || (r.my_role === 'cohost' && m.role === 'cohost')) throw new ApiError(403, 'not_host', 'You cannot remove them.');
  await db.execute(sql`delete from collab_members where collab_id = ${r.id}::uuid and user_id = ${u.id}::uuid`);
  return getCollab(db, me, r.id);
}

/**
 * Finishing a collab (the first time) offers each team member a draft portfolio project they can
 * edit and publish, or delete: title, the description, their part, team size and how long it ran.
 * Members whose portfolio is full are skipped.
 */
async function offerDrafts(tx: Db, id: string, title: string, description: string) {
  const team = await rows<{ user_id: string; role: CollabRole; n: number; days: number }>(tx, sql`
    select m.user_id, m.role,
      (select count(*)::int from projects p where p.user_id = m.user_id) as n,
      (select greatest(1, ceil(extract(epoch from now() - c.created_at) / 86400))::int from collabs c where c.id = ${id}::uuid) as days
      from collab_members m join users u on u.id = m.user_id and u.state not in ${LIVE}
     where m.collab_id = ${id}::uuid`);
  const flat = description.replace(/\s+/g, ' ').trim();
  const summary = flat.length > PROJECT_SUMMARY_MAX ? `${flat.slice(0, PROJECT_SUMMARY_MAX - 1).trimEnd()}…` : flat;
  for (const m of team) {
    if (Number(m.n) >= PROJECTS_MAX) continue;
    const days = Number(m.days);
    const duration = days < 14 ? `${days} day${days === 1 ? '' : 's'}` : days < 60 ? `${Math.round(days / 7)} weeks` : `${Math.round(days / 30)} months`;
    const role = m.role === 'host' ? 'Host' : m.role === 'cohost' ? 'Co-host' : '';
    const [p] = await rows<{ id: string }>(tx, sql`
      insert into projects (user_id, title, summary, body, year, role, tools, team, duration, draft, position)
      values (${m.user_id}::uuid, ${title}, ${summary}, ${description}, extract(year from now())::int, ${role}, '[]'::jsonb,
        ${`Team of ${team.length}`}, ${duration}, true,
        (select coalesce(max(position), -1) + 1 from projects where user_id = ${m.user_id}::uuid))
      returning id`);
    await tx.execute(sql`insert into notifications (user_id, kind, payload)
      values (${m.user_id}::uuid, 'collab_finished', ${JSON.stringify({ collabId: id, title, projectId: p!.id })}::jsonb)`);
  }
}

export async function collabUpdates(db: Db, me: string, id: string, query: { cursor?: string; limit?: string }) {
  const r = await load(db, me, id);
  return listPosts(db, me, sql`p.collab_id = ${r.id}::uuid and p.parent_id is null and p.deleted_at is null and p.hidden_at is null`, query);
}