/**
 * argon2id for PINs and recovery codes, on Bun and on Node.
 *
 * Under Bun (Render, tests, local dev) this is Bun.password, as it always was. Under Node (the
 * cPanel host, which has no Bun) it is hash-wasm with the same settings Bun uses by default
 * (64 MiB, 2 passes, 1 lane). Both read and write the standard `$argon2id$v=19$m=…` string, so a
 * hash made by one is checked by the other: members moved from the test site keep their PINs.
 */
import { randomBytes } from 'node:crypto';

type BunPassword = { hash(p: string, o: { algorithm: 'argon2id' }): Promise<string>; verify(p: string, h: string): Promise<boolean> };
const bun = (globalThis as { Bun?: { password: BunPassword } }).Bun?.password;

/** Bun.password's argon2id defaults. */
export const ARGON2 = { memoryKiB: 65_536, passes: 2, lanes: 1, hashBytes: 32 } as const;

export async function wasmHash(secret: string): Promise<string> {
  const { argon2id } = await import('hash-wasm');
  return argon2id({
    password: secret, salt: randomBytes(16),
    memorySize: ARGON2.memoryKiB, iterations: ARGON2.passes, parallelism: ARGON2.lanes, hashLength: ARGON2.hashBytes,
    outputType: 'encoded',
  });
}

export async function wasmVerify(secret: string, hash: string): Promise<boolean> {
  const { argon2Verify } = await import('hash-wasm');
  try {
    return await argon2Verify({ password: secret, hash });
  } catch {
    return false; // not an argon2 string at all
  }
}

export const hashSecret = (secret: string): Promise<string> =>
  bun ? bun.hash(secret, { algorithm: 'argon2id' }) : wasmHash(secret);

export const verifySecret = (secret: string, hash: string): Promise<boolean> =>
  bun ? bun.verify(secret, hash) : wasmVerify(secret, hash);
