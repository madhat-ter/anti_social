import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client } from 'bun';
import { eq } from 'drizzle-orm';
import { mediaBlobs, type Db } from '@anti/db';

/** Blob storage for user media (images, and since RFC §10.22 the monologues' recordings). */
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

const TYPES: Record<string, string> = {
  webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  // RFC §10.22: recordings
  webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4',
};
export const typeOf = (key: string) => TYPES[key.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';

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

/**
 * Images kept in Postgres (`media_blobs`). For hosts without a persistent disk (free tiers).
 * Fine for a small test community; move to R2 before media adds up past the database plan.
 */
export class DbStorage implements Storage {
  constructor(private db: Db) {}

  async put(key: string, bytes: Uint8Array, contentType: string) {
    if (!isValidKey(key)) throw new Error('invalid storage key');
    await this.db.insert(mediaBlobs).values({ key, contentType, bytes })
      .onConflictDoUpdate({ target: mediaBlobs.key, set: { contentType, bytes } });
  }

  async get(key: string) {
    if (!isValidKey(key)) return null;
    const [row] = await this.db.select({ bytes: mediaBlobs.bytes, contentType: mediaBlobs.contentType })
      .from(mediaBlobs).where(eq(mediaBlobs.key, key));
    return row ? { bytes: new Uint8Array(row.bytes), contentType: row.contentType } : null;
  }

  async delete(key: string) {
    if (!isValidKey(key)) return;
    await this.db.delete(mediaBlobs).where(eq(mediaBlobs.key, key));
  }
}

/** Cloudflare R2 (S3-compatible), through Bun's own S3 client: no extra package. */
export class R2Storage implements Storage {
  private s3: S3Client;
  constructor(o: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }) {
    this.s3 = new S3Client({
      accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey, bucket: o.bucket,
      endpoint: `https://${o.accountId}.r2.cloudflarestorage.com`,
    });
  }

  async put(key: string, bytes: Uint8Array, contentType: string) {
    if (!isValidKey(key)) throw new Error('invalid storage key');
    await this.s3.write(key, bytes, { type: contentType });
  }

  async get(key: string) {
    if (!isValidKey(key)) return null;
    const f = this.s3.file(key);
    if (!(await f.exists())) return null;
    return { bytes: new Uint8Array(await f.arrayBuffer()), contentType: typeOf(key) };
  }

  async delete(key: string) {
    if (!isValidKey(key)) return;
    await this.s3.delete(key);
  }
}

/**
 * New files go to `primary`; reads fall back to `older`, so switching STORAGE to r2 keeps every
 * image already stored in the database showing. Deletes reach both.
 */
export class LayeredStorage implements Storage {
  constructor(private primary: Storage, private older: Storage) {}
  put(key: string, bytes: Uint8Array, contentType: string) { return this.primary.put(key, bytes, contentType); }
  async get(key: string) { return (await this.primary.get(key)) ?? this.older.get(key); }
  async delete(key: string) { await Promise.all([this.primary.delete(key), this.older.delete(key)]); }
}

/**
 * STORAGE=db keeps media in Postgres; STORAGE=r2 puts new media in Cloudflare R2 (R2_ACCOUNT_ID,
 * R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET) and still reads what the database holds;
 * anything else (default) uses the local disk.
 */
export function loadStorage(db: Db, env: Record<string, string | undefined> = process.env): Storage {
  const mode = env.STORAGE ?? 'disk';
  if (mode === 'db') return new DbStorage(db);
  if (mode === 'r2') {
    const need = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const;
    const missing = need.filter((k) => !env[k]);
    if (missing.length) throw new Error(`STORAGE=r2 needs ${missing.join(', ')}`);
    const r2 = new R2Storage({
      accountId: env.R2_ACCOUNT_ID!, accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!, bucket: env.R2_BUCKET!,
    });
    return new LayeredStorage(r2, new DbStorage(db));
  }
  if (mode !== 'disk') throw new Error(`STORAGE must be 'disk', 'db' or 'r2', got '${mode}'`);
  return new LocalDiskStorage(resolveUploadDir(env));
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
