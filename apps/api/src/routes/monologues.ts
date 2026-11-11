/**
 * RFC §10.22, monologues. The recording is uploaded here first; posting it goes through
 * `POST /posts` with `monologue: { audioId, title, kind, mine }`, so likes, replies, mentions,
 * reports and the lurker rule work exactly as they do for any post.
 */
import { Elysia, t } from 'elysia';
import { sql } from 'drizzle-orm';
import { monologues, rows } from '@anti/db';
import { MONOLOGUE, MONOLOGUE_KINDS, type MonologueKind } from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { hit } from '../lib/ratelimit';
import { listPosts, mediaUrl } from '../lib/posts';
import { checkDuration, checkPeaks, monologueVisit, monologuesCaughtUp, MONOLOGUE_WHERE, sniffAudio } from '../lib/monologues';
import { authPlugin, requireSeated } from '../plugins/auth';

const pageQuery = {
  cursor: t.Optional(t.String()), limit: t.Optional(t.String()),
};

export const monologueRoutes = (deps: Deps) => {
  const { db, storage } = deps;
  return new Elysia()
    .use(authPlugin(deps))

    // the sound, before it is posted: checked, stored, and held for this member only
    .post('/monologues/audio', async ({ auth, body }) => {
      const a = requireSeated(auth);
      const uid = a.user.id;
      await hit(db, 'upload', uid);
      const b = body as { file?: unknown; durationMs?: unknown; peaks?: unknown; source?: unknown };
      const file = b.file as File | undefined;
      if (!file || typeof file.arrayBuffer !== 'function') throw new ApiError(400, 'bad_request', 'Missing file.');
      if (file.size > MONOLOGUE.maxBytes) {
        throw new ApiError(413, 'audio_too_large', `Recordings can be at most ${MONOLOGUE.maxBytes / 1024 / 1024} MB.`);
      }
      const durationMs = checkDuration(b.durationMs);
      const peaks = checkPeaks(b.peaks);
      const source = b.source === 'uploaded' ? 'uploaded' : 'recorded';

      const [pending] = await rows<{ n: number }>(db, sql`
        select count(*)::int as n from monologues where uploader_id = ${uid}::uuid and post_id is null`);
      if ((pending?.n ?? 0) >= MONOLOGUE.maxPending) {
        // the oldest waiting recording makes room: re-recording five times is normal, not abuse
        const old = await rows<{ k: string }>(db, sql`
          delete from monologues where id = (
            select id from monologues where uploader_id = ${uid}::uuid and post_id is null order by created_at asc limit 1)
          returning audio_key as k`);
        for (const o of old) await storage.delete(o.k).catch(() => {});
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = sniffAudio(bytes);
      if (!kind) throw new ApiError(415, 'audio_unsupported', 'Use an MP3, M4A, OGG or WebM recording.');
      const key = `${crypto.randomUUID()}.${kind.ext}`;
      await storage.put(key, bytes, kind.type);
      try {
        const [row] = await db.insert(monologues).values({
          uploaderId: uid, audioKey: key, contentType: kind.type, sizeBytes: bytes.byteLength, durationMs, peaks, source,
        }).returning({ id: monologues.id });
        return { id: row!.id, url: mediaUrl(key), durationMs, peaks };
      } catch (e) {
        await storage.delete(key).catch(() => {});
        throw e;
      }
    }, { body: t.Object({ file: t.Any(), durationMs: t.Any(), peaks: t.Optional(t.Any()), source: t.Optional(t.Any()) }) })

    // the Monologue page: feed rules (newest first, a line, an end), only monologues, by kind
    .get('/monologues', async ({ auth, query }) => {
      const a = requireSeated(auth);
      const kind = MONOLOGUE_KINDS.includes(query.kind as MonologueKind) ? (query.kind as MonologueKind) : undefined;
      const page = await listPosts(db, a.user.id, MONOLOGUE_WHERE(kind), query);
      if (query.cursor || (!query.visit && !query.since)) return page;
      return { ...page, visit: await monologueVisit(db, a.user.id, !!a.visitor, query.since) };
    }, { query: t.Object({ ...pageQuery, kind: t.Optional(t.String()), visit: t.Optional(t.String()), since: t.Optional(t.String()) }) })

    .post('/monologues/caught-up', async ({ auth, body }) => {
      const a = requireSeated(auth);
      return monologuesCaughtUp(db, a.user.id, body.through);
    }, { body: t.Object({ through: t.String() }) })

    // the shelf on a profile: their monologues, newest first
    .get('/members/:handle/monologues', async ({ auth, params, query }) => {
      const a = requireSeated(auth);
      const [m] = await rows<{ id: string }>(db, sql`
        select id from users where lower(handle) = lower(${params.handle}) and state in ('active', 'flagged_lurker', 'archived')`);
      if (!m) throw new ApiError(404, 'not_found');
      return listPosts(db, a.user.id, sql`${MONOLOGUE_WHERE()} and p.author_id = ${m.id}::uuid`, { cursor: query.cursor, limit: query.limit ?? '50' });
    }, { query: t.Object(pageQuery) });
};
