import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Blob storage for user media.
 * TODO(R2): add an R2/S3-backed implementation for production; the API only talks to this interface.
 */
export interface Storage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const isValidKey = (k: string) => KEY_RE.test(k) && !k.includes('..');

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** UPLOAD_DIR (relative paths resolve against the repo root, not cwd) or `<repo>/.uploads`. */
export function resolveUploadDir(env: Record<string, string | undefined> = process.env): string {
  const v = env.UPLOAD_DIR;
  if (!v) return join(REPO_ROOT, '.uploads');
  return isAbsolute(v) ? v : resolve(REPO_ROOT, v);
}

const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };
const typeOf = (key: string) => TYPES[key.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';

export class LocalDiskStorage implements Storage {
  constructor(private dir: string) {}

  private path(key: string) {
    if (!isValidKey(key)) throw new Error('invalid storage key');
    return join(this.dir, key);
  }

  async put(key: string, bytes: Uint8Array, _contentType: string) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(key), bytes);
  }

  async get(key: string) {
    if (!isValidKey(key)) return null;
    try {
      return { bytes: new Uint8Array(await readFile(this.path(key))), contentType: typeOf(key) };
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') return null;
      throw e;
    }
  }

  async delete(key: string) {
    if (!isValidKey(key)) return;
    await rm(this.path(key), { force: true });
  }
}

/** In-memory storage for tests. */
export class MemoryStorage implements Storage {
  readonly files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async put(key: string, bytes: Uint8Array, contentType: string) {
    this.files.set(key, { bytes, contentType });
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}
