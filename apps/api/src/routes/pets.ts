import { Elysia, t } from 'elysia';
import { sql } from 'drizzle-orm';
import { pets, rows, type Db } from '@anti/db';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import {
  getPet, listOwnerPets, listPetPosts, ownedPet, petWithPosts, PET_LABELS, PETS_MAX, SPECIES,
  type PetLabel, type Species,
} from '../lib/pets';
import { authPlugin, requireSeated } from '../plugins/auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pageQuery = t.Object({ cursor: t.Optional(t.String()), limit: t.Optional(t.String()) });

function cleanName(raw: unknown): string {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new ApiError(400, 'pet_name_invalid', 'Give the pet a name.');
  if (Array.from(name).length > 40) throw new ApiError(400, 'pet_name_invalid', 'Pet names are at most 40 characters.');
  return name;
}

function cleanSpecies(raw: unknown): Species {
  if (!SPECIES.includes(raw as Species)) throw new ApiError(400, 'pet_species_invalid', 'Choose dog, cat or bird.');
  return raw as Species;
}

function cleanVariant(raw: unknown): number {
  const n = Number(raw ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new ApiError(400, 'pet_variant_invalid', 'That look is not available.');
  return n;
}

/** A pending upload (POST /uploads) becomes the pet's picture and leaves the post queue. */
async function takeUpload(db: Db, ownerId: string, uploadId: string): Promise<string> {
  if (!UUID_RE.test(uploadId)) throw new ApiError(400, 'image_invalid', 'That picture is not available.');
  const [img] = await rows<{ r2_key: string }>(db, sql`
    delete from post_images where id = ${uploadId}::uuid and uploader_id = ${ownerId}::uuid and post_id is null
    returning r2_key`);
  if (!img) throw new ApiError(400, 'image_invalid', 'That picture is not available.');
  return img.r2_key;
}

/**
 * RFC §10.17: pets. A pet is owned by one member (up to PETS_MAX), posts as itself, and appears
 * in Pet Corner. It is not an account: no seat, no PIN, no sign-in.
 */
export const petRoutes = (deps: Deps) => {
  const { db, storage } = deps;

  return new Elysia()
    .use(authPlugin(deps))

    /** Pet Corner: the newest pet posts, whoever owns them. */
    .get('/pets', async ({ auth, query }) => {
      const a = requireSeated(auth);
      return listPetPosts(db, a.user.id, a.user.handle, query);
    }, { query: pageQuery })

    /** The pets on your own profile. */
    .get('/pets/mine', async ({ auth }) => {
      const a = requireSeated(auth);
      return { items: await listOwnerPets(db, a.user.id) };
    })

    /** One pet: its header and its posts. */
    .get('/pets/:id', async ({ auth, params }) => {
      const a = requireSeated(auth);
      if (!UUID_RE.test(params.id)) throw new ApiError(404, 'not_found');
      const found = await petWithPosts(db, a.user.id, a.user.handle, params.id);
      if (!found) throw new ApiError(404, 'not_found');
      return found;
    })

    /** Add a pet: name, species, and a look (0–99) or a photo from POST /uploads. */
    .post('/pets', async ({ auth, body }) => {
      const a = requireSeated(auth);
      const name = cleanName(body.name);
      const species = cleanSpecies(body.species);
      const avatarId = body.avatarId ? String(body.avatarId) : null;
      const variant = cleanVariant(body.avatarVariant);

      const count = await db.transaction(async (tx) => {
        const t = tx as unknown as Db;
        const [n] = await rows<{ n: number }>(t, sql`select count(*)::int as n from pets where owner_id = ${a.user.id}::uuid`);
        if ((n?.n ?? 0) >= PETS_MAX) throw new ApiError(409, 'pet_limit', `A member can have ${PETS_MAX} pets.`);
        const avatarKey = avatarId ? await takeUpload(t, a.user.id, avatarId) : null;
        const [created] = await t.insert(pets).values({
          ownerId: a.user.id, name, species, avatarVariant: variant, avatarKey,
        }).returning({ id: pets.id });
        return created!.id;
      });
      return (await getPet(db, count))!;
    }, {
      body: t.Object({
        name: t.String({ maxLength: 80 }), species: t.String({ maxLength: 10 }),
        avatarVariant: t.Optional(t.Number()), avatarId: t.Optional(t.String({ maxLength: 40 })),
      }),
    })

    /** Rename, change species/look, set a photo, or take the photo away. */
    .patch('/pets/:id', async ({ auth, params, body }) => {
      const a = requireSeated(auth);
      if (!UUID_RE.test(params.id)) throw new ApiError(404, 'not_found');
      const owned = await ownedPet(db, a.user.id, params.id);
      if (!owned) throw new ApiError(404, 'not_found');
      const name = body.name === undefined ? owned.name : cleanName(body.name);
      const species = body.species === undefined ? owned.species : cleanSpecies(body.species);
      const variant = body.avatarVariant === undefined ? owned.avatar.variant : cleanVariant(body.avatarVariant);
      let avatarKey: string | null | undefined;
      if (body.removeAvatar) avatarKey = null;
      if (body.avatarId) avatarKey = await takeUpload(db, a.user.id, String(body.avatarId));
      await db.execute(sql`
        update pets set name = ${name}, species = ${species}, avatar_variant = ${variant}
          ${avatarKey === undefined ? sql`` : sql`, avatar_key = ${avatarKey}`}
        where id = ${params.id}::uuid and owner_id = ${a.user.id}::uuid`);
      return (await getPet(db, params.id))!;
    }, {
      body: t.Object({
        name: t.Optional(t.String({ maxLength: 80 })), species: t.Optional(t.String({ maxLength: 10 })),
        avatarVariant: t.Optional(t.Number()), avatarId: t.Optional(t.String({ maxLength: 40 })),
        removeAvatar: t.Optional(t.Boolean()),
      }),
    })

    /** Delete a pet and everything it wrote (posts, images, replies), after the app warns. */
    .delete('/pets/:id', async ({ auth, params }) => {
      const a = requireSeated(auth);
      if (!UUID_RE.test(params.id)) throw new ApiError(404, 'not_found');
      const owned = await ownedPet(db, a.user.id, params.id);
      if (!owned) throw new ApiError(404, 'not_found');
      const [count] = await rows<{ n: number }>(db, sql`
        select count(*)::int as n from posts where pet_id = ${params.id}::uuid and parent_id is null`);
      const keys = await rows<{ r2_key: string }>(db, sql`
        select r2_key from post_images
         where post_id in (select id from posts where pet_id = ${params.id}::uuid
                           union select id from posts where parent_id in (select id from posts where pet_id = ${params.id}::uuid))`);
      await db.transaction(async (tx) => {
        const t = tx as unknown as Db;
        await t.execute(sql`delete from posts where parent_id in (select id from posts where pet_id = ${params.id}::uuid)`);
        await t.execute(sql`delete from posts where pet_id = ${params.id}::uuid`);
        await t.execute(sql`delete from pets where id = ${params.id}::uuid and owner_id = ${a.user.id}::uuid`);
      });
      await Promise.all(keys.map((k) => storage.delete(k.r2_key).catch(() => {})));
      return { ok: true as const, posts: Number(count?.n ?? 0) };
    });
};

/** For GET /members/:handle: the pets a member shows on their profile. */
export { listOwnerPets };
