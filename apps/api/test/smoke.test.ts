import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createTestDb } from '@anti/db/testing';
import { formatInviteCode } from '@anti/shared';
import { createApp } from '../src/app';
import { generateInviteCode } from '../src/lib/crypto';

const cfg = { rpId: 'localhost', rpName: 'Anti', webOrigin: 'http://localhost:3000', cookieSecure: false };
let t: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof createApp>;

const call = (path: string, init: RequestInit = {}) => app.handle(new Request('http://localhost' + path, init));
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function mint() {
  const code = generateInviteCode();
  await t.db.execute(sql`select create_invite(null, ${code})`);
  return formatInviteCode(code);
}

beforeAll(async () => {
  t = await createTestDb();
  app = createApp({ db: t.db, cfg });
});
afterAll(() => t.close());

describe('api smoke', () => {
  test('health', async () => {
    const r = await call('/health');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  test('invites/check valid and invalid', async () => {
    const code = await mint();
    expect(await (await post('/invites/check', { code })).json()).toEqual({ valid: true, wouldWaitlist: false });
    expect(await (await post('/invites/check', { code: 'AAAA-BBBB-CCCC-DDDD' })).json()).toEqual({ valid: false, wouldWaitlist: false });
  });

  test('register/options happy path, handle_taken, invite_invalid', async () => {
    const code = await mint();
    const r = await post('/auth/register/options', { code, handle: 'alice', displayName: 'Alice' });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { challengeId: string; options: { challenge: string } };
    expect(j.challengeId).toBeString();
    expect(j.options.challenge).toBeString();

    await t.db.execute(sql`insert into users(handle, display_name, state, recovery_code_hash) values ('Taken', 'T', 'active', 'x')`);
    const taken = await post('/auth/register/options', { code, handle: 'taken', displayName: 'T' });
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: string }).error).toBe('handle_taken');

    const bad = await post('/auth/register/options', { code: 'AAAA-BBBB-CCCC-DDDD', handle: 'bob', displayName: 'Bob' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('invite_invalid');

    const badHandle = await post('/auth/register/options', { code, handle: '1x', displayName: 'Bob' });
    expect(((await badHandle.json()) as { error: string }).error).toBe('handle_invalid');
  });

  test('GET /me unauthenticated', async () => {
    const r = await call('/me');
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: string }).error).toBe('unauthenticated');
  });

  test('csrf bad_origin', async () => {
    const r = await post('/auth/logout', {}, { cookie: 'anti_session=abc', origin: 'http://evil.example' });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe('bad_origin');
    const ok = await post('/auth/logout', {}, { cookie: 'anti_session=abc', origin: cfg.webOrigin });
    expect(ok.status).toBe(200);
  });
});

