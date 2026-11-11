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
import { FEED_WHERE, markCaughtUp, resumeVisit, startVisit } from '../lib/feed';
import { isValidKey } from '../lib/storage';
import { hit } from '../lib/ratelimit';
import { notifyUpdate, updatePlace } from '../lib/updates';
import { addMentions, mentionIds, mentionsIn, notifyMentions, removeMentions, resolveMentionUsers } from '../lib/mentions';
import { ownedPet, PET_LABELS, type PetLabel } from '../lib/pets';
import { checkKind, checkTitle, dropAudio } from '../lib/monologues';
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

  /** A post anyone may act on: not hidden after reports (`withHidden`: admins reviewing a thread). */
  async function visiblePost(id: string, withHidden = false) {
    if (!UUID_RE.test(id)) return null;
    const [p] = await rows<{ id: string; author_id: string | null; root_id: string | null; parent_id: string | null; created_ms: number; deleted: boolean }>(
      db,
      sql`select id, author_id, root_id, parent_id, (extract(epoch from created_at) * 1000)::float8 as created_ms,
                 (deleted_at is not null) as deleted
          from posts where id = ${id}::uuid ${withHidden ? sql`` : sql`and hidden_at is null`}`,
    );
    return p ?? null;
  }

  async function removeImages(keys: string[]) {
    await Promise.all(keys.map((k) => storage.delete(k).catch((e) => console.error('storage delete failed', k, e))));
  }

  return new Elysia()
    .use(authPlugin(deps))
    // RFC §10.11: newest first, always. `visit=1` (first page only) starts a visit and returns
    // the frozen "new since" line; `since=` resumes one after a reload. The 30-second "new posts"
    // poll sends neither, so it never starts a visit.
    .get('/feed', async ({ auth, query }) => {
      const a = requireSeated(auth);
      const page = await listPosts(db, a.user.id, FEED_WHERE(), query);
      if (query.cursor || (!query.visit && !query.since)) return page;
      const visit = query.since
        ? await resumeVisit(db, a.user.id, query.since)
        : await startVisit(db, a.user.id, !!a.visitor);
      return { ...page, visit };
    }, { query: t.Object({ ...pageQuery.properties, visit: t.Optional(t.String()), since: t.Optional(t.String()) }) })

    // the end card was on screen: everything up to `through` counts as read (closed to visitors)
    .post('/feed/caught-up', async ({ auth, body }) => {
      const a = requireSeated(auth);
      return markCaughtUp(db, a.user.id, body.through, body.visitId);
    }, { body: t.Object({ through: t.String(), visitId: t.Optional(t.Number()) }) })

    .post('/posts', async ({ auth, body }) => {
      const a = requireSeated(auth);
      const uid = a.user.id;
      const imageIds = [...new Set(body.imageIds ?? [])];
      if (imageIds.length > POST_MAX_IMAGES || imageIds.some((i) => !UUID_RE.test(i))) {
        throw new ApiError(400, 'image_invalid', `Up to ${POST_MAX_IMAGES} valid images per post.`);
      }
      // RFC §10.22: a monologue is its recording; the words are an optional note under it
      const mono = body.monologue;
      if (mono && !UUID_RE.test(mono.audioId)) throw new ApiError(400, 'audio_invalid', 'That recording is not available.');
      if (mono && (body.parentId || body.collabId || body.eventId || body.petId || imageIds.length)) {
        throw new ApiError(400, 'bad_request', 'A monologue stands on its own: no pictures, not a reply, not in a collab or event, not as a pet.');
      }
      if (mono && mono.mine !== true) throw new ApiError(400, 'not_yours', 'Only post what is yours to share.');
      const monoTitle = mono ? checkTitle(mono.title) : null;
      const monoKind = mono ? checkKind(mono.kind) : null;
      const text = cleanBody(body.body, imageIds.length > 0 || !!mono);
      if (body.parentId !== undefined && !UUID_RE.test(body.parentId)) throw new ApiError(404, 'parent_not_found');
      if (body.parentId && (body.collabId || body.eventId)) throw new ApiError(400, 'bad_request', 'Replies follow their thread.');
      // an update for a collab and/or an event page (RFC §10.5): checked before the transaction
      const place = body.parentId ? null : await updatePlace(db, uid, body.collabId, body.eventId);

      // RFC §10.17: a pet post is written as the pet but authored by its owner.
      if (body.petId && !UUID_RE.test(body.petId)) throw new ApiError(404, 'pet_not_found');
      const pet = body.petId ? await ownedPet(db, uid, body.petId) : null;
      if (body.petId && !pet) throw new ApiError(404, 'pet_not_found');
      if (pet && (body.parentId || body.collabId || body.eventId)) {
        throw new ApiError(400, 'bad_request', 'A pet post stands on its own.');
      }
      const petLabel: PetLabel | null = pet
        ? (PET_LABELS.includes(body.petLabel as PetLabel) ? (body.petLabel as PetLabel) : 'everyday')
        : null;
      // RFC §10.17: a pet post carries one picture
      if (pet && imageIds.length > 1) {
        throw new ApiError(400, 'image_invalid', 'A pet post carries one picture.');
      }

      const id = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${uid}::text, 0))`);
        const [recent] = rowsOf<{ n: number }>(await tx.execute(
          sql`select count(*)::int as n from posts where author_id = ${uid}::uuid and created_at > now() - interval '1 hour'`));
        if ((recent?.n ?? 0) >= POSTS_PER_HOUR) {
          throw new ApiError(429, 'rate_limited', `You can post ${POSTS_PER_HOUR} times per hour.`);
        }

        let parent: { id: string; root_id: string | null; author_id: string | null; collab_id: string | null; event_id: string | null } | undefined;
        if (body.parentId) {
          [parent] = rowsOf<NonNullable<typeof parent>>(await tx.execute(
            sql`select id, root_id, author_id, collab_id, event_id from posts
                where id = ${body.parentId}::uuid and deleted_at is null and hidden_at is null`));
          if (!parent) throw new ApiError(404, 'parent_not_found');
        }
        const rootId = parent ? (parent.root_id ?? parent.id) : null;

        const [created] = await tx.insert(posts).values({
          authorId: uid, body: text, parentId: parent?.id ?? null, rootId,
          collabId: parent ? parent.collab_id : place?.collabId ?? null,
          eventId: parent ? parent.event_id : place?.eventId ?? null,
          petId: pet?.id ?? null,
          petLabel,
        }).returning({ id: posts.id });
        const postId = created!.id;

        for (const [position, imageId] of imageIds.entries()) {
          const attached = rowsOf<{ id: string }>(await tx.execute(sql`
            update post_images set post_id = ${postId}::uuid, position = ${position}
            where id = ${imageId}::uuid and uploader_id = ${uid}::uuid and post_id is null
            returning id`));
          if (attached.length !== 1) throw new ApiError(400, 'image_invalid', 'One of the images is not available.');
        }
        if (mono) {
          const attached = rowsOf<{ id: string }>(await tx.execute(sql`
            update monologues set post_id = ${postId}::uuid, title = ${monoTitle}, kind = ${monoKind}
            where id = ${mono.audioId}::uuid and uploader_id = ${uid}::uuid and post_id is null
            returning id`));
          if (attached.length !== 1) throw new ApiError(400, 'audio_invalid', 'That recording is not available.');
        }

        // Replying to your own post does not count toward the lurker rule (RFC §13): otherwise one
        // post plus a self-reply clears a flag. Replies to anyone else (in any thread) do count.
        // A pet post is never a contribution (RFC §10.17).
        if (!pet && (!parent || parent.author_id !== uid)) {
          await tx.insert(contributions).values({ userId: uid, kind: parent ? 'reply' : 'post', refId: postId });
        }
        if (parent?.author_id && parent.author_id !== uid) {
          await tx.insert(notifications).values({
            userId: parent.author_id, kind: 'reply', payload: { postId, rootId, actorId: uid },
          });
        }
        // RFC §10.16: @mentions become links and one notification each; the person replied to
        // already has the reply notification, so they are not told twice. A pet post writes as the
        // pet, and mentions name members, so pet posts do not carry mentions (§10.17).
        if (!pet) {
          const mentioned = await resolveMentionUsers(tx as unknown as Db, mentionsIn(text), uid);
          await addMentions(tx as unknown as Db, postId, mentioned.map((m) => m.id));
          await notifyMentions(tx as unknown as Db, {
            postId, rootId, actorId: uid, userIds: mentioned.map((m) => m.id), skip: parent?.author_id ?? null,
          });
        }
        if (place) await notifyUpdate(tx as unknown as Db, place, uid, postId);
        // RFC §10.11: a member's first feed post tells whoever invited them, the person most
        // likely to say hello. Once per member, ever (a deleted first post does not ring twice).
        if (!parent && !place && !pet) {
          await tx.execute(sql`
            insert into notifications(user_id, kind, payload)
            select u.invited_by, 'invitee_first_post', jsonb_build_object('postId', ${postId}::text, 'actorId', ${uid}::text)
              from users u join users inv on inv.id = u.invited_by
             where u.id = ${uid}::uuid and inv.state in ('active', 'flagged_lurker')
               and not exists (select 1 from posts q
                                where q.author_id = ${uid}::uuid and q.parent_id is null and q.collab_id is null
                                  and q.event_id is null and q.pet_id is null and q.id <> ${postId}::uuid)
               and not exists (select 1 from notifications n
                                where n.kind = 'invitee_first_post' and n.payload->>'actorId' = ${uid}::text)`);
        }
        return postId;
      });

      return (await getPost(db, uid, id))!;
    }, {
      body: t.Object({
        body: t.Optional(t.String()), parentId: t.Optional(t.String()), imageIds: t.Optional(t.Array(t.String())),
        collabId: t.Optional(t.String()), eventId: t.Optional(t.String()),
        petId: t.Optional(t.String()), petLabel: t.Optional(t.String({ maxLength: 20 })),
        monologue: t.Optional(t.Object({
          audioId: t.String(), title: t.String({ maxLength: 400 }), kind: t.String({ maxLength: 20 }), mine: t.Boolean(),
        })),
      }),
    })

    .get('/posts/:id', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const uid = a.user.id;
      // admins see posts hidden after reports (marked hidden) so they can review them; nobody else does
      const ops = a.user.role === 'ops';
      const notHidden = ops ? sql`` : sql`and p.hidden_at is null`;
      const target = await visiblePost(params.id, ops);
      if (!target) throw new ApiError(404, 'not_found');
      const rootId = target.root_id ?? target.id;
      const [rootRow] = await rows<PostRow>(db, sql`${postSelect(uid)} where p.id = ${rootId}::uuid ${notHidden}`);
      if (!rootRow) throw new ApiError(404, 'not_found');
      const replyRows = await rows<PostRow>(db, sql`
        ${postSelect(uid)}
        where p.root_id = ${rootId}::uuid ${notHidden}
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
      const [img] = await rows<{ n: number; mono: boolean }>(db, sql`
        select (select count(*)::int from post_images where post_id = ${p.id}::uuid) as n,
               exists(select 1 from monologues where post_id = ${p.id}::uuid) as mono`);
      // RFC §10.22: a monologue's title and kind can change in the same window; never its sound
      const mono = !!img?.mono;
      if (!mono && (body.title !== undefined || body.kind !== undefined)) throw new ApiError(400, 'bad_request', 'Only a monologue has a title.');
      const monoTitle = mono && body.title !== undefined ? checkTitle(body.title) : null;
      const monoKind = mono && body.kind !== undefined ? checkKind(body.kind) : null;
      const text = cleanBody(body.body, (img?.n ?? 0) > 0 || mono);
      // RFC §10.16: an edit notifies only the people newly mentioned; removals just drop the link.
      const next = await resolveMentionUsers(db, mentionsIn(text), uid);
      const before = await mentionIds(db, p.id);
      const nextIds = next.map((m) => m.id);
      const added = nextIds.filter((id) => !before.includes(id));
      const removed = before.filter((id) => !nextIds.includes(id));
      const [parent] = p.parent_id
        ? await rows<{ author_id: string | null }>(db, sql`select author_id from posts where id = ${p.parent_id}::uuid`)
        : [];
      await db.transaction(async (tx) => {
        await tx.execute(sql`update posts set body = ${text}, edited_at = now() where id = ${p.id}::uuid`);
        if (monoTitle !== null || monoKind !== null) {
          await tx.execute(sql`update monologues set title = coalesce(${monoTitle}, title), kind = coalesce(${monoKind}, kind)
                                where post_id = ${p.id}::uuid`);
        }
        const t = tx as unknown as Db;
        await removeMentions(t, p.id, removed);
        await addMentions(t, p.id, added);
        await notifyMentions(t, {
          postId: p.id, rootId: p.root_id, actorId: uid, userIds: added, skip: parent?.author_id ?? null,
        });
      });
      return (await getPost(db, uid, p.id))!;
    }, { body: t.Object({ body: t.String(), title: t.Optional(t.String({ maxLength: 400 })), kind: t.Optional(t.String({ maxLength: 20 })) }) })

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
        // RFC §10.22: deleting a monologue erases its sound, not just hides it
        return [...gone.map((g) => g.r2_key), ...(await dropAudio(tx as unknown as Db, [p.id]))];
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
      return { likeCount: p.author_id === uid ? await likeCount(db, p.id) : null, likedByMe: true as const };
    })

    .delete('/posts/:id/like', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const p = await visiblePost(params.id);
      if (!p) throw new ApiError(404, 'not_found');
      await db.execute(sql`delete from likes where user_id = ${a.user.id}::uuid and post_id = ${p.id}::uuid`);
      return { likeCount: p.author_id === a.user.id ? await likeCount(db, p.id) : null, likedByMe: false as const };
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

    .get('/media/:key', async ({ auth, params, request }) => {
      requireSeated(auth);
      if (!isValidKey(params.key)) throw new ApiError(404, 'not_found');
      const f = await storage.get(params.key);
      if (!f) throw new ApiError(404, 'not_found');
      return mediaResponse(f.bytes, f.contentType, request.headers.get('range'));
    });
};

const CACHE = 'private, max-age=31536000, immutable';

/**
 * A stored file, whole or (for the monologues' players: Safari will not play audio without it)
 * the byte range asked for. One range only; anything odd gets the whole file.
 */
export function mediaResponse(bytes: Uint8Array, contentType: string, range: string | null): Response {
  const size = bytes.byteLength;
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start: number; let end: number;
    if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
    else { const n = Math.min(Number(m[2]), size); start = size - n; end = size - 1; }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes' } });
    }
    return new Response(bytes.subarray(start, end + 1) as BodyInit, {
      status: 206,
      headers: {
        'content-type': contentType, 'cache-control': CACHE, 'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1),
      },
    });
  }
  return new Response(bytes as BodyInit, {
    headers: { 'content-type': contentType, 'cache-control': CACHE, 'accept-ranges': 'bytes', 'content-length': String(size) },
  });
}

async function likeCount(db: Db, postId: string): Promise<number> {
  const [r] = await rows<{ n: number }>(db, sql`select count(*)::int as n from likes where post_id = ${postId}::uuid`);
  return Number(r?.n ?? 0);
}

export type { Post };
