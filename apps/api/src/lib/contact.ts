/**
 * Contact details (RFC §10.7): every member gives a cell phone and an email; only admins ever see
 * them, and every time an admin opens them is logged (contact_views). They are stored encrypted
 * (AES-256-GCM) with a key that lives in the server's environment (CONTACT_KEY), never in the
 * database, so a copy of the database alone shows only ciphertext.
 *
 * Without CONTACT_KEY in production the feature is off (nothing is asked or stored) rather than
 * the site failing to start; outside production a fixed development key is used.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';
import { ApiError } from './errors';

const DEV_KEY = 'anti-dev-contact-key: not for production';
const PREFIX = 'v1:';

function key(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.CONTACT_KEY?.trim() || (env.NODE_ENV === 'production' ? '' : DEV_KEY);
  // any string works (Render's generated values are base64): hash it to exactly 32 bytes
  return raw ? createHash('sha256').update(raw).digest() : null;
}

let warned = false;
/** Contact details are collected only when a key is configured. */
export function contactEnabled(): boolean {
  const on = key() !== null;
  if (!on && !warned) { warned = true; console.warn('CONTACT_KEY is not set: contact details are switched off (RFC §10.7).'); }
  return on;
}

export function sealContact(plain: string): string {
  const k = key();
  if (!k) throw new ApiError(503, 'contact_unavailable', 'Contact details are not switched on yet.');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

/** null when missing, or when it cannot be opened (a different key): never throws to callers. */
export function openContact(sealed: string | null | undefined): string | null {
  const k = key();
  if (!sealed || !k || !sealed.startsWith(PREFIX)) return null;
  try {
    const buf = Buffer.from(sealed.slice(PREFIX.length), 'base64');
    const d = createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

const bad = (detail: string) => new ApiError(400, 'contact_invalid', detail);

/** A cell phone: 7–15 digits, an optional leading +; spaces, dashes, dots and brackets are dropped. */
export function checkPhone(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw bad('Add your cell phone number.');
  const s = raw.trim();
  if (!/^\+?[\d\s().-]+$/.test(s)) throw bad('A phone number has only digits (and + at the start).');
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) throw bad('A phone number has 7 to 15 digits.');
  return (s.startsWith('+') ? '+' : '') + digits;
}

/** An email with a basic shape (name@site.tld), lowercased. */
export function checkEmail(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw bad('Add your email.');
  const s = raw.trim().toLowerCase();
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw bad('That email does not look right.');
  return s;
}

/** Has given both (a user row with the sealed columns). */
export const hasContact = (u: { contactPhoneEnc?: string | null; contactEmailEnc?: string | null }) =>
  !!u.contactPhoneEnc && !!u.contactEmailEnc;

/** Setup is complete: the original steps, plus contact details while the feature is on. */
export const setupComplete = (u: { setupDoneAt?: Date | null; contactPhoneEnc?: string | null; contactEmailEnc?: string | null }) =>
  !!u.setupDoneAt && (!contactEnabled() || hasContact(u));

/**
 * Stores both, sealed. The "changed" time only moves when a value really changes, so admins can
 * see "contact changed since verified" (Q12).
 */
export async function saveContact(db: Db, userId: string, c: { phone: string; email: string }) {
  const [u] = await rows<{ p: string | null; e: string | null }>(db, sql`
    select contact_phone_enc as p, contact_email_enc as e from users where id = ${userId}::uuid for update`);
  const same = openContact(u?.p) === c.phone && openContact(u?.e) === c.email;
  if (same) return;
  await db.execute(sql`update users set contact_phone_enc = ${sealContact(c.phone)}, contact_email_enc = ${sealContact(c.email)},
    contact_updated_at = now() where id = ${userId}::uuid`);
}