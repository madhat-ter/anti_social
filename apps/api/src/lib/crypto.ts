import { INVITE_ALPHABET, VISITOR_CODE_LENGTH, formatInviteCode, normalizeInviteCode } from '@anti/shared';

export function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function sha256Hex(input: string): string {
  return new Bun.CryptoHasher('sha256').update(input).digest('hex');
}

/** n chars from the 32-symbol alphabet; byte & 31 is unbiased because 256 % 32 === 0. */
function randomSymbols(n: number): string {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => INVITE_ALPHABET[b & 31]).join('');
}

/** 16 symbols = 80 bits. Returned normalised (no dashes); format for display. */
export function generateInviteCode(): string {
  return randomSymbols(16);
}

/** RFC §10.8: 8 symbols = 40 bits; single-use, a week unopened, entry rate-limited per IP. */
export function generateVisitorCode(): string {
  return randomSymbols(VISITOR_CODE_LENGTH);
}

/** 28 symbols = 140 bits, shown once as XXXX-XXXX-… */
export function generateRecoveryCode(): { display: string; normalized: string } {
  const normalized = randomSymbols(28);
  return { display: formatInviteCode(normalized), normalized };
}

export const normalizeRecoveryCode = normalizeInviteCode;

export function hashRecoveryCode(normalized: string): Promise<string> {
  return Bun.password.hash(normalized, { algorithm: 'argon2id' });
}

export function verifyRecoveryCode(normalized: string, hash: string): Promise<boolean> {
  if (!hash) return Promise.resolve(false);
  return Bun.password.verify(normalized, hash);
}
