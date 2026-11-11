/**
 * Collabs (RFC §10.5): ongoing projects members do together. A host (plus co-hosts) runs it;
 * people join directly ("open") or ask and get accepted ("approve"); hosts invite people whose
 * interests match. Recruiting → closed (team set, still working) → finished.
 * Anti never handles money: a price/donation note and an outside link at most.
 */
import { sql, type SQL } from 'drizzle-orm';
import { rows, scalar, type Db } from '@anti/db';
import {
  ACTIVITY_SIZE_MAX, COLLAB_DESCRIPTION_MAX, COLLAB_HOSTING_MAX, COLLAB_INTERESTS_MAX, COLLAB_INVITES_MAX, COLLAB_MEETS_MAX,
  COLLAB_NOTE_MAX, COLLAB_PRICE_NOTE_MAX, COLLAB_REQUIREMENTS_MAX, COLLAB_ROLE_MAX, COLLAB_ROLES_MAX, COLLAB_STATUSES,
  COLLAB_TEAM_MAX, COLLAB_TEAM_MIN, COLLAB_TITLE_MAX, PROJECTS_MAX, PROJECT_SUMMARY_MAX, type CollabStatus,
} from '@anti/shared';
import { ApiError } from './errors';
import { listPosts, mediaUrl, UUID_RE } from './posts';
import { hit } from './ratelimit';
import type { Storage } from './storage';

export type Person = { handle: string; displayName: string; gender: string | null; admin?: boolean; verified?: boolean };
/** A person as the API hands them out, with the marks by the name (RFC §10.7): `u` must be the users alias. */
export type PersonRow = { handle: string; display_name: string; gender: string | null; admin: boolean; verified: boolean };
export const PERSON_COLS = sql`u.handle, u.display_name, u.gender, (u.role = 'ops') as admin, (u.verified_at is not null) as verified`;
export const toPerson = (x: PersonRow): Person => ({ handle: x.handle, displayName: x.display_name, gender: x.gender, admin: !!x.admin, verified: !!x.verified });
export type CollabRole = 'host' | 'cohost' | 'member';
/** RFC §10.21: the two kinds that live in `collabs` (an event is still an event) */
export type CollabKind = 'activity' | 'project';
export type CollabSummary = {
  id: string; title: string; kind: CollabKind; meets: string; status: CollabStatus; joinMode: 'open' | 'approve';
  interests: string[]; roles: string[]; teamCount: number; teamMax: number | null;
  host: Person | null; cover: { url: string; width: number; height: number } | null;
  /** interests shared with the viewer */
  match: number;
  my: { role: CollabRole | null; request: 'pending' | 'declined' | null; invited: boolean };
  createdAt: string;
};
export type Collab = CollabSummary & {
  description: string; requirements: string; priceNote: string | null; paymentUrl: string | null;
  /** the roles, and who holds each one (null = still open) */
  slots: { role: string; handle: string | null }[];
  team: (Person & { role: CollabRole; slot: string | null; joinedAt: string })[];
  canManage: boolean;
  /** managers only */
  requests: (Person & { note: string | null; slot: string | null; at: string })[] | null;
  invites: Person[] | null;
  /** hidden after reports (only the team and admins ever get true) */
  hidden: boolean;
  /** RFC §10.21: the host was asked "finish it, keep going, or close?" and nothing has happened since */
  quiet: boolean;
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
  id: string; title: string; kind: CollabKind; meets: string; status: CollabStatus; join_mode: 'open' | 'approve';
  roles: unknown; team_max: number | null;
  cover_key: string | null; cover_width: number | null; cover_height: number | null; created_iso: string;
  description: string; requirements: string; price_note: string | null; payment_url: string | null;
  interests: string[] | null; team_count: number; h_handle: string | null; h_display: string | null; h_gender: string | null;
  h_admin: boolean | null; h_verified: boolean | null;
  match: number; my_role: CollabRole | null; my_request: string | null; my_invited: boolean;
  hidden: boolean; viewer_ops: boolean; quiet: boolean;
};

const select = (me: string) => sql`
  select c.id, c.title, c.kind, c.meets, c.status, c.join_mode, c.roles, c.team_max, c.cover_key, c.cover_width, c.cover_height,
    ${iso(sql`c.created_at`)} as created_iso, c.description, c.requirements, c.price_note, c.payment_url,
    array(select ci.interest from collab_interests ci where ci.collab_id = c.id order by ci.interest) as interests,
    (select count(*)::int from collab_members m join users mu on mu.id = m.user_id and mu.state not in ${LIVE}
      where m.collab_id = c.id) as team_count,
    h.handle as h_handle, h.display_name as h_display, h.gender as h_gender, (h.role = 'ops') as h_admin, (h.verified_at is not null) as h_verified,
    (select count(*)::int from collab_interests ci join user_interests ui on ui.interest = ci.interest
      where ci.collab_id = c.id and ui.user_id = ${me}::uuid) as match,
    (select m.role from collab_members m where m.collab_id = c.id and m.user_id = ${me}::uuid) as my_role,
    (select r.status from collab_requests r where r.collab_id = c.id and r.user_id = ${me}::uuid) as my_request,
    exists (select 1 from collab_invites i where i.collab_id = c.id and i.user_id = ${me}::uuid and i.status = 'pending') as my_invited,
    (c.hidden_at is not null) as hidden,
    exists (select 1 from users v where v.id = ${me}::uuid and v.role = 'ops') as viewer_ops,
    -- RFC §10.21: the quiet nudge is still unanswered (nothing has happened since it was sent)
    exists (select 1 from notifications n
       where n.user_id = ${me}::uuid and n.kind = 'collab_quiet' and (n.payload->>'collabId') = c.id::text
         and n.created_at >= greatest(c.updated_at,
           coalesce((select max(p.created_at) from posts p where p.collab_id = c.id and p.deleted_at is null), '-infinity'::timestamptz),
           coalesce((select max(m.joined_at) from collab_members m where m.collab_id = c.id), '-infinity'::timestamptz),
           coalesce((select max(e.created_at) from events e where e.collab_id = c.id), '-infinity'::timestamptz))) as quiet
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
    id: r.id, title: r.title, kind: r.kind === 'activity' ? 'activity' : 'project', meets: r.meets ?? '',
    status: r.status, joinMode: r.join_mode,
    interests: r.interests ?? [], roles: json<string[]>(r.roles, []), teamCount: Number(r.team_count),
    teamMax: r.team_max === null ? null : Number(r.team_max),
    host: r.h_handle ? { handle: r.h_handle, displayName: r.h_display ?? r.h_handle, gender: r.h_gender, admin: !!r.h_admin, verified: !!r.h_verified } : null,
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
export async function listCollabs(db: Db, me: string, opts: { tab: 'for-you' | 'all'; interest?: string; kind?: CollabKind }): Promise<CollabSummary[]> {
  const filter = opts.interest ? sql`and exists (select 1 from collab_interests ci where ci.collab_id = q.id and ci.interest = ${opts.interest})` : sql``;
  const kind = opts.kind ? sql`and q.kind = ${opts.kind}` : sql``;
  const r = opts.tab === 'for-you'
    ? await rows<Row>(db, sql`select * from (${select(me)}) q where q.status = 'recruiting' and q.match > 0 ${filter} ${kind}
        order by q.match desc, q.created_iso desc limit 100`)
    : await rows<Row>(db, sql`select * from (${select(me)}) q where true ${filter} ${kind}
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
  const team = await rows<{ handle: string; display_name: string; gender: string | null; role: CollabRole; slot: string | null; joined: string; admin: boolean; verified: boolean }>(db, sql`
    select u.handle, u.display_name, u.gender, m.role, m.slot, (u.role = 'ops') as admin, (u.verified_at is not null) as verified, ${iso(sql`m.joined_at`)} as joined
      from collab_members m join users u on u.id = m.user_id and u.state not in ${LIVE}
     where m.collab_id = ${r.id}::uuid
     order by case m.role when 'host' then 0 when 'cohost' then 1 else 2 end, m.joined_at`);
  const manage = canManage(r);
  let requests: Collab['requests'] = null;
  let invites: Collab['invites'] = null;
  if (manage) {
    requests = (await rows<PersonRow & { note: string | null; slot: string | null; at: string }>(db, sql`
      select ${PERSON_COLS}, q.note, q.slot, ${iso(sql`q.created_at`)} as at
        from collab_requests q join users u on u.id = q.user_id and u.state not in ${LIVE}
       where q.collab_id = ${r.id}::uuid and q.status = 'pending' order by q.created_at`))
      .map((x) => ({ ...toPerson(x), note: x.note, slot: x.slot, at: x.at }));
    invites = (await rows<PersonRow>(db, sql`
      select ${PERSON_COLS}
        from collab_invites i join users u on u.id = i.user_id and u.state not in ${LIVE}
       where i.collab_id = ${r.id}::uuid and i.status = 'pending' order by i.created_at`))
      .map(toPerson);
  }
  const meetups = await rows<{ id: string; title: string; starts: string; audience: 'anyone' | 'team'; going: number; past: boolean }>(db, sql`
    select e.id, e.title, ${iso(sql`e.starts_at`)} as starts, e.audience, (e.starts_at < now() - interval '3 hours') as past,
      (select count(*)::int from event_rsvps x where x.event_id = e.id and x.status = 'going') as going
      from events e where e.collab_id = ${r.id}::uuid and e.cancelled_at is null and (e.audience = 'anyone' or ${!!r.my_role})
     order by (e.starts_at < now() - interval '3 hours'), case when e.starts_at >= now() - interval '3 hours' then e.starts_at end asc, e.starts_at desc
     limit 50`);
  const roles = json<string[]>(r.roles, []);
  return {
    ...toSummary(r), description: r.description, requirements: r.requirements, priceNote: r.price_note, paymentUrl: r.payment_url,
    slots: roles.map((role) => ({ role, handle: team.find((t) => t.slot === role)?.handle ?? null })),
    team: team.map((t) => ({ handle: t.handle, displayName: t.display_name, gender: t.gender, role: t.role, slot: t.slot, joinedAt: t.joined, admin: !!t.admin, verified: !!t.verified })),
    canManage: manage, requests, invites,
    hidden: !!r.hidden, quiet: !!r.quiet, canReport: !r.my_role && !r.hidden, canModerate: !!r.viewer_ops,
    meetups: meetups.map((m) => ({ id: m.id, title: m.title, startsAt: m.starts, audience: m.audience, goingCount: Number(m.going), past: !!m.past })),
  };
}

// ─── Writing ────────────────────────────────────────────────────────────────

type Fields = {
  kind: CollabKind; title: string; description: string; requirements: string; roles: string[]; teamMax: number | null;
  meets: string; joinMode: 'open' | 'approve'; priceNote: string | null; paymentUrl: string | null; interests: string[];
};

const text = (v: unknown, what: string, max: number, multiline = false): string => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw bad(`${what} must be text.`);
  const s = (multiline ? v.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : v.replace(/\s+/g, ' ')).trim();
  if (s.length > max) throw bad(`${what} can be at most ${max} characters.`);
  return s;
};

const kindOf = (v: unknown): CollabKind | null => (v === 'activity' || v === 'project' ? v : null);

async function checkFields(db: Db, body: Record<string, unknown>, current?: Fields): Promise<Fields> {
  const has = (k: string) => body[k] !== undefined;
  // RFC §10.21: an activity keeps going, a project has a team and a finish
  const kind = has('kind') ? kindOf(body.kind) : (current?.kind ?? 'project');
  if (!kind) throw bad('A collab is an activity or a project.');
  const title = has('title') ? text(body.title, 'Title', COLLAB_TITLE_MAX) : current?.title ?? '';
  if (!title) throw bad('Give it a title.');
  const rawRoles = kind === 'activity' ? [] : has('roles') ? body.roles : current?.roles ?? [];
  if (!Array.isArray(rawRoles) || rawRoles.length > COLLAB_ROLES_MAX) throw bad(`Up to ${COLLAB_ROLES_MAX} roles.`);
  const cleanRoles = [...new Set(rawRoles.map((x) => text(x, 'A role', COLLAB_ROLE_MAX)).filter(Boolean))];
  const meets = has('meets') ? text(body.meets, 'When we meet', COLLAB_MEETS_MAX) : current?.meets ?? '';
  if (kind === 'activity' && !meets) throw bad('Say when you meet, even loosely: "Sundays 7am, by the lake".');
  // a project team is 2-20; an activity's limit is optional and may be large
  let teamMax: number | null;
  if (kind === 'activity') {
    const raw = has('teamMax') ? body.teamMax : current?.teamMax ?? null;
    teamMax = raw === null || raw === undefined || raw === '' ? null : Number(raw);
    if (teamMax !== null && (!Number.isInteger(teamMax) || teamMax < COLLAB_TEAM_MIN || teamMax > ACTIVITY_SIZE_MAX)) {
      throw bad(`A size limit is ${COLLAB_TEAM_MIN} to ${ACTIVITY_SIZE_MAX} people, or empty for no limit.`);
    }
  } else {
    const raw = has('teamMax') && body.teamMax !== null && body.teamMax !== '' ? Number(body.teamMax) : current?.teamMax ?? 5;
    teamMax = raw;
    if (!Number.isInteger(raw) || raw < COLLAB_TEAM_MIN || raw > COLLAB_TEAM_MAX) {
      throw bad(`The team is ${COLLAB_TEAM_MIN} to ${COLLAB_TEAM_MAX} people, you included.`);
    }
  }
  const joinMode = has('joinMode') ? body.joinMode : current?.joinMode ?? (kind === 'activity' ? 'open' : 'approve');
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
    kind, title, roles: cleanRoles, teamMax, meets, joinMode, interests: picked, priceNote, paymentUrl: urlText,
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
  // RFC §10.21 "Make it regular": a past event of yours becomes an activity, and everyone who came
  // (or was going, when nobody was confirmed) is invited. Those invites skip the 20-open limit.
  let fromEvent: { id: string; invitees: string[] } | null = null;
  if (body.fromEventId !== undefined) {
    if (typeof body.fromEventId !== 'string' || !UUID_RE.test(body.fromEventId)) throw new ApiError(404, 'not_found');
    const [e] = await rows<{ id: string; host_id: string; collab_id: string | null; started: boolean }>(db, sql`
      select id, host_id, collab_id, (now() >= starts_at) as started from events where id = ${body.fromEventId}::uuid`);
    if (!e) throw new ApiError(404, 'not_found');
    if (e.host_id !== me) throw new ApiError(403, 'not_host', 'Only the host can make their event regular.');
    if (e.collab_id) throw bad('A meetup cannot become an activity; make a new one instead.');
    if (!e.started) throw new ApiError(409, 'event_not_started', 'Make it regular once the event has happened.');
    const invitees = await rows<{ user_id: string }>(db, sql`
      select user_id from event_rsvps r
       where r.event_id = ${e.id}::uuid and r.user_id <> ${me}::uuid
         and (r.attended_confirmed_at is not null
              or (r.status = 'going' and not exists (select 1 from event_rsvps c
                    where c.event_id = ${e.id}::uuid and c.attended_confirmed_at is not null)))`);
    fromEvent = { id: e.id, invitees: invitees.map((x) => x.user_id) };
  }
  // RFC §10.21: activities and projects share the one limit
  const hosting = Number(await scalar(db, sql`
    select count(*)::int from collabs c join collab_members m on m.collab_id = c.id and m.user_id = ${me}::uuid and m.role = 'host'
     where c.deleted_at is null and c.status = 'recruiting'`));
  if (hosting >= COLLAB_HOSTING_MAX) {
    throw new ApiError(409, 'collab_limit', `You can host ${COLLAB_HOSTING_MAX} open activities and projects at a time. Close or finish one first.`);
  }
  const id = await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const [c] = await rows<{ id: string }>(tx, sql`
      insert into collabs (title, kind, meets, description, requirements, roles, team_max, join_mode, price_note, payment_url)
      values (${f.title}, ${f.kind}, ${f.meets}, ${f.description}, ${f.requirements}, ${JSON.stringify(f.roles)}::jsonb, ${f.teamMax}, ${f.joinMode},
              ${f.priceNote}, ${f.paymentUrl}) returning id`);
    await tx.execute(sql`insert into collab_members (collab_id, user_id, role) values (${c!.id}::uuid, ${me}::uuid, 'host')`);
    await saveInterests(tx, c!.id, f.interests);
    await saveCover(tx, c!.id, me, body.coverId);
    for (const u of fromEvent?.invitees ?? []) {
      await tx.execute(sql`insert into collab_invites (collab_id, user_id, invited_by) values (${c!.id}::uuid, ${u}::uuid, ${me}::uuid)
        on conflict do nothing`);
      await tx.execute(sql`insert into notifications (user_id, kind, payload)
        values (${u}::uuid, 'collab_invite', ${JSON.stringify({ collabId: c!.id, title: f.title, actorId: me })}::jsonb)`);
    }
    return c!.id;
  });
  void storage;
  return getCollab(db, me, id);
}

/** The team's size and roles, for the "Team set" and reopening rules. */
async function teamState(tx: Db, id: string) {
  const people = await rows<{ slot: string | null }>(tx, sql`
    select m.slot from collab_members m join users u on u.id = m.user_id and u.state not in ${LIVE}
     where m.collab_id = ${id}::uuid`);
  return people;
}
/** Every role taken, or the team at its size: a project marks itself "Team set". */
const isTeamSet = (roles: string[], people: { slot: string | null }[], teamMax: number | null) =>
  (teamMax !== null && people.length >= teamMax) || (roles.length > 0 && roles.every((r) => people.some((p) => p.slot === r)));

export async function updateCollab(db: Db, storage: Storage, me: string, id: string, body: Record<string, unknown>): Promise<Collab> {
  const r = await load(db, me, id);
  requireManager(r);
  const curKind: CollabKind = r.kind === 'activity' ? 'activity' : 'project';
  const curMax = r.team_max === null ? null : Number(r.team_max);
  const curRoles = json<string[]>(r.roles, []);
  const nextKind = body.kind === undefined ? curKind : kindOf(body.kind);
  if (!nextKind) throw bad('A collab is an activity or a project.');
  if (nextKind !== curKind) {
    // call 5: drafts have been handed out, so a finished thing cannot change kind
    if (r.status === 'finished') throw new ApiError(409, 'kind_locked', 'This one has finished, so it cannot change kind now.');
    // Q22: an activity with more than 20 people cannot become a project
    if (nextKind === 'project' && Number(r.team_count) > COLLAB_TEAM_MAX) {
      throw new ApiError(409, 'too_big_for_project', `A project team holds up to ${COLLAB_TEAM_MAX}; this one has ${r.team_count}.`);
    }
  }
  // call 6: activity -> project takes the larger of 5 and the headcount; project -> activity keeps
  // the size as the cap. Both stay editable afterwards.
  const switchedMax = nextKind === 'project'
    ? Math.min(Math.max(COLLAB_TEAM_MIN + 3, Number(r.team_count)), COLLAB_TEAM_MAX)
    : curMax;
  const patch: Record<string, unknown> = { ...body, kind: nextKind };
  if (nextKind !== curKind && body.teamMax === undefined) patch.teamMax = nextKind === 'project' ? switchedMax : curMax;
  const f = await checkFields(db, patch, {
    kind: curKind, title: r.title, description: r.description, requirements: r.requirements, roles: curRoles,
    teamMax: curMax, meets: r.meets ?? '', joinMode: r.join_mode, priceNote: r.price_note, paymentUrl: r.payment_url, interests: r.interests ?? [],
  });
  if (f.teamMax !== null && f.teamMax < Number(r.team_count)) throw bad(`The team already has ${r.team_count} people.`);
  let status = r.status;
  if (body.status !== undefined) {
    if (!(COLLAB_STATUSES as readonly string[]).includes(String(body.status))) throw bad('Unknown status.');
    status = body.status as CollabStatus;
  }
  // an activity runs or ends: "team set" belongs to projects
  if (f.kind === 'activity' && status === 'closed') status = 'recruiting';
  const reopening = status === 'recruiting' && r.status !== 'recruiting';
  if (reopening) {
    const hosting = Number(await scalar(db, sql`
      select count(*)::int from collabs c join collab_members m on m.collab_id = c.id and m.user_id = ${me}::uuid and m.role = 'host'
       where c.deleted_at is null and c.status = 'recruiting' and c.id <> ${r.id}::uuid`));
    if (hosting >= COLLAB_HOSTING_MAX) {
      throw new ApiError(409, 'collab_limit', `You can host ${COLLAB_HOSTING_MAX} open activities and projects at a time. Close or finish one first.`);
    }
    if (f.kind === 'project' && isTeamSet(f.roles, await teamState(db, r.id), f.teamMax)) {
      throw new ApiError(409, 'team_full', 'The team is already full. Raise the team size in Edit, or open a role.');
    }
  }
  const old = await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const firstFinish = status === 'finished' && !!(await scalar<boolean>(tx, sql`select finished_at is null from collabs where id = ${r.id}::uuid for update`));
    await tx.execute(sql`update collabs set title = ${f.title}, kind = ${f.kind}, meets = ${f.meets}, description = ${f.description},
      requirements = ${f.requirements}, roles = ${JSON.stringify(f.roles)}::jsonb, team_max = ${f.teamMax}, join_mode = ${f.joinMode},
      price_note = ${f.priceNote}, payment_url = ${f.paymentUrl}, status = ${status}, updated_at = now(),
      finished_at = coalesce(finished_at, case when ${status} = 'finished' then now() end)
      where id = ${r.id}::uuid`);
    await saveInterests(tx, r.id, f.interests);
    // a draft portfolio project is for projects only, and only the first time
    if (firstFinish && f.kind === 'project') await offerDrafts(tx, r.id, f.title, f.description);
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
/**
 * Puts someone on the team. RFC §10.21: a project is capped by its team size, an activity only by
 * its optional limit; a role they picked is theirs if it is still open, and is quietly dropped if
 * someone got there first. A project that fills every role or every place marks itself "Team set".
 */
async function addMember(db: Db, r: Row, userId: string, wantedSlot?: unknown) {
  const roles = json<string[]>(r.roles, []);
  const max = r.team_max === null ? null : Number(r.team_max);
  if (max !== null && Number(r.team_count) >= max) {
    throw r.kind === 'activity'
      ? new ApiError(409, 'full', 'This activity is at its size limit.')
      : new ApiError(409, 'collab_full', 'The team is full.');
  }
  let slot: string | null = null;
  const want = typeof wantedSlot === 'string' ? wantedSlot.trim() : '';
  if (want && roles.includes(want)) {
    const taken = await scalar<boolean>(db, sql`
      select exists (select 1 from collab_members m join users u on u.id = m.user_id and u.state not in ${LIVE}
                      where m.collab_id = ${r.id}::uuid and m.slot = ${want})`);
    if (!taken) slot = want;
  }
  await db.execute(sql`insert into collab_members (collab_id, user_id, role, slot) values (${r.id}::uuid, ${userId}::uuid, 'member', ${slot})
    on conflict do nothing`);
  await db.execute(sql`update collab_invites set status = 'accepted' where collab_id = ${r.id}::uuid and user_id = ${userId}::uuid and status = 'pending'`);
  await db.execute(sql`update collab_requests set status = 'accepted', decided_at = now()
    where collab_id = ${r.id}::uuid and user_id = ${userId}::uuid and status = 'pending'`);
  await markTeamSet(db, r, roles);
}

/** A project marks itself "Team set" once every role is taken or the team is at its size. */
async function markTeamSet(db: Db, r: Row, roles: string[]) {
  if (r.kind !== 'project' || r.status !== 'recruiting') return;
  const people = await teamState(db, r.id);
  if (isTeamSet(roles, people, r.team_max === null ? null : Number(r.team_max))) {
    await db.execute(sql`update collabs set status = 'closed', updated_at = now() where id = ${r.id}::uuid and status = 'recruiting'`);
  }
}

/**
 * Joining. An invite skips asking. Open collabs put you straight in; approve collabs take a request
 * (with an optional note and the role you would take) for the managers. An activity at its limit
 * refuses; a project at its size does the same.
 */
export async function joinCollab(db: Db, me: string, id: string, note: string | undefined, slot?: unknown) {
  const r = await load(db, me, id);
  if (r.my_role) throw new ApiError(409, 'already_member', 'You are already on this team.');
  if (r.my_invited) { await addMember(db, r, me, slot); await notify(db, await managerIds(db, r.id), 'collab_joined', r, me); return { joined: true }; }
  if (r.status !== 'recruiting') {
    throw new ApiError(409, 'not_recruiting', r.kind === 'activity' ? 'This activity has ended.' : 'This collab is not looking for people right now.');
  }
  if (r.join_mode === 'open') {
    await addMember(db, r, me, slot);
    await notify(db, await managerIds(db, r.id), 'collab_joined', r, me);
    return { joined: true };
  }
  if (r.my_request === 'pending') throw new ApiError(409, 'already_requested', 'You have already asked to join.');
  if (r.my_request === 'declined') throw new ApiError(409, 'request_declined', 'The host decided not to take more people from requests.');
  const max = r.team_max === null ? null : Number(r.team_max);
  if (max !== null && Number(r.team_count) >= max) throw new ApiError(409, 'collab_full', 'The team is full.');
  const n = text(note, 'Your note', COLLAB_NOTE_MAX, true) || null;
  const roles = json<string[]>(r.roles, []);
  const want = typeof slot === 'string' && roles.includes(slot.trim()) ? slot.trim() : null;
  await hit(db, 'collabRequest', me);
  await db.execute(sql`insert into collab_requests (collab_id, user_id, note, slot) values (${r.id}::uuid, ${me}::uuid, ${n}, ${want})
    on conflict (collab_id, user_id) do update set note = excluded.note, slot = excluded.slot, status = 'pending', created_at = now(), decided_at = null, reminded_at = null`);
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
  const [pending] = await rows<{ slot: string | null }>(db, sql`select slot from collab_requests
    where collab_id = ${r.id}::uuid and user_id = ${u.id}::uuid and status = 'pending'`);
  if (!pending) throw new ApiError(404, 'not_found', 'No pending request from them.');
  if (accept) {
    // the role they asked for, if it is still open (a taken slot is quietly dropped)
    await addMember(db, r, u.id, pending.slot);
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
  const found = await rows<PersonRow & { shared: string[]; n: number }>(db, sql`
    select ${PERSON_COLS}, array_agg(ui.interest order by ui.interest) as shared, count(*)::int as n
      from users u
      join user_interests ui on ui.user_id = u.id
      join collab_interests ci on ci.interest = ui.interest and ci.collab_id = ${r.id}::uuid
     where u.state in ('active', 'flagged_lurker')
       and not exists (select 1 from collab_members m where m.collab_id = ${r.id}::uuid and m.user_id = u.id)
       and not exists (select 1 from collab_invites i where i.collab_id = ${r.id}::uuid and i.user_id = u.id)
       and not exists (select 1 from collab_requests q where q.collab_id = ${r.id}::uuid and q.user_id = u.id and q.status = 'pending')
     group by u.id order by n desc, u.handle limit 20`);
  return { items: found.map((x) => ({ ...toPerson(x), shared: x.shared, match: Number(x.n) })) };
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

/** Anyone can leave. A leaving host hands over (call 4 for activities); with nobody left, it ends. */
export async function leaveCollab(db: Db, me: string, id: string) {
  const r = await load(db, me, id);
  if (!r.my_role) throw new ApiError(409, 'not_member', 'You are not on this team.');
  await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    await tx.execute(sql`delete from collab_members where collab_id = ${r.id}::uuid and user_id = ${me}::uuid`);
    if (r.my_role === 'host') {
      if (r.kind === 'activity') {
        // call 4: the longest-standing co-host, else the longest-standing member, takes over
        const [next] = await rows<{ user_id: string }>(tx, sql`
          select m.user_id from collab_members m join users u on u.id = m.user_id and u.state not in ${LIVE}
           where m.collab_id = ${r.id}::uuid
           order by case m.role when 'cohost' then 0 else 1 end, m.joined_at limit 1`);
        if (next) await tx.execute(sql`update collab_members set role = 'host' where collab_id = ${r.id}::uuid and user_id = ${next.user_id}::uuid`);
        // leaving as the only person ends it
        else if (r.status === 'recruiting') {
          await tx.execute(sql`update collabs set status = 'finished', finished_at = coalesce(finished_at, now()), updated_at = now() where id = ${r.id}::uuid`);
        }
      } else {
        const [next] = await rows<{ user_id: string }>(tx, sql`select user_id from collab_members
          where collab_id = ${r.id}::uuid and role = 'cohost' order by joined_at limit 1`);
        if (next) await tx.execute(sql`update collab_members set role = 'host' where collab_id = ${r.id}::uuid and user_id = ${next.user_id}::uuid`);
        else if (r.status === 'recruiting') await tx.execute(sql`update collabs set status = 'closed', updated_at = now() where id = ${r.id}::uuid`);
      }
    }
  });
  return { ok: true as const };
}

/** RFC §10.21: a manager gives a member a project role, moves it, or clears it. */
export async function setTeamSlot(db: Db, me: string, id: string, handle: string, slot: unknown) {
  const r = await load(db, me, id);
  requireManager(r);
  const roles = json<string[]>(r.roles, []);
  if (r.kind !== 'project') throw new ApiError(409, 'not_project', 'Only a project has roles to fill.');
  const want = slot === null || slot === undefined || slot === '' ? null : String(slot);
  if (want !== null && !roles.includes(want)) throw bad('That is not one of the roles.');
  const u = await userByHandle(db, handle);
  if (want !== null) {
    const taken = await scalar<boolean>(db, sql`
      select exists (select 1 from collab_members m where m.collab_id = ${r.id}::uuid and m.slot = ${want} and m.user_id <> ${u.id}::uuid)`);
    if (taken) throw new ApiError(409, 'slot_taken', `${want} is already taken.`);
  }
  const done = await rows(db, sql`update collab_members set slot = ${want}
    where collab_id = ${r.id}::uuid and user_id = ${u.id}::uuid and role <> 'host' returning 1`);
  if (!done.length) throw new ApiError(404, 'not_found', `@${u.handle} is not on the team.`);
  await markTeamSet(db, r, roles);
  return getCollab(db, me, r.id);
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