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
