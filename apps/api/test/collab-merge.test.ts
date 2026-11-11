import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { rows } from '@anti/db';
import { setOps } from '../src/lib/moderation';
import { JOBS, runJob } from '../src/lib/jobs';
import { describePush } from '../src/lib/push';
import { cleanup, setup } from './client';

afterEach(cleanup);

/** RFC §10.21: One Collab — activities and projects in the same table, and the rules that follow. */

const PROJECT = {
  title: 'A zine about the old market', description: 'We print a small zine.',
  interests: ['writing'], roles: [] as string[], teamMax: 4, joinMode: 'approve' as const,
};
const ACTIVITY = {
  kind: 'activity' as const, title: 'Sunday run club', meets: 'Sundays 7am, by the lake',
  description: 'Easy pace, five kilometres.', interests: ['music'], teamMax: null,
};

async function world() {
  const w = await setup({ seatCap: 40 });
  const member = async (handle: string, interests: string[] = []) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle)).status).toBe(200);
    if (interests.length) expect((await c.put('/me/interests', { interests })).status).toBe(200);
    return c;
  };
  /** Seated rows with no session: enough for team membership (used to fill a big team quickly). */
  const crowd = async (n: number): Promise<string[]> => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const [r] = await rows<{ id: string }>(w.t.db, sql`
        insert into users (handle, display_name, state, recovery_code_hash)
        values (${`filler${i}`}, ${`Filler ${i}`}, 'active', 'x') returning id`);
      ids.push(r!.id);
    }
    return ids;
  };
  return { ...w, member, crowd };
}

describe('collab kinds (RFC §10.21)', () => {
  test('an activity keeps going: "when we meet" is required, its size limit is optional, joining is open', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const made = await ana.post('/collabs', ACTIVITY);
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({
      kind: 'activity', meets: ACTIVITY.meets, teamMax: null, joinMode: 'open', roles: [], status: 'recruiting', teamCount: 1,
    });
    expect((await ana.post('/collabs', { ...ACTIVITY, meets: '  ' })).body.error).toBe('collab_invalid');
    expect((await ana.post('/collabs', { ...ACTIVITY, meets: 'x'.repeat(121) })).body.error).toBe('collab_invalid');
    // a size limit is allowed, and may be large
    expect((await ana.post('/collabs', { ...ACTIVITY, title: 'Book club', teamMax: 500 })).body.teamMax).toBe(500);

    const ben = await w.member('ben');
    expect((await ben.post(`/collabs/${made.body.id}/join`, {})).body).toEqual({ joined: true });
    expect((await ben.get(`/collabs/${made.body.id}`)).body.my.role).toBe('member');
  });

  test('a project defaults to ask-to-join and a team of five; an activity at its limit says full', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const p = await ana.post('/collabs', { ...PROJECT, joinMode: undefined, teamMax: undefined });
    expect(p.body).toMatchObject({ kind: 'project', joinMode: 'approve', teamMax: 5 });

    const a = await ana.post('/collabs', { ...ACTIVITY, teamMax: 2 });
    const ben = await w.member('ben');
    const cat = await w.member('cat');
    expect((await ben.post(`/collabs/${a.body.id}/join`, {})).status).toBe(200);
    const full = await cat.post(`/collabs/${a.body.id}/join`, {});
    expect(full.status).toBe(409);
    expect(full.body.error).toBe('full');
  });

  test('activity ↔ project switching, and what a finished one refuses', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');

    // activity → project: the team size becomes the larger of 5 and the headcount
    const a = (await ana.post('/collabs', ACTIVITY)).body;
    await ben.post(`/collabs/${a.id}/join`, {});
    const asProject = await ana.patch(`/collabs/${a.id}`, { kind: 'project' });
    expect(asProject.status).toBe(200);
    expect(asProject.body).toMatchObject({ kind: 'project', teamMax: 5, status: 'recruiting' });
    expect(asProject.body.teamCount).toBe(2);

    // project → activity: "team set" goes back to running, the size stays as the cap
    const closed = await ana.patch(`/collabs/${a.id}`, { status: 'closed' });
    expect(closed.body.status).toBe('closed');
    const asActivity = await ana.patch(`/collabs/${a.id}`, { kind: 'activity' });
    expect(asActivity.body).toMatchObject({ kind: 'activity', status: 'recruiting', teamMax: 5 });
    // an activity can no longer be "team set"
    expect((await ana.patch(`/collabs/${a.id}`, { status: 'closed' })).body.status).toBe('recruiting');

    // finished: no more kind changes
    const done = await ana.patch(`/collabs/${a.id}`, { status: 'finished' });
    expect(done.body.status).toBe('finished');
    const after = await ana.patch(`/collabs/${a.id}`, { kind: 'project' });
    expect(after.status).toBe(409);
    expect(after.body.error).toBe('kind_locked');
  });

  test('an activity with more than twenty people cannot become a project', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const a = (await ana.post('/collabs', ACTIVITY)).body;
    for (const id of await w.crowd(20)) {
      await w.t.db.execute(sql`insert into collab_members (collab_id, user_id, role) values (${a.id}::uuid, ${id}::uuid, 'member')`);
    }
    const tooBig = await ana.patch(`/collabs/${a.id}`, { kind: 'project' });
    expect(tooBig.status).toBe(409);
    expect(tooBig.body.error).toBe('too_big_for_project');
  });

  test('the hosting limit counts activities and projects together, and reopening is checked', async () => {
    const w = await world();
    const ana = await w.member('ana');
    await ana.post('/collabs', { ...PROJECT, title: 'One' });
    await ana.post('/collabs', { ...PROJECT, title: 'Two' });
    const third = (await ana.post('/collabs', { ...PROJECT, title: 'Three' })).body;
    await ana.patch(`/collabs/${third.id}`, { status: 'closed' }); // still the third project, but not open
    expect((await ana.post('/collabs', { ...PROJECT, title: 'Four' })).status).toBe(200);
    const reopened = await ana.patch(`/collabs/${third.id}`, { status: 'recruiting' });
    expect(reopened.status).toBe(409);
    expect(reopened.body.error).toBe('collab_limit');
  });

  test('roles are slots: a taken one is dropped, a manager can fill or free it, and filling them all sets the team', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const cat = await w.member('cat');
    const p = (await ana.post('/collabs', { ...PROJECT, roles: ['illustrator', 'printer'], teamMax: 5 })).body;

    expect((await ben.post(`/collabs/${p.id}/join`, { note: 'I draw.', slot: 'illustrator' })).body).toEqual({ requested: true });
    await ana.post(`/collabs/${p.id}/requests/ben/accept`);
    let seen = (await ana.get(`/collabs/${p.id}`)).body;
    expect(seen.slots).toEqual([{ role: 'illustrator', handle: 'ben' }, { role: 'printer', handle: null }]);
    expect(seen.team.find((t: any) => t.handle === 'ben').slot).toBe('illustrator');

    // cat asks for the same role: it is taken, so it is quietly dropped on accept
    await cat.post(`/collabs/${p.id}/join`, { slot: 'illustrator' });
    await ana.post(`/collabs/${p.id}/requests/cat/accept`);
    expect((await ana.get(`/collabs/${p.id}`)).body.team.find((t: any) => t.handle === 'cat').slot).toBeNull();

    // a manager puts cat on the printer slot, and filling every role sets the team
    const filled = await ana.post(`/collabs/${p.id}/members/cat/slot`, { slot: 'printer' });
    expect(filled.body.slots).toEqual([{ role: 'illustrator', handle: 'ben' }, { role: 'printer', handle: 'cat' }]);
    expect(filled.body.status).toBe('closed');
    const taken = await ana.post(`/collabs/${p.id}/members/cat/slot`, { slot: 'illustrator' });
    expect(taken.body.error).toBe('slot_taken');
    expect((await ana.post(`/collabs/${p.id}/members/cat/slot`, { slot: 'nope' })).body.error).toBe('collab_invalid');
    expect((await ben.post(`/collabs/${p.id}/members/cat/slot`, { slot: null })).body.error).toBe('not_host');
  });

  test('a full team sets itself, and recruiting again refuses until the size is raised', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const p = (await ana.post('/collabs', { ...PROJECT, joinMode: 'open', teamMax: 2 })).body;
    const joined = await ben.post(`/collabs/${p.id}/join`, {});
    expect(joined.body).toEqual({ joined: true });
    expect((await ana.get(`/collabs/${p.id}`)).body.status).toBe('closed');

    const reopen = await ana.patch(`/collabs/${p.id}`, { status: 'recruiting' });
    expect(reopen.status).toBe(409);
    expect(reopen.body.error).toBe('team_full');
    expect((await ana.patch(`/collabs/${p.id}`, { teamMax: 3, status: 'recruiting' })).body.status).toBe('recruiting');
  });

  test('a host leaving an activity hands over: co-host first, else the longest-standing member, else it ends', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const cat = await w.member('cat');

    const a = (await ana.post('/collabs', ACTIVITY)).body;
    await ben.post(`/collabs/${a.id}/join`, {});
    await cat.post(`/collabs/${a.id}/join`, {});
    await ana.post(`/collabs/${a.id}/members/ben/role`, { role: 'cohost' });
    expect((await ana.post(`/collabs/${a.id}/leave`, {})).status).toBe(200);
    let team = (await cat.get(`/collabs/${a.id}`)).body.team;
    expect(team.find((t: any) => t.handle === 'ben').role).toBe('host');
    expect(team.find((t: any) => t.handle === 'cat').role).toBe('member');

    // with no co-host, the longest-standing member takes over
    const b = (await ana.post('/collabs', { ...ACTIVITY, title: 'Book club' })).body;
    await cat.post(`/collabs/${b.id}/join`, {});
    await ben.post(`/collabs/${b.id}/join`, {});
    await ana.post(`/collabs/${b.id}/leave`, {});
    expect((await ben.get(`/collabs/${b.id}`)).body.team.find((t: any) => t.handle === 'cat').role).toBe('host');

    // leaving as the only person ends it
    const c = (await ana.post('/collabs', { ...ACTIVITY, title: 'Film club' })).body;
    await ana.post(`/collabs/${c.id}/leave`, {});
    const ended = await w.client().register(await w.mint(), 'dee');
    expect(ended.status).toBe(200);
    const seen = await rows<{ status: string }>(w.t.db, sql`select status from collabs where id = ${c.id}::uuid`);
    expect(seen[0]!.status).toBe('finished');
  });

  test('the list filters by kind; the detail carries kind and meets', async () => {
    const w = await world();
    const ana = await w.member('ana', ['writing', 'music']);
    const p = (await ana.post('/collabs', PROJECT)).body;
    const a = (await ana.post('/collabs', ACTIVITY)).body;
    const projects = (await ana.get('/collabs?tab=all&kind=project')).body.items;
    expect(projects.map((x: any) => x.id)).toEqual([p.id]);
    const activities = (await ana.get('/collabs?tab=all&kind=activity')).body.items;
    expect(activities.map((x: any) => x.id)).toEqual([a.id]);
    expect(activities[0]).toMatchObject({ kind: 'activity', meets: ACTIVITY.meets });
  });
});

const EVENT = {
  title: 'Darkroom evening', description: 'Develop a roll together.', location: 'Studio B',
  startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), capacity: 8, interests: ['photography'],
};

describe('event co-hosts and "make it regular" (RFC §10.21)', () => {
  test('co-hosts edit, decide and invite, but only the host cancels', async () => {
    const w = await world();
    const ana = await w.member('ana', ['photography']);
    const ben = await w.member('ben');
    const cat = await w.member('cat');
    const dee = await w.member('dee');
    const ev = (await ana.post('/events', EVENT)).body;

    // a co-host must be going
    expect((await ana.post(`/events/${ev.id}/cohosts`, { handle: 'cat' })).body.error).toBe('not_going');
    await cat.post(`/events/${ev.id}/rsvp`, {});
    expect((await ana.post(`/events/${ev.id}/cohosts`, { handle: 'cat' })).body).toMatchObject({
      canManage: true, cohosts: [expect.objectContaining({ handle: 'cat' })],
    });
    expect((await cat.get(`/events/${ev.id}`)).body.canManage).toBe(true);

    // a co-host may edit and invite; a plain member may not
    expect((await cat.patch(`/events/${ev.id}`, { title: 'Darkroom evening, take two' })).status).toBe(200);
    const invited = await cat.post(`/events/${ev.id}/invites`, { handle: 'ben' });
    expect(invited.status).toBe(200);
    expect(invited.body.invites).toEqual([expect.objectContaining({ handle: 'ben' })]);
    expect((await dee.post(`/events/${ev.id}/invites`, { handle: 'ben' })).body.error).toBe('not_host');
    expect((await dee.patch(`/events/${ev.id}`, { title: 'Nope' })).body.error).toBe('not_host');

    // cancelling stays the host's
    expect((await cat.del(`/events/${ev.id}`)).body.error).toBe('not_host');
    // and only the host adds or removes co-hosts
    expect((await cat.post(`/events/${ev.id}/cohosts`, { handle: 'ben' })).body.error).toBe('not_host');
    const removed = await ana.del(`/events/${ev.id}/cohosts/cat`);
    expect(removed.body.cohosts).toEqual([]);
    expect((await cat.get(`/events/${ev.id}`)).body.canManage).toBe(false);

    // a co-host who leaves is no longer a co-host
    await ana.post(`/events/${ev.id}/cohosts`, { handle: 'cat' });
    await cat.del(`/events/${ev.id}/rsvp`);
    expect((await cat.get(`/events/${ev.id}`)).body.canManage).toBe(false);
  });

  test('make it regular: a past event of yours becomes an activity and invites who came', async () => {
    const w = await world();
    const ana = await w.member('ana', ['photography', 'music']);
    const ben = await w.member('ben');
    const cat = await w.member('cat');
    const ev = (await ana.post('/events', EVENT)).body;

    // not before it happened
    const early = await ana.post('/collabs', { ...ACTIVITY, fromEventId: ev.id });
    expect(early.status).toBe(409);
    expect(early.body.error).toBe('event_not_started');

    await ben.post(`/events/${ev.id}/rsvp`, {});
    await cat.post(`/events/${ev.id}/rsvp`, {});
    await w.t.db.execute(sql`update events set starts_at = now() - interval '2 days', ends_at = null where id = ${ev.id}::uuid`);
    // ben came, cat did not
    expect((await ana.post(`/events/${ev.id}/attendance`, { handles: ['ben'] })).status).toBe(200);

    const made = await ana.post('/collabs', { ...ACTIVITY, title: 'Darkroom club', fromEventId: ev.id });
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({ kind: 'activity', teamCount: 1 });
    // the host is never invited, and the person who did not come is not either
    expect(made.body.invites.map((x: any) => x.handle)).toEqual(['ben']);

    // only the host of that event, and never a meetup
    expect((await ben.post('/collabs', { ...ACTIVITY, title: 'Mine', fromEventId: ev.id })).body.error).toBe('not_host');
    const meetup = (await ana.post('/collabs', PROJECT)).body;
    const m = (await ana.post('/events', { ...EVENT, title: 'Meetup', collabId: meetup.id, audience: 'team' })).body;
    await w.t.db.execute(sql`update events set starts_at = now() - interval '1 day' where id = ${m.id}::uuid`);
    expect((await ana.post('/collabs', { ...ACTIVITY, title: 'Nope', fromEventId: m.id })).body.error).toBe('collab_invalid');
  });
});

describe('the Collab page data (RFC §10.21)', () => {
  test('one list of events and collabs, newest started first; kind and interest filters; a cursor', async () => {
    const w = await world();
    const ana = await w.member('ana', ['writing', 'music', 'photography']);
    const ev = (await ana.post('/events', EVENT)).body;
    const project = (await ana.post('/collabs', { ...PROJECT, title: 'Zine', interests: ['writing'] })).body;
    const activity = (await ana.post('/collabs', { ...ACTIVITY, title: 'Run club', interests: ['music'] })).body;

    const all = (await ana.get('/collab')).body;
    expect(all.items.map((x: any) => x.id).sort()).toEqual([ev.id, project.id, activity.id].sort());
    expect(new Set(all.items.map((x: any) => x.type))).toEqual(new Set(['event', 'collab']));
    // newest started first
    const at = all.items.map((x: any) => Date.parse(x.createdAt));
    expect([...at].sort((a, b) => b - a)).toEqual(at);

    expect((await ana.get('/collab?kind=activity')).body.items.map((x: any) => x.id)).toEqual([activity.id]);
    expect((await ana.get('/collab?kind=event')).body.items.map((x: any) => x.id)).toEqual([ev.id]);
    expect((await ana.get('/collab?interest=music')).body.items.map((x: any) => x.id)).toEqual([activity.id]);

    const first = (await ana.get('/collab?limit=2')).body;
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const rest = (await ana.get(`/collab?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)).body;
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
    expect(new Set([...first.items, ...rest.items].map((x: any) => x.id)))
      .toEqual(new Set([ev.id, project.id, activity.id]));
    // a nonsense cursor just starts over rather than failing
    expect((await ana.get('/collab?cursor=nope')).status).toBe(200);
  });

  test('the foot of the list: past events and finished or ended things', async () => {
    const w = await world();
    const ana = await w.member('ana', ['writing', 'photography']);
    const ev = (await ana.post('/events', EVENT)).body;
    const done = (await ana.post('/collabs', { ...PROJECT, title: 'Done' })).body;
    const ended = (await ana.post('/collabs', { ...ACTIVITY, title: 'Ended' })).body;
    await ana.patch(`/collabs/${done.id}`, { status: 'finished' });
    await ana.patch(`/collabs/${ended.id}`, { status: 'finished' });
    await w.t.db.execute(sql`update events set starts_at = now() - interval '3 days', ends_at = null where id = ${ev.id}::uuid`);

    const now = (await ana.get('/collab')).body;
    expect(now.items).toEqual([]);
    const foot = (await ana.get('/collab?done=1')).body;
    expect(new Set(foot.items.map((x: any) => x.id))).toEqual(new Set([ev.id, done.id, ended.id]));
  });

  test('Yours: hosting, in, going, and who waits on you', async () => {
    const w = await world();
    const ana = await w.member('ana', ['photography']);
    const ben = await w.member('ben');
    const cat = await w.member('cat');
    const project = (await ana.post('/collabs', { ...PROJECT, title: 'Film' })).body;
    const ev = (await ana.post('/events', EVENT)).body;

    await ben.post(`/collabs/${project.id}/join`, { note: 'Me.' });
    await ana.post(`/collabs/${project.id}/requests/ben/accept`);
    await ben.post(`/events/${ev.id}/rsvp`, {});
    await cat.post(`/collabs/${project.id}/join`, { note: 'Also me.' });

    const hers = (await ana.get('/me/collab')).body;
    expect(new Set(hers.hosting.map((x: any) => x.id))).toEqual(new Set([project.id, ev.id]));
    expect(hers.in).toEqual([]);
    expect(hers.going).toEqual([]);
    expect(hers.waiting).toEqual([{ type: 'project', id: project.id, title: 'Film', count: 1 }]);

    const his = (await ben.get('/me/collab')).body;
    expect(his.in.map((x: any) => x.id)).toEqual([project.id]);
    expect(his.going.map((x: any) => x.id)).toEqual([ev.id]);
    expect(his.hosting).toEqual([]);
    expect(his.waiting).toEqual([]);

    // a question on an event of yours counts too
    const room = (await ana.post('/events', { ...EVENT, title: 'Talk', joinMode: 'approve' })).body;
    await cat.post(`/events/${room.id}/request`, { note: 'Can I come?' });
    const again = (await ana.get('/me/collab')).body;
    expect(again.waiting).toEqual(expect.arrayContaining([{ type: 'event', id: room.id, title: 'Talk', count: 1 }]));
  });

  test('a member profile lists the events they host, not the ones they only go to', async () => {
    const w = await world();
    const ana = await w.member('ana', ['photography']);
    const ben = await w.member('ben');
    const cat = await w.member('cat');
    const ev = (await ana.post('/events', EVENT)).body;
    await ben.post(`/events/${ev.id}/rsvp`, {});

    const seen = (await cat.get('/members/ana/events')).body;
    expect(seen.upcoming.map((x: any) => x.id)).toEqual([ev.id]);
    expect((await cat.get('/members/ben/events')).body).toEqual({ upcoming: [], past: [] });
    expect((await cat.get('/members/nobody/events')).status).toBe(404);

    // past events sit in their own list, newest first
    const old = (await ana.post('/events', { ...EVENT, title: 'Older' })).body;
    await w.t.db.execute(sql`update events set starts_at = now() - interval '9 days' where id = ${old.id}::uuid`);
    await w.t.db.execute(sql`update events set starts_at = now() - interval '2 days' where id = ${ev.id}::uuid`);
    expect((await cat.get('/members/ana/events')).body.past.map((x: any) => x.id)).toEqual([ev.id, old.id]);

    // a team-only meetup stays inside the team
    const project = (await ana.post('/collabs', PROJECT)).body;
    const meetup = (await ana.post('/events', { ...EVENT, title: 'Meetup', collabId: project.id, audience: 'team' })).body;
    const outsider = (await cat.get('/members/ana/events')).body;
    expect(outsider.upcoming.map((x: any) => x.id)).not.toContain(meetup.id);
  });

  test('the one-time intro strip: saved to the account, and new members never see it', async () => {
    const w = await world();
    const ana = await w.member('ana');
    expect((await ana.get('/me')).body.collabIntroSeen).toBe(true);
    // a member from before this rule has no value
    await w.t.db.execute(sql`update users set collab_intro_seen_at = null where handle = 'ana'`);
    expect((await ana.get('/me')).body.collabIntroSeen).toBe(false);
    expect((await ana.post('/me/collab-intro/dismiss', {})).body).toEqual({ seen: true });
    expect((await ana.get('/me')).body.collabIntroSeen).toBe(true);
  });

  test('visitors read the Collab list but not their own things', async () => {
    const w = await world();
    const boss = await w.member('boss');
    await setOps(w.t.db, 'boss', true);
    const ana = await w.member('ana');
    await ana.post('/collabs', PROJECT);
    const pass = (await boss.post('/ops/visitor-passes', { label: '' })).body;
    const v = w.client();
    expect((await v.post('/visit', { code: pass.code })).status).toBe(200);
    expect((await v.get('/collab')).status).toBe(200);
    expect((await v.get('/me/collab')).status).toBe(403);
    expect((await v.get('/me/collab')).body.error).toBe('visitor_readonly');
    expect((await v.post('/me/collab-intro/dismiss', {})).status).toBe(403);
  });
});

const sweep = JOBS.find((j) => j.name === 'collab_sweep')!;

describe('an admin removes a collab (RFC §10.21)', () => {
  test('Remove (admin) wipes the collab and everything in it; the host is told', async () => {
    const w = await world();
    const boss = await w.member('boss');
    await setOps(w.t.db, 'boss', true);
    const ana = await w.member('ana', ['writing']);
    const ben = await w.member('ben');
    const c = (await ana.post('/collabs', { ...PROJECT, joinMode: 'open', teamMax: 3 })).body;
    await ben.post(`/collabs/${c.id}/join`, {});
    const meetup = (await ana.post('/events', { ...EVENT, title: 'Work night', collabId: c.id, audience: 'team' })).body;
    await ben.post(`/events/${meetup.id}/rsvp`, {});
    await ana.post('/posts', { body: 'An update from the team.', collabId: c.id });

    expect((await boss.post(`/ops/collabs/${c.id}/remove`, {})).body).toEqual({ removed: true });

    const count = async (q: ReturnType<typeof sql>) => Number((await rows<{ n: number }>(w.t.db, q))[0]!.n);
    expect(await count(sql`select count(*)::int as n from collabs where id = ${c.id}::uuid`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from collab_members where collab_id = ${c.id}::uuid`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from events where collab_id = ${c.id}::uuid`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from posts where collab_id = ${c.id}::uuid`)).toBe(0);
    const n = (await ana.get('/notifications')).body.items.find((x: any) => x.kind === 'collab_removed');
    expect(n.collabTitle).toBe(PROJECT.title);
    expect((await ana.get(`/collabs/${c.id}`)).status).toBe(404);
  });

  test("the host's own Delete still only hides it, and can be done without an admin", async () => {
    const w = await world();
    const ana = await w.member('ana', ['writing']);
    const c = (await ana.post('/collabs', PROJECT)).body;
    expect((await ana.del(`/collabs/${c.id}`)).status).toBe(200);
    const [row] = await rows<{ deleted: boolean }>(w.t.db, sql`select (deleted_at is not null) as deleted from collabs where id = ${c.id}::uuid`);
    expect(row!.deleted).toBe(true);
    expect((await ana.get(`/collabs/${c.id}`)).status).toBe(404);
  });
});

describe('the sweep: nothing waits forever (RFC §10.21)', () => {
  const run = (w: Awaited<ReturnType<typeof world>>) => runJob(w.t.db, sweep, { storage: w.storage, payments: w.payments });

  test('a request is reminded at three days, once, and closes at seven with the right words', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const p = (await ana.post('/collabs', PROJECT)).body;
    await ben.post(`/collabs/${p.id}/join`, { note: 'Me.' });
    await w.t.db.execute(sql`update collab_requests set created_at = now() - interval '4 days'`);

    const first = (await run(w)).result as any;
    expect(first.reminded).toBe(1);
    const reminder = (await ana.get('/notifications')).body.items.find((n: any) => n.kind === 'requests_waiting');
    expect(reminder.collab).toEqual({ id: p.id, title: PROJECT.title });
    // running it again sends nothing twice
    expect(((await run(w)).result as any).reminded).toBe(0);
    expect((await ana.get('/notifications')).body.items.filter((n: any) => n.kind === 'requests_waiting')).toHaveLength(1);

    // at seven days it closes, and the person is told it was not answered in time
    await w.t.db.execute(sql`update collab_requests set created_at = now() - interval '8 days'`);
    expect(((await run(w)).result as any).expired).toBe(1);
    const told = (await ben.get('/notifications')).body.items.find((n: any) => n.kind === 'request_expired');
    expect(told.collab).toEqual({ id: p.id, title: PROJECT.title });
    expect((await ben.get(`/collabs/${p.id}`)).body.my.request).toBeNull();
    expect((await ana.post(`/collabs/${p.id}/requests/ben/accept`, {})).body.error).toBe('not_found');
  });

  test('an event request closes when its event starts, not only at seven days', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const ev = (await ana.post('/events', { ...EVENT, joinMode: 'approve' })).body;
    await ben.post(`/events/${ev.id}/request`, { note: 'Can I come?' });
    await w.t.db.execute(sql`update events set starts_at = now() - interval '1 hour', ends_at = null where id = ${ev.id}::uuid`);
    expect(((await run(w)).result as any).expired).toBe(1);
    expect((await ben.get('/notifications')).body.items.some((n: any) => n.kind === 'request_expired')).toBe(true);
    const [r] = await rows<{ status: string }>(w.t.db, sql`select status from event_requests where event_id = ${ev.id}::uuid`);
    expect(r!.status).toBe('expired');
  });

  test('a quiet project asks its host once; a new thing to say starts a new spell', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const p = (await ana.post('/collabs', PROJECT)).body;
    const quiet = async (days: number) => {
      await w.t.db.execute(sql`update collabs set created_at = now() - make_interval(days => ${days}),
        updated_at = now() - make_interval(days => ${days}) where id = ${p.id}::uuid`);
      await w.t.db.execute(sql`update collab_members set joined_at = now() - make_interval(days => ${days}) where collab_id = ${p.id}::uuid`);
    };
    await quiet(22);
    expect(((await run(w)).result as any).nudged).toBe(1);
    let n = (await ana.get('/notifications')).body.items.filter((x: any) => x.kind === 'collab_quiet');
    expect(n).toHaveLength(1);
    // nothing changed: no second nudge
    expect(((await run(w)).result as any).nudged).toBe(0);

    // the host answers "keep going"; another full quiet spell brings one more nudge, not fewer
    await ana.patch(`/collabs/${p.id}`, { description: 'Still going.' });
    await w.t.db.execute(sql`update collabs set updated_at = now() - interval '22 days', quiet_nudged_at = now() - interval '60 days'
      where id = ${p.id}::uuid`);
    await w.t.db.execute(sql`update collab_members set joined_at = now() - interval '22 days' where collab_id = ${p.id}::uuid`);
    expect(((await run(w)).result as any).nudged).toBe(1);
    n = (await ana.get('/notifications')).body.items.filter((x: any) => x.kind === 'collab_quiet');
    expect(n).toHaveLength(2);
    expect(n[0].collab).toEqual({ id: p.id, title: PROJECT.title });
  });

  test('an activity gets six quiet weeks; finished and ended things are left alone', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const a = (await ana.post('/collabs', ACTIVITY)).body;
    const done = (await ana.post('/collabs', { ...PROJECT, title: 'Done' })).body;
    const ended = (await ana.post('/collabs', { ...ACTIVITY, title: 'Ended' })).body;
    await ana.patch(`/collabs/${done.id}`, { status: 'finished' });
    await ana.patch(`/collabs/${ended.id}`, { status: 'finished' });
    for (const id of [a.id, done.id, ended.id]) {
      await w.t.db.execute(sql`update collabs set created_at = now() - interval '50 days', updated_at = now() - interval '50 days' where id = ${id}::uuid`);
      await w.t.db.execute(sql`update collab_members set joined_at = now() - interval '50 days' where collab_id = ${id}::uuid`);
    }
    expect(((await run(w)).result as any).nudged).toBe(1);
    const n = (await ana.get('/notifications')).body.items.filter((x: any) => x.kind === 'collab_quiet');
    expect(n.map((x: any) => x.collab.id)).toEqual([a.id]);
  });

  test('the push texts name the new place and the new kinds', () => {
    const base = { actor: null, post_snippet: null, root_id: null, event_title: 'Talk' };
    expect(describePush({ ...base, kind: 'requests_waiting', payload: { eventId: 'x', title: 'Talk', count: 2 } }))
      .toMatchObject({ title: '2 waiting on you', url: '/collab/event/x' });
    expect(describePush({ ...base, kind: 'request_expired', payload: { collabId: 'c', title: 'Zine' } }))
      .toMatchObject({ url: '/collab/c' });
    expect(describePush({ ...base, kind: 'collab_quiet', payload: { collabId: 'c', title: 'Zine', kind: 'activity' } }))
      .toMatchObject({ title: 'Six quiet weeks', url: '/collab/c' });
    expect(describePush({ ...base, kind: 'collab_quiet', payload: { collabId: 'c', title: 'Zine', kind: 'project' } }))
      .toMatchObject({ title: 'Three quiet weeks' });
    expect(describePush({ ...base, kind: 'event_update', payload: { eventId: 'e' } })).toMatchObject({ url: '/collab/event/e' });
    expect(describePush({ ...base, kind: 'collab_update', payload: { collabId: 'c' } })).toMatchObject({ url: '/collab/c' });
  });
});
