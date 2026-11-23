import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPushSender, vapidKeysInDir } from '../src/lib/push';

const dirs: string[] = [];
const fresh = () => { const d = mkdtempSync(join(tmpdir(), 'anti-vapid-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('web push keys (RFC §10.30)', () => {
  test('a data folder makes its key pair once and keeps it', () => {
    const dir = fresh();
    const a = vapidKeysInDir(dir);
    expect(a.publicKey.length).toBeGreaterThan(40);
    expect(a.privateKey.length).toBeGreaterThan(20);
    expect(vapidKeysInDir(dir)).toEqual(a); // the second start reads the same pair
    expect(JSON.parse(readFileSync(join(dir, 'vapid.json'), 'utf8'))).toEqual(a);
    if (process.platform !== 'win32') expect(statSync(join(dir, 'vapid.json')).mode & 0o077).toBe(0); // only the site's account reads it
  });

  test('settings win over the folder; no settings and no folder means push is off', () => {
    const dir = fresh();
    const own = vapidKeysInDir(dir);
    expect(loadPushSender({}, dir).publicKey).toBe(own.publicKey);
    expect(loadPushSender({ VAPID_PUBLIC_KEY: 'pub-from-settings', VAPID_PRIVATE_KEY: 'priv' }, dir).publicKey).toBe('pub-from-settings');
    expect(loadPushSender({}).publicKey).toBeNull();
  });
});
