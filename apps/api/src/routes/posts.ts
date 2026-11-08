import { Elysia, t } from 'elysia';
import { sql } from 'drizzle-orm';
import { contributions, notifications, postImages, posts, rows, type Db } from '@anti/db';
import {
  EDIT_WINDOW_MINUTES, IMAGE_MAX_BYTES, IMAGE_MAX_DIMENSION, POSTS_PER_HOUR, POST_MAX_CHARS, POST_MAX_IMAGES,
} from '@anti/shared';
import sharp from 'sharp';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import {
  getPost, listPosts, mediaUrl, postSelect, toPost, UUID_RE, type Post, type PostRow,
} from '../lib/posts';
import { isValidKey } from '../lib/storage';
import { hit } from '../lib/ratelimit';
import { authPlugin, requireSeated } from '../plugins/auth';

const MAX_PENDING_UPLOADS = 20;
const pageQuery = t.Object({ cursor: t.Optional(t.String()), limit: t.Optional(t.String()) });

const rowsOf = <T>(res: unknown): T[] => (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];

function cleanBody(raw: string | undefined, allowEmpty: boolean): string {
  const body = (raw ?? '').trim();
  if (Array.from(body).length > POST_MAX_CHARS) {
    throw new ApiError(400, 'body_invalid', `Posts are at most ${POST_MAX_CHARS} characters.`);
  }
  if (!body && !allowEmpty) throw new ApiError(400, 'body_invalid', 'Write something or attach an image.');
  return body;
}

export const postRoutes = (deps: Deps) => {
  const { db, storage } = deps;

  async function visiblePost(id: string) {
    if (!UUID_RE.test(id)) return null;
    const [p] = await rows<{ id: string; author_id: string | null; root_id: string | null; created_ms: number; deleted: boolean }>(
      db,
      sql`select id, author_id, root_id, (extract(epoch from created_at) * 1000)::float8 as created_ms,
                 (deleted_at is not null) as deleted
          from posts where id = ${id}::uuid and hidden_at is null`,
    );
    return p ?? null;
  }

  async function removeImages(keys: string[]) {
    await Promise.all(keys.map((k) => storage.delete(k).catch((e) => console.error('storage delete failed', k, e))));
  }

  return new Elysia()
    .use(authPlugin(deps))
    .get('/feed', async ({ auth, query }) => {
      const a = requireSeated(auth);
      return listPosts(db, a.user.id, sql`p.parent_id is null and p.deleted_at is null and p.hidden_at is null`, query);
    }, { query: pageQuery })

    .post('/posts', async ({ auth, body }) => {
      const a = requireSeated(auth);
      const uid = a.user.id;
      const imageIds = [...new Set(body.imageIds ?? [])];
      if (imageIds.length > POST_MAX_IMAGES || imageIds.some((i) => !UUID_RE.test(i))) {
        throw new ApiError(400, 'image_invalid', `Up to ${POST_MAX_IMAGES} valid images per post.`);
      }
      const text = cleanBody(body.body, imageIds.length > 0);
      if (body.parentId !== undefined && !UUID_RE.test(body.parentId)) throw new ApiError(404, 'parent_not_found');

      const id = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${uid}::text, 0))`);
        const [recent] = rowsOf<{ n: number }>(await tx.execute(
          sql`select count(*)::int as n from posts where author_id = ${uid}::uuid and created_at > now() - interval '1 hour'`));
        if ((recent?.n ?? 0) >= POSTS_PER_HOUR) {
          throw new ApiError(429, 'rate_limited', `You can post ${POSTS_PER_HOUR} times per hour.`);
        }

        let parent: { id: string; root_id: string | null; author_id: string | null } | undefined;
        if (body.parentId) {
          [parent] = rowsOf<NonNullable<typeof parent>>(await tx.execute(
            sql`select id, root_id, author_id from posts
                where id = ${body.parentId}::uuid and deleted_at is null and hidden_at is null`));
          if (!parent) throw new ApiError(404, 'parent_not_found');
        }
        const rootId = parent ? (parent.root_id ?? parent.id) : null;

        const [created] = await tx.insert(posts).values({
          authorId: uid, body: text, parentId: parent?.id ?? null, rootId,
        }).returning({ id: posts.id });
        const postId = created!.id;

        for (const [position, imageId] of imageIds.entries()) {
          const attached = rowsOf<{ id: string }>(await tx.execute(sql`
            update post_images set post_id = ${postId}::uuid, position = ${position}
            where id = ${imageId}::uuid and uploader_id = ${uid}::uuid and post_id is null
            returning id`));
          if (attached.length !== 1) throw new ApiError(400, 'image_invalid', 'One of the images is not available.');
        }

        // Replying to your own post does not count toward the lurker rule (RFC §13): otherwise one
        // post plus a self-reply clears a flag. Replies to anyone else (in any thread) do count.
        if (!parent || parent.author_id !== uid) {
          await tx.insert(contributions).values({ userId: uid, kind: parent ? 'reply' : 'post', refId: postId });
        }
        if (parent?.author_id && parent.author_id !== uid) {
          await tx.insert(notifications).values({
            userId: parent.author_id, kind: 'reply', payload: { postId, rootId, actorId: uid },
          });
        }
        return postId;
      });

      return (await getPost(db, uid, id))!;
    }, {
      body: t.Object({
        body: t.Optional(t.String()), parentId: t.Optional(t.String()), imageIds: t.Optional(t.Array(t.String())),
      }),
    })

    .get('/posts/:id', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const uid = a.user.id;
      const target = await visiblePost(params.id);
      if (!target) throw new ApiError(404, 'not_found');
      const rootId = target.root_id ?? target.id;
      const [rootRow] = await rows<PostRow>(db, sql`${postSelect(uid)} where p.id = ${rootId}::uuid and p.hidden_at is null`);
      if (!rootRow) throw new ApiError(404, 'not_found');
      const replyRows = await rows<PostRow>(db, sql`
        ${postSelect(uid)}
        where p.root_id = ${rootId}::uuid and p.hidden_at is null
        order by p.created_at asc, p.id asc
        limit 1000`);
      return { root: toPost(rootRow, uid), replies: replyRows.map((r) => toPost(r, uid)), focusId: params.id };
    })

    .patch('/posts/:id', async ({ auth, params, body }) => {
      const a = requireSeated(auth);
      const uid = a.user.id;
      const p = await visiblePost(params.id);
      if (!p || p.deleted) throw new ApiError(404, 'not_found');
      if (p.author_id !== uid) throw new ApiError(403, 'not_author');
      if (Date.now() - p.created_ms > EDIT_WINDOW_MINUTES * 60_000) {
        throw new ApiError(409, 'edit_window_closed', `Posts can be edited for ${EDIT_WINDOW_MINUTES} minutes.`);
      }
      const [img] = await rows<{ n: number }>(db, sql`select count(*)::int as n from post_images where post_id = ${p.id}::uuid`);
      const text = cleanBody(body.body, (img?.n ?? 0) > 0);
      await db.execute(sql`update posts set body = ${text}, edited_at = now() where id = ${p.id}::uuid`);
      return (await getPost(db, uid, p.id))!;
    }, { body: t.Object({ body: t.String() }) })

    .delete('/posts/:id', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const uid = a.user.id;
      const p = await visiblePost(params.id);
      if (!p || p.deleted) throw new ApiError(404, 'not_found');
      if (p.author_id !== uid) throw new ApiError(403, 'not_author');
      const keys = await db.transaction(async (tx) => {
        await tx.execute(sql`update posts set deleted_at = now(), body = '' where id = ${p.id}::uuid`);
        const gone = rowsOf<{ r2_key: string }>(await tx.execute(
          sql`delete from post_images where post_id = ${p.id}::uuid returning r2_key`));
        await tx.execute(sql`delete from contributions where ref_id = ${p.id}::uuid and kind in ('post', 'reply')`);
        return gone.map((g) => g.r2_key);
      });
      await removeImages(keys);
      return { ok: true };
    })

    .post('/posts/:id/like', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const uid = a.user.id;
      await hit(db, 'like', uid);
      const p = await visiblePost(params.id);
      if (!p || p.deleted) throw new ApiError(404, 'not_found');
      const inserted = await rows(db, sql`
        insert into likes(user_id, post_id) values (${uid}::uuid, ${p.id}::uuid)
        on conflict do nothing returning post_id`);
      if (inserted.length && p.author_id && p.author_id !== uid) {
        // once per liker + post, ever (survives unlike/relike)
        await db.execute(sql`
          insert into notifications(user_id, kind, payload)
          select ${p.author_id}::uuid, 'like',
                 jsonb_build_object('postId', ${p.id}::text, 'rootId', ${p.root_id}::text, 'actorId', ${uid}::text)
          where not exists (
            select 1 from notifications
            where user_id = ${p.author_id}::uuid and kind = 'like'
              and payload->>'postId' = ${p.id}::text and payload->>'actorId' = ${uid}::text)`);
      }
      return { likeCount: await likeCount(db, p.id), likedByMe: true as const };
    })

    .delete('/posts/:id/like', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const p = await visiblePost(params.id);
      if (!p) throw new ApiError(404, 'not_found');
      await db.execute(sql`delete from likes where user_id = ${a.user.id}::uuid and post_id = ${p.id}::uuid`);
      return { likeCount: await likeCount(db, p.id), likedByMe: false as const };
    })

    .post('/uploads', async ({ auth, body }) => {
      const a = requireSeated(auth);
      await hit(db, 'upload', a.user.id);
      const uid = a.user.id;
      const file = (body as { file?: unknown }).file as File | undefined;
      if (!file || typeof file.arrayBuffer !== 'function') throw new ApiError(400, 'bad_request', 'Missing file.');
      if (file.size > IMAGE_MAX_BYTES) throw new ApiError(413, 'image_too_large', 'Images can be at most 5 MB.');

      const [pending] = await rows<{ n: number }>(db, sql`
        select count(*)::int as n from post_images where uploader_id = ${uid}::uuid and post_id is null`);
      if ((pending?.n ?? 0) >= MAX_PENDING_UPLOADS) throw new ApiError(429, 'rate_limited', 'Too many unattached uploads.');

      let out: { data: Buffer; info: { width: number; height: number } };
      try {
        const img = sharp(new Uint8Array(await file.arrayBuffer()), { limitInputPixels: 50_000_000 });
        const meta = await img.metadata();
        if (!meta.format || !['jpeg', 'png', 'webp', 'gif'].includes(meta.format)) throw new Error('format');
        // No withMetadata(): sharp drops EXIF/ICC/XMP. rotate() bakes orientation in first.
        out = await img
          .rotate()
          .resize({ width: IMAGE_MAX_DIMENSION, height: IMAGE_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer({ resolveWithObject: true });
      } catch {
        throw new ApiError(415, 'image_unsupported', 'Use a JPEG, PNG, WebP or GIF image.');
      }

      const key = `${crypto.randomUUID()}.webp`;
      await storage.put(key, new Uint8Array(out.data), 'image/webp');
      try {
        const [row] = await db.insert(postImages).values({
          uploaderId: uid, r2Key: key, width: out.info.width, height: out.info.height,
        }).returning({ id: postImages.id });
        return { id: row!.id, url: mediaUrl(key), width: out.info.width, height: out.info.height };
      } catch (e) {
        await storage.delete(key).catch(() => {});
        throw e;
      }
    }, { body: t.Object({ file: t.Any() }) })

    .get('/media/:key', async ({ auth, params }) => {
      requireSeated(auth);
      if (!isValidKey(params.key)) throw new ApiError(404, 'not_found');
      const f = await storage.get(params.key);
      if (!f) throw new ApiError(404, 'not_found');
      return new Response(f.bytes as BodyInit, {
        headers: { 'content-type': f.contentType, 'cache-control': 'private, max-age=31536000, immutable' },
      });
    });
};

async function likeCount(db: Db, postId: string): Promise<number> {
  const [r] = await rows<{ n: number }>(db, sql`select count(*)::int as n from likes where post_id = ${postId}::uuid`);
  return Number(r?.n ?? 0);
}

export type { Post };
