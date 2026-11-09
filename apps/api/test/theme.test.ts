import { afterEach, expect, test } from 'bun:test';
import { cleanup, setup } from './client';

/** RFC §10.14: light until the member chooses dark; saved on the account. */
afterEach(cleanup);

test('everyone starts light; dark is saved on the account; nothing else is accepted', async () => {
  const w = await setup();
  const c = w.client();
  await c.register(await w.mint(), 'nova');
  expect((await c.get('/me')).body.theme).toBe('light');
  expect((await c.patch('/me', { theme: 'dark' })).body.theme).toBe('dark');
  expect((await c.get('/me')).body.theme).toBe('dark');
  expect((await c.patch('/me', { theme: 'sepia' })).status).toBe(400);
  expect((await c.patch('/me', { theme: 'light' })).body.theme).toBe('light');
});
