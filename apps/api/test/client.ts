import { expect } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createTestDb } from '@anti/db/testing';
import { formatInviteCode } from '@anti/shared';
import { createApp } from '../src/app';
import { generateInviteCode } from '../src/lib/crypto';
import { MemoryStorage } from '../src/lib/storage';
import { FakeStripeProvider } from '../src/lib/payments';
import { FakeAuthenticator } from './fake-authenticator';

export const ORIGIN = 'http://localhost:3000';
export const cfg = { rpId: 'localhost', rpName: 'Anti', webOrigin: ORIGIN, cookieSecure: false };

export type Json = any;
export interface Res { status: number; body: Json }

/** A browser-ish client: carries cookies, always sends Origin. */
export class Client {
  cookies = new Map<string, string>();
  bearer?: string;
  mobile = false;
  readonly authn: FakeAuthenticator;

  constructor(private app: ReturnType<typeof createApp>, authn = new FakeAuthenticator()) {
    this.authn = authn;
  }

  /** Low-level request returning the raw Response (cookies are still tracked). */
  async raw(method: string, path: string, body?: BodyInit, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const headers: Record<string, string> = { origin: ORIGIN, ...extraHeaders };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (this.mobile) headers['x-client'] = 'mobile';
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    const r = await this.app.handle(new Request('http://localhost' + path, { method, headers, body }));
    for (const sc of r.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(';');
      const [k, ...v] = pair!.split('=');
      const val = v.join('=');
      const maxAge = attrs.map((a) => a.trim()).find((a) => a.toLowerCase().startsWith('max-age='));
      if (!val || maxAge?.split('=')[1] === '0') this.cookies.delete(k!.trim());
      else this.cookies.set(k!.trim(), val);
    }
    return r;
  }

  async req(method: string, path: string, body?: unknown): Promise<Res> {
    const r = await this.raw(
      method, path, body === undefined ? undefined : JSON.stringify(body),
      body === undefined ? {} : { 'content-type': 'application/json' },
    );
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}) => this.req('POST', p, b);
  patch = (p: string, b: unknown = {}) => this.req('PATCH', p, b);
  del = (p: string) => this.req('DELETE', p);

  /** multipart/form-data upload with a single `file` field. */
  async upload(path: string, bytes: Uint8Array, type = 'image/png', name = 'x.png'): Promise<Res> {
    const form = new FormData();
    form.append('file', new File([bytes as BlobPart], name, { type }));
    const r = await this.raw('POST', path, form);
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  }

  async register(code: string, handle: string, displayName = handle): Promise<Res> {
    const o = await this.post('/auth/register/options', { code, handle, displayName });
    expect(o.status).toBe(200);
    const response = await this.authn.create(o.body.options, ORIGIN);
    return this.post('/auth/register/verify', { challengeId: o.body.challengeId, response });
  }

  async login(credentialId?: string): Promise<Res> {
    const o = await this.post('/auth/login/options', {});
    expect(o.status).toBe(200);
    const response = await this.authn.get(o.body.options, ORIGIN, credentialId);
    return this.post('/auth/login/verify', { challengeId: o.body.challengeId, response });
  }

  async recover(handle: string, recoveryCode: string): Promise<Res> {
    const o = await this.post('/auth/recover/options', { handle, recoveryCode });
    if (o.status !== 200) return o;
    const response = await this.authn.create(o.body.options, ORIGIN);
    return this.post('/auth/recover/verify', { challengeId: o.body.challengeId, response });
  }

  async addPasskey(deviceLabel?: string): Promise<Res> {
    const o = await this.post('/me/passkeys/options');
    expect(o.status).toBe(200);
    const response = await this.authn.create(o.body.options, ORIGIN);
    return this.post('/me/passkeys/verify', { challengeId: o.body.challengeId, response, deviceLabel });
  }
}

let envs: Array<{ close: () => Promise<unknown> | unknown }> = [];
/** Call from each test file: `afterEach(cleanup)`. */
export async function cleanup() {
  for (const e of envs) await e.close();
  envs = [];
}

export async function setup(opts: { seatCap?: number } = {}) {
  const t = await createTestDb(opts);
  envs.push(t);
  const storage = new MemoryStorage();
  const payments = new FakeStripeProvider(ORIGIN);
  const app = createApp({ db: t.db, cfg, storage, payments });
  const mint = async () => {
    const code = generateInviteCode();
    await t.db.execute(sql`select create_invite(null, ${code})`);
    return formatInviteCode(code);
  };
  const client = () => new Client(app);
  return { t, app, storage, payments, mint, client };
}
