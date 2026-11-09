import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { JOBS, runJob } from '../src/lib/jobs';
import { setOps } from '../src/lib/moderation';
import { bootstrapOps } from '../src/lib/bootstrap';
import { cleanup, setup, type Client } from './client';

afterEach(cleanup);

async function world(seatCap = 20) {
  const w = await setup({ seatCap });
  const rowsOf = async (q: ReturnType<typeof sql>) => ((await w.t.db.execute(q)) as any).rows as any[];
  const member = async (handle: string) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle)).status).toBe(200);
    return c;
  };
  /** the first admin, the way the live site bootstraps one */
  const admin = async (handle = 'boss') => {
    const c = await member(handle);
    await setOps(w.t.db, handle, true);
    return c;
  };
  const tick = () => runJob(w.t.db, JOBS.find((j) => j.name === 'lifecycle')!, { storage: w.storage, payments: w.payments });
  return { ...w, rowsOf, member, admin, tick };
}

const me = async (c: Client) => (await c.get('/me')).body;
const kinds = async (c: Client) => (await c.get('/notifications')).body.items.map((n: any) => n.kind);

describe('admin: only admins', () => {
  test('every admin endpoint is a 404 to members', async () => {
    const w = await world();
    await w.admin();
    const m = await w.member('maya');
    for (const [method, path, body] of [
      ['GET', '/ops/members'], ['GET', '/ops/settings'], ['PATCH', '/ops/settings', { seatCap: 5 }],
      ['POST', '/ops/users/boss/role', { role: 'member' }], ['POST', '/ops/users/boss/handle', { handle: 'mine' }],
      ['POST', '/ops/users/boss/unban'], ['POST', '/ops/users/boss/ban'],
      ['POST', `/ops/posts/${crypto.randomUUID()}/remove`], ['POST', `/ops/projects/${crypto.randomUUID()}/remove`],
    ] as const) {
      expect((await m.req(method, path, body)).status).toBe(404);
    }
    expect((await me(m)).role).toBe('member');
  });
});

describe('admin: members', () => {
  test('everyone is listed with state and role, seated first and admins on top', async () => {
    const w = await world();
    const boss = await w.admin();
    await w.member('zed');
    await w.member('amy');
    await w.member('bad');
    expect((await boss.post('/ops/users/bad/ban')).status).toBe(200);
    const list = (await boss.get('/ops/members')).body;
    expect(list.map((m: any) => m.handle)).toEqual(['boss', 'amy', 'zed', 'bad']);
    expect(list[0]).toMatchObject({ role: 'ops', state: 'active', postCount: 0 });
    expect(list[3]).toMatchObject({ role: 'member', state: 'banned' });
    // the public member list says who the admins are
    expect((await boss.get('/members/boss')).body.role).toBe('ops');
    expect((await boss.get('/members/amy')).body.role).toBe('member');
  });

  test('ban then unban: signed out and locked out, then back in with the same passkey', async () => {
    const w = await world();
    const boss = await w.admin();
    const bob = await w.member('bob');
    expect((await boss.post('/ops/users/@bob/ban')).status).toBe(200);
    expect((await bob.get('/me')).status).toBe(401);
    expect((await bob.login()).status).toBe(403);
    expect((await boss.post('/ops/users/bob/unban')).body).toEqual({ handle: 'bob', state: 'active' });
    expect((await bob.login()).status).toBe(200);
    expect(await me(bob)).toMatchObject({ handle: 'bob', state: 'active' });
    expect(await kinds(bob)).toContain('unbanned');
    // not banned (any more): 409
    expect((await boss.post('/ops/users/bob/unban')).status).toBe(409);
    // admins cannot be banned; a missing member is a 404
    expect((await boss.post('/ops/users/boss/ban')).status).toBe(409);
    expect((await boss.post('/ops/users/nobody/unban')).status).toBe(404);
  });

  test('an unbanned member waits in line when the room is full, and is seated when it grows', async () => {
    const w = await world(2);
    const boss = await w.admin();
    const bob = await w.member('bob');
    await boss.post('/ops/users/bob/ban');
    await w.member('carol'); // takes the freed seat
    expect((await boss.post('/ops/users/bob/unban')).body.state).toBe('waitlisted');
    expect((await bob.login()).status).toBe(200);
    expect((await me(bob)).state).toBe('waitlisted');
    expect((await boss.patch('/ops/settings', { seatCap: 3 })).body).toMatchObject({ seatCap: 3, seatsUsed: 3 });
    expect((await me(bob)).state).toBe('active');
  });

  test('make and remove admins; the last admin cannot be removed', async () => {
    const w = await world();
    const boss = await w.admin();
    const bob = await w.member('bob');
    expect((await boss.post('/ops/users/bob/role', { role: 'ops' })).body).toEqual({ handle: 'bob', role: 'ops' });
    expect((await me(bob)).role).toBe('ops');
    expect(await kinds(bob)).toContain('made_admin');
    expect((await bob.get('/ops/members')).status).toBe(200);

    expect((await bob.post('/ops/users/boss/role', { role: 'member' })).status).toBe(200);
    expect((await boss.get('/ops/members')).status).toBe(404);
    expect(await kinds(boss)).toContain('admin_removed');
    // bob is the only admin left: he cannot remove himself
    const last = await bob.post('/ops/users/bob/role', { role: 'member' });
    expect(last.status).toBe(409);
    expect(last.body.error).toBe('last_admin');

    // only members with a seat can be made admin
    await w.member('gone');
    await bob.post('/ops/users/gone/ban');
    expect((await bob.post('/ops/users/gone/role', { role: 'ops' })).body.error).toBe('not_seated');
  });

  test('a flagged lurker made admin is cleared at once', async () => {
    const w = await world();
    const boss = await w.admin();
    await w.member('lurky');
    await w.t.db.execute(sql`update users set state = 'flagged_lurker', lurker_flagged_at = now() where handle = 'lurky'`);
    await boss.post('/ops/users/lurky/role', { role: 'ops' });
    expect((await w.rowsOf(sql`select state, role from users where handle = 'lurky'`))[0]).toEqual({ state: 'active', role: 'ops' });
  });
});

describe('admin: handles', () => {
  test('rename a member: profile moves, they are told, and their passkey still signs them in', async () => {
    const w = await world();
    const boss = await w.admin();
    const alice = await w.member('alice');
    expect((await boss.post('/ops/users/alice/handle', { handle: '@alicia' })).body).toEqual({ from: 'alice', handle: 'alicia' });
    expect((await boss.get('/members/alicia')).status).toBe(200);
    expect((await boss.get('/members/alice')).status).toBe(404);
    expect((await me(alice)).handle).toBe('alicia');
    const n = (await alice.get('/notifications')).body.items.find((x: any) => x.kind === 'handle_changed');
    expect(n.newHandle).toBe('alicia');
    await alice.post('/auth/logout');
    expect((await alice.login()).status).toBe(200);
    expect((await me(alice)).handle).toBe('alicia');
  });

  test('same rules as signing up; an admin can rename themselves, even just the letter case', async () => {
    const w = await world();
    const boss = await w.admin();
    await w.member('alice');
    const tryRename = async (from: string, to: string) => (await boss.post(`/ops/users/${from}/handle`, { handle: to })).body.error;
    expect(await tryRename('alice', 'a!')).toBe('handle_invalid');
    expect(await tryRename('alice', 'admin')).toBe('handle_invalid'); // reserved
    expect(await tryRename('alice', 'BOSS')).toBe('handle_taken'); // case-insensitive
    expect(await tryRename('nobody', 'someone')).toBe('not_found');
    expect((await boss.post('/ops/users/boss/handle', { handle: 'Boss' })).body.handle).toBe('Boss');
    expect((await boss.post('/ops/users/Boss/handle', { handle: 'chief_01' })).body.handle).toBe('chief_01');
    expect((await me(boss)).handle).toBe('chief_01');
    expect(await kinds(boss)).not.toContain('handle_changed'); // nobody tells you about your own rename
  });
});

describe('admin: content', () => {
  test('remove any post, reported or not; the author is told; reports close', async () => {
    const w = await world();
    const boss = await w.admin();
    const alice = await w.member('alice');
    const carol = await w.member('carol');
    const mine = (await boss.post('/posts', { body: 'House rules: be kind.' })).body;
    const hers = (await alice.post('/posts', { body: 'Buy my course!!!' })).body;
    const flagged = (await alice.post('/posts', { body: 'Second one' })).body;
    await carol.post(`/posts/${flagged.id}/flag`, { reason: 'spam' });

    const feed = (await boss.get('/feed')).body.items;
    expect(feed.find((p: any) => p.id === hers.id).canModerate).toBe(true);
    expect(feed.find((p: any) => p.id === mine.id).canModerate).toBe(false);
    expect(feed.find((p: any) => p.id === mine.id).author.role).toBe('ops');
    expect((await alice.get('/feed')).body.items.every((p: any) => p.canModerate === false)).toBe(true);

    expect((await boss.post(`/ops/posts/${hers.id}/remove`)).body).toEqual({ removed: true });
    expect((await boss.post(`/ops/posts/${hers.id}/remove`)).status).toBe(404);
    expect((await w.rowsOf(sql`select deleted_at is not null as gone from posts where id = ${hers.id}`))[0].gone).toBe(true);
    expect(await kinds(alice)).toContain('post_removed');

    expect((await boss.get('/ops/flags')).body).toHaveLength(1);
    await boss.post(`/ops/posts/${flagged.id}/remove`);
    expect((await boss.get('/ops/flags')).body).toHaveLength(0);
  });

  test('admins can open what reports hid, to review it; members cannot', async () => {
    const w = await world();
    const boss = await w.admin();
    const author = await w.member('author');
    const reporters: Client[] = [];
    for (let i = 1; i <= 5; i++) reporters.push(await w.member(`rep${i}`));
    const post = (await author.post('/posts', { body: 'Hide me' })).body;
    const project = (await author.post('/me/projects', { title: 'Hide me too', draft: false })).body;
    for (const r of reporters) {
      await r.post(`/posts/${post.id}/flag`);
      await r.post(`/projects/${project.id}/flag`);
    }
    expect((await reporters[0]!.get(`/posts/${post.id}`)).status).toBe(404);
    const thread = await boss.get(`/posts/${post.id}`);
    expect(thread.status).toBe(200);
    expect(thread.body.root).toMatchObject({ hidden: true, canModerate: true, body: 'Hide me' });
    expect((await reporters[0]!.get(`/members/author/projects/${project.id}`)).status).toBe(404);
    expect((await boss.get(`/members/author/projects/${project.id}`)).body).toMatchObject({ hidden: true, canModerate: true });
    expect((await author.get(`/members/author/projects/${project.id}`)).body).toMatchObject({ hidden: true, canModerate: false });
    // in the feed nobody sees it, admins included: hidden posts are reviewed from the Admin page
    expect((await boss.get('/feed')).body.items.some((p: any) => p.id === post.id)).toBe(false);
  });

  test('remove any project; drafts stay private; the owner is told the title', async () => {
    const w = await world();
    const boss = await w.admin();
    const kai = await w.member('kai');
    const p = (await kai.post('/me/projects', { title: 'Logo pack', draft: false })).body;
    const draft = (await kai.post('/me/projects', { title: 'Secret', draft: true })).body;
    expect((await boss.get(`/members/kai/projects/${p.id}`)).body.canModerate).toBe(true);
    expect((await kai.get(`/members/kai/projects/${p.id}`)).body.canModerate).toBe(false);
    expect((await boss.post(`/ops/projects/${draft.id}/remove`)).status).toBe(404);
    expect((await boss.post(`/ops/projects/${p.id}/remove`)).status).toBe(200);
    expect((await kai.get(`/members/kai/projects/${p.id}`)).status).toBe(404);
    const n = (await kai.get('/notifications')).body.items.find((x: any) => x.kind === 'project_removed');
    expect(n.projectTitle).toBe('Logo pack');
  });
});

describe('admin: the room', () => {
  test('settings: bounds, invites per member, and the seat count the charts read', async () => {
    const w = await world(5);
    const boss = await w.admin();
    const amy = await w.member('amy');
    expect((await boss.get('/ops/settings')).body).toEqual({ seatCap: 5, invitesPerMember: 2, inviteExpiryDays: 7, screenTime: false, seatsUsed: 2 });
    expect((await amy.get('/seats')).body).toEqual({ cap: 5, used: 2 });
    for (const bad of [{ seatCap: 0 }, { seatCap: 1001 }, { invitesPerMember: 2.5 }, { inviteExpiryDays: 61 }]) {
      expect((await boss.patch('/ops/settings', bad)).body.error).toBe('setting_invalid');
    }
    await boss.patch('/ops/settings', { invitesPerMember: 1, inviteExpiryDays: 3 });
    expect((await amy.post('/me/invites')).status).toBe(200);
    expect((await amy.post('/me/invites')).body.error).toBe('invite_limit');
    const exp = (await w.rowsOf(sql`
      select round(extract(epoch from expires_at - created_at) / 86400)::int as days from invites where created_by is not null`))[0];
    expect(exp.days).toBe(3);
  });

  test('admins never lose their seat to the activity rules', async () => {
    const w = await world();
    await w.admin();
    await w.member('quiet');
    await w.t.db.execute(sql`update users set activated_at = now() - interval '90 days',
      last_seen_at = now() - interval '40 days', last_seen_on = current_date - 40`);
    await w.tick();
    const states = await w.rowsOf(sql`select handle, state from users order by handle`);
    expect(states).toEqual([{ handle: 'boss', state: 'active' }, { handle: 'quiet', state: 'archived' }]);

    // a reader who never posts would be flagged as a lurker; an admin is not
    await w.t.db.execute(sql`update users set last_seen_at = now(), last_seen_on = current_date where handle = 'boss'`);
    const id = (await w.rowsOf(sql`select id from users where handle = 'boss'`))[0].id;
    for (let d = 0; d < 10; d++) {
      await w.t.db.execute(sql`insert into user_seen_days(user_id, day) values (${id}, current_date - ${d}::int) on conflict do nothing`);
    }
    await w.tick();
    expect((await w.rowsOf(sql`select state from users where handle = 'boss'`))[0].state).toBe('active');
  });

  test('OPS_HANDLES only bootstraps the first admin', async () => {
    const w = await world();
    await w.member('first');
    await bootstrapOps(w.t.db, 'first', () => {});
    await w.member('second');
    const lines: string[] = [];
    await bootstrapOps(w.t.db, 'second', (l) => lines.push(l));
    expect(await w.rowsOf(sql`select handle, role from users order by handle`)).toEqual([
      { handle: 'first', role: 'ops' }, { handle: 'second', role: 'member' },
    ]);
    expect(lines[0]).toContain('already exists');
  });
});
