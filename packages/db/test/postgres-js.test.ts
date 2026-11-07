import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import { createDb, scalar, type Db } from '../src/client';
import { MIGRATIONS_FOLDER } from '../src/paths';
import { passkeys, users } from '../src/schema';

/**
 * The other tests use the PGlite driver directly. Production uses postgres.js, so exercise that
 * driver over the wire too. Regression: with postgres.js v4, Drizzle 0.45 ran transaction queries
 * outside the transaction (no atomicity) — this test fails in that case.
 */
let pg: PGlite, server: PGLiteSocketServer, db: Db, close: () => Promise<void>;
const PORT = 54329;

beforeAll(async () => {
  pg = new PGlite();
  await migrate(drizzle({ client: pg }), { migrationsFolder: MIGRATIONS_FOLDER });
  server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' });
  await server.start();
  ({ db, close } = createDb(`postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`, { max: 1 }));
});

afterAll(async () => {
  await close();
  await server.stop();
  await pg.close();
});

const newUser = (handle: string) => ({ id: crypto.randomUUID(), handle, displayName: handle, state: 'waitlisted' as const, recoveryCodeHash: 'x' });

test('transaction commits through postgres.js', async () => {
  const u = newUser('committed');
  await db.transaction(async (tx) => { await tx.insert(users).values(u); });
  expect(await scalar<number>(db, sql`select count(*)::int from users where id = ${u.id}`)).toBe(1);
});

test('transaction rolls back through postgres.js', async () => {
  const u = newUser('rolledback');
  await expect(db.transaction(async (tx) => {
    await tx.insert(users).values(u);
    throw new Error('boom');
  })).rejects.toThrow('boom');
  expect(await scalar<number>(db, sql`select count(*)::int from users where id = ${u.id}`)).toBe(0);
});

test('array columns round-trip', async () => {
  const u = newUser('arrays');
  await db.insert(users).values(u);
  const id = 'cred-' + u.id;
  await db.insert(passkeys).values({ id, userId: u.id, publicKey: 'pk', counter: 0, transports: ['internal', 'hybrid'] });
  const [row] = await db.select({ t: passkeys.transports }).from(passkeys).where(eq(passkeys.id, id));
  expect(row!.t).toEqual(['internal', 'hybrid']);
});
