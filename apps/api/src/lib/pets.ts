import { sql, type SQL } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';
import { mediaUrl, paginate, parseLimit, cursorBefore, type Page } from './posts';

/**
 * RFC §10.17: Pet Corner. A pet is a content identity owned by one member; posts carry `pet_id`
 * and are written by the owner (`author_id`), so notifications, reports and moderation keep
 * working with the existing machinery while the card shows the pet.
 */
export type Species = 'dog' | 'cat' | 'bird';
export type PetLabel = 'everyday' | 'advice' | 'health' | 'help';
export const SPECIES: readonly Species[] = ['dog', 'cat', 'bird'];
export const PET_LABELS: readonly PetLabel[] = ['everyday', 'advice', 'health', 'help'];
export const PETS_MAX = 3;

export type Pet = {
  id: string; name: string; species: Species;
  avatar: { variant: number; url: string | null };
  owner: { handle: string; displayName: string };
};

export type PetPost = {
  id: string; body: string; createdAt: string; label: PetLabel;
  images: { id: string; url: string; width: number; height: number }[];
  likeCount: number | null; likedByMe: boolean; replyCount: number;
  pet: Pet;
  canDelete: boolean; canReport: boolean;
};

const iso = (col: SQL) =>
  sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

type PetRow = {
  id: string; name: string; species: Species; avatar_variant: number; avatar_key: string | null;
  o_handle: string; o_display: string;
};

const toPet = (r: PetRow): Pet => ({
  id: r.id, name: r.name, species: r.species,
  avatar: { variant: Number(r.avatar_variant), url: r.avatar_key ? mediaUrl(r.avatar_key) : null },
  owner: { handle: r.o_handle, displayName: r.o_display },
});

const petSelect = sql`
  select p.id, p.name, p.species::text as species, p.avatar_variant, p.avatar_key,
         u.handle as o_handle, u.display_name as o_display
    from pets p join users u on u.id = p.owner_id`;

export async function listOwnerPets(db: Db, ownerId: string): Promise<Pet[]> {
  const found = await rows<PetRow>(db, sql`${petSelect} where p.owner_id = ${ownerId}::uuid order by p.created_at asc`);
  return found.map(toPet);
}

/** A pet owned by this member (or null), for posting and editing. */
export async function ownedPet(db: Db, ownerId: string, petId: string): Promise<Pet | null> {
  const [r] = await rows<PetRow>(db, sql`${petSelect} where p.id = ${petId}::uuid and p.owner_id = ${ownerId}::uuid`);
  return r ? toPet(r) : null;
}

export async function getPet(db: Db, petId: string): Promise<Pet | null> {
  const [r] = await rows<PetRow>(db, sql`${petSelect} where p.id = ${petId}::uuid and u.state <> 'deleted'`);
  return r ? toPet(r) : null;
}

type PetPostRow = {
  id: string; body: string; cursor_ts: string; created_iso: string; pet_label: PetLabel;
  pet_id: string; pet_name: string; pet_species: Species; avatar_variant: number; avatar_key: string | null;
  o_handle: string; o_display: string;
  like_count: number; liked_by_me: boolean; reply_count: number;
  images: Array<{ id: string; key: string; width: number; height: number }> | string;
};

const postSelect = (viewerId: string) => sql`
  select p.id, p.body, p.created_at::text as cursor_ts, ${iso(sql`p.created_at`)} as created_iso,
    coalesce(p.pet_label, 'everyday') as pet_label,
    pe.id as pet_id, pe.name as pet_name, pe.species::text as pet_species, pe.avatar_variant, pe.avatar_key,
    u.handle as o_handle, u.display_name as o_display,
    (select count(*)::int from likes l where l.post_id = p.id) as like_count,
    exists(select 1 from likes l where l.post_id = p.id and l.user_id = ${viewerId}::uuid) as liked_by_me,
    (select count(*)::int from posts r where r.parent_id = p.id and r.deleted_at is null and r.hidden_at is null) as reply_count,
    coalesce((select json_agg(json_build_object('id', i.id, 'key', i.r2_key, 'width', i.width, 'height', i.height)
                              order by i.position) from post_images i where i.post_id = p.id), '[]'::json) as images
  from posts p
  join pets pe on pe.id = p.pet_id
  join users u on u.id = pe.owner_id`;

function toPetPost(r: PetPostRow, viewerId: string, viewerHandle: string): PetPost {
  const imgs = typeof r.images === 'string' ? (JSON.parse(r.images) as Exclude<PetPostRow['images'], string>) : r.images;
  const pet: Pet = {
    id: r.pet_id, name: r.pet_name, species: r.pet_species,
    avatar: { variant: Number(r.avatar_variant), url: r.avatar_key ? mediaUrl(r.avatar_key) : null },
    owner: { handle: r.o_handle, displayName: r.o_display },
  };
  const mine = r.o_handle.toLowerCase() === viewerHandle.toLowerCase();
  return {
    id: r.id, body: r.body, createdAt: r.created_iso, label: r.pet_label,
    images: imgs.map((i) => ({ id: i.id, url: mediaUrl(i.key), width: i.width, height: i.height })),
    likeCount: mine ? Number(r.like_count) : null,
    likedByMe: !!r.liked_by_me,
    replyCount: Number(r.reply_count),
    pet,
    canDelete: mine,
    canReport: !mine,
  };
}

/** The Pet Corner feed: newest pet posts from seated owners (replies are not listed here). */
export async function listPetPosts(
  db: Db, viewerId: string, viewerHandle: string, opts: { cursor?: string; limit?: string },
): Promise<Page<PetPost>> {
  const limit = parseLimit(opts.limit);
  const found = await rows<PetPostRow>(db, sql`
    ${postSelect(viewerId)}
    where p.parent_id is null and p.deleted_at is null and p.hidden_at is null
      and u.state in ('active', 'flagged_lurker')
      ${cursorBefore(sql`p.created_at`, sql`p.id`, opts.cursor)}
    order by p.created_at desc, p.id desc
    limit ${limit + 1}`);
  const { page, nextCursor } = paginate(found, limit);
  return { items: page.map((r) => toPetPost(r, viewerId, viewerHandle)), nextCursor };
}

/** One pet's page: the pet and its posts. */
export async function petWithPosts(
  db: Db, viewerId: string, viewerHandle: string, petId: string,
): Promise<{ pet: Pet; posts: PetPost[] } | null> {
  const pet = await getPet(db, petId);
  if (!pet) return null;
  const found = await rows<PetPostRow>(db, sql`
    ${postSelect(viewerId)}
    where p.pet_id = ${petId}::uuid and p.parent_id is null and p.deleted_at is null and p.hidden_at is null
    order by p.created_at desc, p.id desc
    limit 60`);
  return { pet, posts: found.map((r) => toPetPost(r, viewerId, viewerHandle)) };
}
