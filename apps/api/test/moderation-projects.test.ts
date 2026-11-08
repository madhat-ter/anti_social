import { afterEach, describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { setOps } from '../src/lib/moderation';
import { cleanup, setup, type Client } from './client';

afterEach(cleanup);

async function world() {
  const w = await setup({ seatCap: 20 });
  const member = async (handle: string) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle)).status).toBe(200);
    return c;
  };
  return { ...w, member };
}

const png = () => sharp({ create: { width: 30, height: 20, channels: 3, background: { r: 200, g: 200, b: 30 } } }).png().toBuffer();

describe('reports on projects', () => {
  test('5 distinct reports hide a project from everyone but its owner; ops restore it', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const ops = await w.member('opsy');
    await setOps(w.t.db, 'opsy', true);
    const reporters: Client[] = [];
    for (let i = 1; i <= 5; i++) reporters.push(await w.member(`rep${i}`));

    const p = (await maya.post('/me/projects', { title: 'Questionable', summary: 'Hmm.' })).body;
    expect((await maya.post(`/projects/${p.id}/flag`)).body.error).toBe('own_project');
    expect((await reporters[0]!.get(`/members/maya/projects/${p.id}`)).body.canReport).toBe(true);
    expect((await maya.get(`/members/maya/projects/${p.id}`)).body.canReport).toBe(false);

    for (const r of reporters.slice(0, 4)) expect((await r.post(`/projects/${p.id}/flag`, { reason: 'stolen work' })).body).toEqual({ flagged: true });
    await reporters[0]!.post(`/projects/${p.id}/flag`); // same member again: still 4 distinct
    expect((await reporters[0]!.get(`/members/maya/projects/${p.id}`)).status).toBe(200);

    await reporters[4]!.post(`/projects/${p.id}/flag`);
    // gone for others, still there for the owner, marked
    expect((await reporters[0]!.get(`/members/maya/projects/${p.id}`)).status).toBe(404);
    expect((await reporters[0]!.get('/members/maya/projects')).body.items).toEqual([]);
    expect((await maya.get(`/members/maya/projects/${p.id}`)).body).toMatchObject({ title: 'Questionable', hidden: true });
    expect((await maya.get('/members/maya/projects')).body.items[0]).toMatchObject({ id: p.id, hidden: true });
    expect((await ops.get('/notifications')).body.items[0].kind).toBe('flag_threshold');

    const q = (await ops.get('/ops/flags')).body;
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'project', projectId: p.id, author: 'maya', hidden: true, flags: 5, body: 'Questionable — Hmm.' });
    expect(q[0].reasons).toEqual(['stolen work', 'stolen work', 'stolen work', 'stolen work']);
    expect((await maya.get('/ops/flags')).status).toBe(404);

    expect((await ops.post(`/ops/projects/${p.id}/resolve`, { resolution: 'restored' })).body).toEqual({ resolution: 'restored' });
    expect((await reporters[0]!.get(`/members/maya/projects/${p.id}`)).body).toMatchObject({ title: 'Questionable', hidden: false });
    expect((await ops.get('/ops/flags')).body).toEqual([]);
    expect((await ops.post(`/ops/projects/${p.id}/resolve`, { resolution: 'removed' })).body.error).toBe('no_open_flags');
  });

  test('removed: the project and its images go, the owner is told; drafts cannot be reported', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const ops = await w.member('opsy');
    await setOps(w.t.db, 'opsy', true);
    const up = await maya.upload('/uploads', await png());
    const key = up.body.url.split('/').pop() as string;
    const p = (await maya.post('/me/projects', { title: 'Bad', images: [{ id: up.body.id }] })).body;
    await theo.post(`/projects/${p.id}/flag`, { reason: 'not theirs' });
    expect((await ops.post(`/ops/projects/${p.id}/resolve`, { resolution: 'removed' })).body).toEqual({ resolution: 'removed' });
    expect((await maya.get(`/members/maya/projects/${p.id}`)).status).toBe(404);
    expect((await maya.get('/members/maya/projects')).body.items).toEqual([]);
    expect(w.storage.files.has(key)).toBe(false);
    expect((await maya.get('/notifications')).body.items[0].kind).toBe('project_removed');

    const d = (await maya.post('/me/projects', { title: 'Draft', draft: true })).body;
    expect((await theo.post(`/projects/${d.id}/flag`)).status).toBe(404);
    expect((await theo.post(`/projects/${crypto.randomUUID()}/flag`)).status).toBe(404);
    expect((await theo.post('/projects/nope/flag')).status).toBe(404);

    // posts and projects share one queue
    const post = (await maya.post('/posts', { body: 'a post' })).body;
    const live = (await maya.post('/me/projects', { title: 'Live' })).body;
    await theo.post(`/posts/${post.id}/flag`);
    await theo.post(`/projects/${live.id}/flag`);
    const kinds = (await ops.get('/ops/flags')).body.map((f: { kind: string }) => f.kind).sort();
    expect(kinds).toEqual(['post', 'project']);
  });
});
