import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { rows } from '@anti/db';
import { cleanup, setup } from './client';

afterEach(cleanup);

async function world() {
  const w = await setup({ seatCap: 30 });
  const member = async (handle: string, interests: string[] = []) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle)).status).toBe(200);
    if (interests.length) expect((await c.put('/me/interests', { interests })).status).toBe(200);
    return c;
  };
  const kinds = async (handle: string) => (await rows<{ kind: string }>(w.t.db, sql`
    select n.kind from notifications n join users u on u.id = n.user_id where u.handle = ${handle} order by n.created_at, n.id`))
    .map((x) => x.kind).filter((k) => k.startsWith('collab_'));
  return { ...w, member, kinds };
}

const base = {
  title: 'Zine about the old market', description: 'We print a small zine.\n\n\n\nAbout the market.',
  interests: ['writing', 'photography'], roles: ['Writer', 'Photographer', 'writer '], teamMax: 4, joinMode: 'approve',
  requirements: 'A camera helps.', priceNote: 'Free; printing costs shared', paymentUrl: 'https://example.org/chip-in',
};

describe('collabs', () => {
  test('create, validate, read; the hosting limit', async () => {
    const w = await world();
    const ana = await w.member('ana', ['writing']);
    const c = await ana.post('/collabs', base);
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({
      title: base.title, description: 'We print a small zine.\n\nAbout the market.', status: 'recruiting', joinMode: 'approve',
      interests: ['photography', 'writing'], roles: ['Writer', 'Photographer', 'writer'], teamCount: 1, teamMax: 4,
      canManage: true, my: { role: 'host', request: null, invited: false }, host: { handle: 'ana' }, match: 1,
      requests: [], invites: [], priceNote: base.priceNote, paymentUrl: base.paymentUrl,
    });
    expect(c.body.team).toEqual([expect.objectContaining({ handle: 'ana', role: 'host' })]);

    for (const bad of [
      { title: '  ' }, { interests: [] }, { interests: ['nope'] }, { teamMax: 1 }, { teamMax: 21 }, { joinMode: 'maybe' },
      { paymentUrl: 'http://example.org' }, { paymentUrl: 'javascript:alert(1)' }, { roles: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { description: 'x'.repeat(2001) },
    ]) {
      expect((await ana.post('/collabs', { ...base, ...bad })).body.error).toBe('collab_invalid');
    }
    expect((await ana.post('/collabs', base)).status).toBe(200);
    expect((await ana.post('/collabs', base)).status).toBe(200);
    expect((await ana.post('/collabs', base)).body.error).toBe('collab_limit');
    // closing one frees a slot
    expect((await ana.patch(`/collabs/${c.body.id}`, { status: 'closed' })).body.status).toBe('closed');
    expect((await ana.post('/collabs', base)).status).toBe(200);
    expect((await ana.get('/collabs/not-a-uuid')).status).toBe(404);
  });

  test('approve mode: ask with a note, accept, decline gently; open mode joins straight in', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben', ['writing']);
    const cat = await w.member('cat');
    const id = (await ana.post('/collabs', base)).body.id;

    const asked = await ben.post(`/collabs/${id}/join`, { note: 'I write for the school paper.' });
    expect(asked.body).toEqual({ requested: true });
    expect((await ben.post(`/collabs/${id}/join`, {})).body.error).toBe('already_requested');
    expect((await ben.get(`/collabs/${id}`)).body).toMatchObject({ my: { role: null, request: 'pending' }, canManage: false, requests: null });
    const seen = (await ana.get(`/collabs/${id}`)).body;
    expect(seen.requests).toEqual([expect.objectContaining({ handle: 'ben', note: 'I write for the school paper.' })]);
    expect((await ben.post(`/collabs/${id}/requests/cat/accept`)).body.error).toBe('not_host');

    const accepted = await ana.post(`/collabs/${id}/requests/ben/accept`);
    expect(accepted.body.teamCount).toBe(2);
    expect(accepted.body.requests).toEqual([]);
    expect((await ben.get(`/collabs/${id}`)).body.my.role).toBe('member');

    await cat.post(`/collabs/${id}/join`, {});
    await ana.post(`/collabs/${id}/requests/cat/decline`);
    expect((await cat.get(`/collabs/${id}`)).body.my.request).toBe('declined');
    expect((await cat.post(`/collabs/${id}/join`, {})).body.error).toBe('request_declined');

    expect(await w.kinds('ana')).toEqual(['collab_request', 'collab_request']);
    expect(await w.kinds('ben')).toEqual(['collab_accepted']);
    expect(await w.kinds('cat')).toEqual(['collab_declined']);
    const n = (await cat.get('/notifications')).body.items.find((x: any) => x.kind === 'collab_declined');
    expect(n.collab).toEqual({ id, title: base.title });
    expect(n.actor).toBeNull();

    // open mode, and a full team
    const open = (await ana.post('/collabs', { ...base, joinMode: 'open', teamMax: 2 })).body.id;
    expect((await cat.post(`/collabs/${open}/join`, {})).body).toEqual({ joined: true });
    expect((await ben.post(`/collabs/${open}/join`, {})).body.error).toBe('collab_full');
    expect((await ana.patch(`/collabs/${open}`, { teamMax: 3 })).body.teamMax).toBe(3);
    expect((await ana.patch(`/collabs/${id}`, { teamMax: 2, title: 'Zine' })).body.title).toBe('Zine');
    expect((await ana.post(`/collabs/${open}/join`, {})).body.error).toBe('already_member');
    // withdrawing
    const third = (await ana.post('/collabs', base)).body.id;
    await ben.post(`/collabs/${third}/join`, {});
    await ben.del(`/collabs/${third}/request`);
    expect((await ana.get(`/collabs/${third}`)).body.requests).toEqual([]);
  });

  test('ten join requests a day', async () => {
    const w = await world();
    const hosts = [];
    for (const h of ['hosta', 'hostb', 'hostc', 'hostd']) hosts.push(await w.member(h));
    const ben = await w.member('ben');
    const ids: string[] = [];
    for (const h of hosts) for (let i = 0; i < 3; i++) ids.push((await h.post('/collabs', base)).body.id);
    for (let i = 0; i < 10; i++) expect((await ben.post(`/collabs/${ids[i]}/join`, {})).body).toEqual({ requested: true });
    expect((await ben.post(`/collabs/${ids[10]}/join`, {})).status).toBe(429);
  });

  test('suggestions by shared interests, invites, and accepting one', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben', ['writing', 'photography']);
    const cat = await w.member('cat', ['writing']);
    await w.member('dan', ['music']);
    const id = (await ana.post('/collabs', base)).body.id;

    const s = (await ana.get(`/collabs/${id}/suggestions`)).body.items;
    expect(s.map((x: any) => [x.handle, x.match])).toEqual([['ben', 2], ['cat', 1]]);
    expect(s[0].shared).toEqual(['photography', 'writing']);
    expect((await ben.get(`/collabs/${id}/suggestions`)).body.error).toBe('not_host');

    expect((await ana.post(`/collabs/${id}/invites`, { handle: '@ben' })).body.invites).toEqual([expect.objectContaining({ handle: 'ben' })]);
    expect((await ana.post(`/collabs/${id}/invites`, { handle: 'ben' })).body.error).toBe('already_invited');
    expect((await ana.post(`/collabs/${id}/invites`, { handle: 'ana' })).body.error).toBe('already_member');
    expect((await ana.post(`/collabs/${id}/invites`, { handle: 'nobody' })).status).toBe(404);
    expect((await ana.get(`/collabs/${id}/suggestions`)).body.items.map((x: any) => x.handle)).toEqual(['cat']);

    expect((await ben.get('/collabs?tab=for-you')).body.items.map((x: any) => x.id)).toContain(id);
    expect((await ben.get(`/collabs/${id}`)).body.my.invited).toBe(true);
    expect((await ben.post(`/collabs/${id}/invite/accept`)).body).toEqual({ joined: true });
    expect((await ben.get(`/collabs/${id}`)).body.my).toEqual({ role: 'member', request: null, invited: false });
    expect(await w.kinds('ben')).toEqual(['collab_invite']);
    expect(await w.kinds('ana')).toEqual(['collab_joined']);

    await ana.post(`/collabs/${id}/invites`, { handle: 'cat' });
    await cat.post(`/collabs/${id}/invite/decline`);
    expect((await ana.get(`/collabs/${id}`)).body.invites).toEqual([]);
  });

  test('for you and all, interest filter, profile list, deleting', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben', ['music']);
    const zine = (await ana.post('/collabs', base)).body.id;
    const band = (await ana.post('/collabs', { ...base, title: 'Garage band', interests: ['music'] })).body.id;
    const done = (await ana.post('/collabs', { ...base, title: 'Old mural', interests: ['music', 'art'] })).body.id;
    await ana.patch(`/collabs/${done}`, { status: 'finished' });

    expect((await ben.get('/collabs')).body.items.map((x: any) => x.id)).toEqual([band]);
    expect((await ben.get('/collabs?tab=all')).body.items.map((x: any) => x.id)).toEqual([band, zine, done]);
    expect((await ben.get('/collabs?tab=all&interest=writing')).body.items.map((x: any) => x.id)).toEqual([zine]);
    expect((await ben.get('/members/ana/collabs')).body.items.map((x: any) => x.title)).toEqual(['Garage band', base.title, 'Old mural']);
    expect((await ben.get('/members/ben/collabs')).body.items).toHaveLength(0);

    expect((await ben.del(`/collabs/${zine}`)).body.error).toBe('not_host');
    expect((await ana.del(`/collabs/${zine}`)).body).toEqual({ ok: true });
    expect((await ben.get(`/collabs/${zine}`)).status).toBe(404);
    expect((await ben.get('/collabs?tab=all')).body.items).toHaveLength(2);
  });

  test('co-hosts, removing people, and the host leaving', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const cat = await w.member('cat');
    const dan = await w.member('dan');
    const id = (await ana.post('/collabs', { ...base, joinMode: 'open', teamMax: 6 })).body.id;
    for (const c of [ben, cat, dan]) await c.post(`/collabs/${id}/join`, {});

    expect((await ben.post(`/collabs/${id}/members/cat/role`, { role: 'cohost' })).body.error).toBe('not_host');
    await ana.post(`/collabs/${id}/members/ben/role`, { role: 'cohost' });
    await ana.post(`/collabs/${id}/members/cat/role`, { role: 'cohost' });
    expect((await ben.get(`/collabs/${id}`)).body.canManage).toBe(true);
    expect((await ben.patch(`/collabs/${id}`, { title: 'By ben' })).body.title).toBe('By ben');
    expect((await ben.del(`/collabs/${id}/members/cat`)).body.error).toBe('not_host');
    expect((await ben.del(`/collabs/${id}/members/ana`)).body.error).toBe('not_host');
    expect((await ben.del(`/collabs/${id}/members/dan`)).body.teamCount).toBe(3);

    // the host leaves: the longest-standing co-host takes over
    await ana.post(`/collabs/${id}/leave`);
    const after = (await ben.get(`/collabs/${id}`)).body;
    expect(after.host.handle).toBe('ben');
    expect(after.team.map((t: any) => [t.handle, t.role])).toEqual([['ben', 'host'], ['cat', 'cohost']]);
    await ben.post(`/collabs/${id}/members/cat/role`, { role: 'member' });
    // no co-host left: the collab closes
    await ben.post(`/collabs/${id}/leave`);
    const closed = (await cat.get(`/collabs/${id}`)).body;
    expect(closed.status).toBe('closed');
    expect(closed.host).toBeNull();
    expect((await ana.post(`/collabs/${id}/leave`)).body.error).toBe('not_member');
  });

  test('a cover from your uploads', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const png = await sharp({ create: { width: 60, height: 30, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
    const up = (await ana.upload('/uploads', png)).body;
    const c = (await ana.post('/collabs', { ...base, coverId: up.id })).body;
    expect(c.cover).toMatchObject({ width: 60, height: 30 });
    expect((await ana.post('/collabs', { ...base, coverId: up.id })).body.error).toBe('collab_invalid');
    expect((await ana.patch(`/collabs/${c.id}`, { coverId: null })).body.cover).toBeNull();
  });
});

describe('collab updates, meetups and finishing', () => {
  const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

  test('the team posts updates; anyone replies; they stay out of the feed and count as posts', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const cat = await w.member('cat');
    const id = (await ana.post('/collabs', { ...base, joinMode: 'open' })).body.id;
    await ben.post(`/collabs/${id}/join`, {});

    const up = await ana.post('/posts', { body: 'First proofs are back from the printer.', collabId: id });
    expect(up.status).toBe(200);
    expect(up.body.collab).toEqual({ id, title: base.title });
    expect((await cat.post('/posts', { body: 'Can I post?', collabId: id })).body.error).toBe('not_allowed');
    expect((await ana.post('/posts', { body: 'x', collabId: '00000000-0000-0000-0000-000000000000' })).status).toBe(404);

    const reply = await cat.post('/posts', { body: 'Looks great.', parentId: up.body.id });
    expect(reply.status).toBe(200);
    expect(reply.body.collab).toEqual({ id, title: base.title });
    expect((await cat.post('/posts', { body: 'x', parentId: up.body.id, collabId: id })).body.error).toBe('bad_request');

    const list = (await cat.get(`/collabs/${id}/updates`)).body.items;
    expect(list.map((p: any) => [p.body, p.replyCount])).toEqual([['First proofs are back from the printer.', 1]]);
    expect((await cat.get('/feed')).body.items).toEqual([]);
    await cat.post('/posts', { body: 'A normal post' });
    expect((await ben.get('/feed')).body.items.map((p: any) => p.body)).toEqual(['A normal post']);

    const kinds = await rows<{ kind: string; handle: string }>(w.t.db, sql`
      select c.kind, u.handle from contributions c join users u on u.id = c.user_id order by c.id`);
    expect(kinds.map((k) => `${k.handle}:${k.kind}`)).toEqual(['ana:post', 'cat:reply', 'cat:post']);
    expect(await w.kinds('ben')).toEqual(['collab_update']);
    expect(await w.kinds('ana')).toEqual(['collab_joined']);
    const n = (await ben.get('/notifications')).body.items.find((x: any) => x.kind === 'collab_update');
    expect(n.post.id).toBe(up.body.id);
    expect(n.collab.id).toBe(id);
  });

  test('meetups: team-only by default, or open to anyone; updates tied to a meetup', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const cat = await w.member('cat');
    const id = (await ana.post('/collabs', { ...base, joinMode: 'open' })).body.id;
    await ben.post(`/collabs/${id}/join`, {});
    const meet = { title: 'Layout night', startsAt: soon(3), location: 'The library, room 2' };

    expect((await cat.post('/events', { ...meet, collabId: id })).body.error).toBe('not_allowed');
    expect((await cat.post('/events', { ...meet, audience: 'team' })).body.error).toBe('event_invalid');
    const team = await ben.post('/events', { ...meet, collabId: id });
    expect(team.status).toBe(200);
    expect(team.body).toMatchObject({ audience: 'team', collab: { id, title: base.title }, canPostUpdate: true });
    const open = (await ana.post('/events', { ...meet, title: 'Launch party', startsAt: soon(10), collabId: id, audience: 'anyone' })).body;
    expect(await w.kinds('ana')).toEqual(['collab_joined', 'collab_meetup']);
    expect(await w.kinds('ben')).toEqual(['collab_meetup']);

    // outsiders never see the team-only one
    expect((await cat.get(`/events/${team.body.id}`)).status).toBe(404);
    expect((await cat.post(`/events/${team.body.id}/rsvp`)).status).toBe(404);
    expect((await cat.get('/events')).body.items.map((e: any) => e.id)).toEqual([open.id]);
    expect((await ana.get('/events')).body.items.map((e: any) => e.id)).toEqual([team.body.id, open.id]);
    expect((await cat.get(`/collabs/${id}`)).body.meetups.map((m: any) => m.title)).toEqual(['Launch party']);
    expect((await ben.get(`/collabs/${id}`)).body.meetups.map((m: any) => [m.title, m.audience])).toEqual([['Layout night', 'team'], ['Launch party', 'anyone']]);

    // an update on the meetup lands on both pages; outsiders don't learn the team-only meetup's name
    const u = (await ben.post('/posts', { body: 'We picked the font.', eventId: team.body.id })).body;
    expect(u.collab.id).toBe(id);
    expect(u.event).toEqual({ id: team.body.id, title: 'Layout night' });
    expect((await ana.get(`/events/${team.body.id}/updates`)).body.items.map((p: any) => p.id)).toEqual([u.id]);
    expect((await cat.get(`/collabs/${id}/updates`)).body.items[0].event).toBeNull();
    expect((await cat.get(`/events/${team.body.id}/updates`)).status).toBe(404);
    // anyone going to the open one is not on the team, so they reply rather than post
    await cat.post(`/events/${open.id}/rsvp`);
    expect((await cat.post('/posts', { body: 'x', eventId: open.id })).body.error).toBe('not_allowed');
    expect((await cat.get(`/events/${open.id}`)).body.canPostUpdate).toBe(false);
  });

  test('plain events: the host and people going post updates on its page', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const cat = await w.member('cat');
    const ev = (await ana.post('/events', { title: 'Picnic', startsAt: soon(2), location: 'The park' })).body;
    expect(ev).toMatchObject({ collab: null, audience: 'anyone', canPostUpdate: true });
    await ben.post(`/events/${ev.id}/rsvp`);
    expect((await ben.post('/posts', { body: 'I will bring lemonade.', eventId: ev.id })).status).toBe(200);
    expect((await cat.post('/posts', { body: 'x', eventId: ev.id })).body.error).toBe('not_allowed');
    expect(await w.kinds('ana')).toEqual([]);
    const n = (await rows<{ kind: string }>(w.t.db, sql`select kind from notifications n join users u on u.id = n.user_id where u.handle = 'ana' and n.kind like 'event%' order by n.created_at`)).map((x) => x.kind);
    expect(n).toEqual(['event_rsvp', 'event_update']);
    expect((await cat.get(`/events/${ev.id}/updates`)).body.items).toHaveLength(1);
  });

  test('finishing offers each member a draft project, once', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const id = (await ana.post('/collabs', { ...base, joinMode: 'open' })).body.id;
    await ben.post(`/collabs/${id}/join`, {});
    await ana.patch(`/collabs/${id}`, { status: 'finished' });
    await ana.patch(`/collabs/${id}`, { status: 'closed' });
    await ana.patch(`/collabs/${id}`, { status: 'finished' });

    const mine = (await ben.get('/members/ben/projects')).body.items;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: base.title, draft: true });
    expect((await ana.get('/members/ben/projects')).body.items).toHaveLength(0);
    const full = (await ben.get(`/members/ben/projects/${mine[0].id}`)).body;
    expect(full).toMatchObject({ role: '', team: 'Team of 2', duration: '1 day', summary: 'We print a small zine. About the market.' });
    expect((await ana.get('/members/ana/projects')).body.items[0]).toMatchObject({ draft: true });
    const n = (await ben.get('/notifications')).body.items.find((x: any) => x.kind === 'collab_finished');
    expect(n).toMatchObject({ collab: { id, title: base.title }, draftId: mine[0].id });
  });
});