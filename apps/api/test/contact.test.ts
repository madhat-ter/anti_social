import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { rows } from '@anti/db';
import { setOps } from '../src/lib/moderation';
import { cleanup, setup, TEST_SETUP } from './client';

afterEach(cleanup);

async function world() {
  const w = await setup({ seatCap: 10 });
  const member = async (handle: string) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle)).status).toBe(200);
    return c;
  };
  const raw = async (handle: string) => (await rows<any>(w.t.db, sql`
    select contact_phone_enc, contact_email_enc, contact_updated_at, verified_at from users where handle = ${handle}`))[0];
  return { ...w, member, raw };
}

describe('contact details (only admins see them)', () => {
  test('required at setup, checked, stored encrypted, and only ever shown to yourself and admins', async () => {
    const w = await world();
    const c = w.client();
    await c.register(await w.mint(), 'nova', 'Nova', { setup: false });
    const err = async (b: object) => (await c.put('/me/setup', { ...TEST_SETUP, ...b })).body.error;
    expect(await err({ phone: undefined })).toBe('contact_invalid');
    expect(await err({ email: undefined })).toBe('contact_invalid');
    expect(await err({ phone: '12345' })).toBe('contact_invalid');
    expect(await err({ phone: '+1 234 567 890 123 456' })).toBe('contact_invalid');
    expect(await err({ phone: 'call me' })).toBe('contact_invalid');
    expect(await err({ email: 'nope@' })).toBe('contact_invalid');
    expect((await c.get('/me')).body.setupNeeded).toBe(true);

    const me = (await c.put('/me/setup', { ...TEST_SETUP, phone: '+977 (980) 111-2222', email: ' Nova@Example.COM ' })).body;
    expect(me).toMatchObject({ setupNeeded: false, contactEnabled: true, contact: { phone: '+9779801112222', email: 'nova@example.com' }, verifiedAt: null });
    const r = await w.raw('nova');
    expect(r.contact_phone_enc).toStartWith('v1:');
    expect(r.contact_phone_enc).not.toContain('9801112222');
    expect(r.contact_email_enc).not.toContain('example');

    const ben = await w.member('ben');
    const seen = JSON.stringify([(await ben.get('/members/nova')).body, (await ben.get('/members')).body, (await ben.get('/search?q=nova')).body]);
    expect(seen).not.toContain('9801112222');
    expect(seen).not.toContain('nova@example.com');
    expect((await ben.get('/ops/users/nova/contact')).status).toBe(404);

    // Settings: change them; the "changed" time only moves on a real change
    const before = (await w.raw('nova')).contact_updated_at;
    await c.put('/me/contact', { phone: '+9779801112222', email: 'nova@example.com' });
    expect((await w.raw('nova')).contact_updated_at).toEqual(before);
    expect((await c.put('/me/contact', { phone: '98011', email: 'x@y.co' })).body.error).toBe('contact_invalid');
    expect((await c.put('/me/contact', { phone: '9801113333', email: 'nova@new.org' })).body.contact).toMatchObject({ phone: '9801113333', email: 'nova@new.org' });
  });

  test('members who set up before contact details existed add them once; the rest stays, the birthday cannot change', async () => {
    const w = await world();
    const c = await w.member('old');
    await w.t.db.execute(sql`update users set contact_phone_enc = null, contact_email_enc = null where handle = 'old'`);
    expect((await c.get('/feed')).body.error).toBe('setup_required');
    expect((await c.get('/me')).body.setupNeeded).toBe(true);
    const s = (await c.get('/me/setup')).body;
    expect(s).toMatchObject({ done: true, gender: 'undisclosed', birthday: '1995-05-17', phone: '', email: '' });
    expect(s.about.length).toBeGreaterThan(100);
    await c.put('/me/setup', { ...TEST_SETUP, birthday: '1980-01-01' });
    expect((await c.get('/me')).body).toMatchObject({ setupNeeded: false, birthday: '1995-05-17' });
    expect((await c.get('/feed')).status).toBe(200);
  });

  test('admins open contact details (every opening logged) and give or take back the badge', async () => {
    const w = await world();
    const boss = await w.member('boss');
    await setOps(w.t.db, 'boss', true);
    const ana = await w.member('ana');
    const ben = await w.member('ben');

    const list = (await boss.get('/ops/members')).body;
    expect(list.find((m: any) => m.handle === 'ana')).toMatchObject({ verified: null, hasContact: true, contactChangedSinceVerified: false });
    const open = (await boss.get('/ops/users/ana/contact')).body;
    expect(open).toMatchObject({ handle: 'ana', phone: '+9779800000000', email: 'member@example.com', openedBy: [{ handle: 'boss' }] });
    await boss.get('/ops/users/ana/contact');
    expect((await rows(w.t.db, sql`select 1 from contact_views`)).length).toBe(2);

    expect((await boss.post('/ops/users/ana/verify', { on: true })).body).toEqual({ handle: 'ana', verified: true });
    await boss.post('/ops/users/ana/verify', { on: true }); // once
    const kinds = (await ana.get('/notifications')).body.items.filter((n: any) => n.kind === 'verified');
    expect(kinds).toHaveLength(1);
    expect((await ana.get('/me')).body.verifiedAt).toBeString();
    expect((await ben.get('/members/ana')).body.verified).toBe(true);
    expect((await ben.get('/members/boss')).body.verified).toBe(false); // admins are not verified automatically
    const post = (await ana.post('/posts', { body: 'hello' })).body;
    expect(post.author).toMatchObject({ verified: true, role: 'member' });

    // a change after verifying keeps the badge, and admins see it
    await ana.put('/me/contact', { phone: '+977 981 222 3333', email: 'ana@new.org' });
    expect((await boss.get('/ops/members')).body.find((m: any) => m.handle === 'ana')).toMatchObject({ contactChangedSinceVerified: true, verified: { by: 'boss' } });
    expect((await ana.post('/ops/users/ben/verify', { on: true })).status).toBe(404);
    await boss.post('/ops/users/ana/verify', { on: false });
    expect((await ben.get('/members/ana')).body.verified).toBe(false);
    expect((await ana.get('/notifications')).body.items.filter((n: any) => n.kind === 'verified')).toHaveLength(1);
  });

  test('deleting the account erases contact details and the badge', async () => {
    const w = await world();
    const boss = await w.member('boss');
    await setOps(w.t.db, 'boss', true);
    const ana = await w.member('ana');
    await boss.post('/ops/users/ana/verify', { on: true });
    const id = (await rows<{ id: string }>(w.t.db, sql`select id from users where handle = 'ana'`))[0]!.id;
    expect((await ana.del('/me')).status).toBe(200);
    const [r] = await rows<any>(w.t.db, sql`select contact_phone_enc, contact_email_enc, verified_at from users where id = ${id}::uuid`);
    expect(r).toEqual({ contact_phone_enc: null, contact_email_enc: null, verified_at: null });
  });
});