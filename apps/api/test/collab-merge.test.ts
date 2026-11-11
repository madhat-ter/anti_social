import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { rows } from '@anti/db';
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
