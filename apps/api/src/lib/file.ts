/**
 * RFC §10.24, the File: a member's drawer of 12 pages, one card a page. Pages 0–6 hold the
 * member's own cards (page 0 is "Me": always first, never renamed); pages 7–11 hold cards other
 * members made for them, which only the member can place. A card is a headline, 1–20 photos (each
 * with an optional caption) and a description.
 * Like the portfolio, this is about yourself: never a feed item, never a lurker contribution.
 */
import { sql, type SQL } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';
import { FILE, fileSide } from '@anti/shared';
import { ApiError } from './errors';
import { mediaUrl, UUID_RE } from './posts';
import type { Storage } from './storage';

type Person = { handle: string; displayName: string; gender: string | null };
export type FilePhoto = { id: string; url: string; width: number; height: number; caption: string };
export type FileCard = {
  id: string; headline: string; description: string; photos: FilePhoto[];
  /** who made it; null when that member is gone */
  maker: Person | null;
  /** made by the File's owner for themselves */
  own: boolean;
  /** the viewer made it (and may edit or delete it) */
  mine: boolean;
  /** the page it is on in its owner's File, or null */
  page: number | null;
  createdAt: string; updatedAt: string;
};
export type FilePage = { position: number; side: 'own' | 'gift'; label: string; card: FileCard | null };
export type FileView = { owner: Person; mine: boolean; pages: FilePage[] };
export type PhotoInput = { id: string; caption?: string };

const iso = (col: SQL) => sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const j = <T,>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
};
const rowsOf = <T>(res: unknown): T[] => (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];
const SEEN = sql`('active', 'flagged_lurker', 'archived')`;

type CardRow = {
  id: string; maker_id: string; for_id: string; headline: string; description: string; hidden: boolean;
  mh: string | null; md: string | null; mg: string | null; page: number | null;
  created_iso: string; updated_iso: string; photos: unknown;
};
type PhotoRow = { id: string; key: string; width: number; height: number; caption: string };

const cardSelect = sql`
  select c.id, c.maker_id, c.for_id, c.headline, c.description, (c.hidden_at is not null) as hidden,
    m.handle as mh, m.display_name as md, m.gender::text as mg,
    (select pg.position from file_pages pg where pg.card_id = c.id) as page,
    ${iso(sql`c.created_at`)} as created_iso, ${iso(sql`c.updated_at`)} as updated_iso,
    coalesce((select json_agg(json_build_object('id', i.id, 'key', i.r2_key, 'width', i.width, 'height', i.height,
        'caption', i.caption) order by i.position)
      from file_card_photos i where i.card_id = c.id), '[]'::json) as photos
  from file_cards c
  left join users m on m.id = c.maker_id and m.state in ${SEEN}`;

function toCard(r: CardRow, viewerId: string): FileCard {
  return {
    id: r.id, headline: r.headline, description: r.description,
    photos: j<PhotoRow[]>(r.photos, []).map((i) => ({ id: i.id, url: mediaUrl(i.key), width: i.width, height: i.height, caption: i.caption })),
    maker: r.mh ? { handle: r.mh, displayName: r.md ?? r.mh, gender: r.mg } : null,
    own: r.maker_id === r.for_id, mine: r.maker_id === viewerId, page: r.page === null ? null : Number(r.page),
    createdAt: r.created_iso, updatedAt: r.updated_iso,
  };
}

/** A member's File as this viewer may see it: all 12 pages, empty ones included. */
export async function getFile(db: Db, viewerId: string, handle: string): Promise<FileView | null> {
  const [o] = await rows<{ id: string; handle: string; display_name: string; gender: string | null }>(db, sql`
    select id, handle, display_name, gender::text as gender from users
     where lower(handle) = lower(${handle}) and state in ${SEEN}`);
  if (!o) return null;
  const mine = o.id === viewerId;
  const labels = await rows<{ position: number; label: string }>(db, sql`
    select position, label from file_pages where user_id = ${o.id}::uuid`);
  // a card hidden after reports stays visible to its owner and its maker only
  const cards = await rows<CardRow>(db, sql`${cardSelect}
    join file_pages p on p.card_id = c.id and p.user_id = ${o.id}::uuid
    where c.for_id = ${o.id}::uuid
      and (c.hidden_at is null or ${mine} or c.maker_id = ${viewerId}::uuid)`);
  const byPage = new Map(cards.map((r) => [Number(r.page), toCard(r, viewerId)]));
  const labelAt = new Map(labels.map((l) => [Number(l.position), l.label]));
  const pages: FilePage[] = Array.from({ length: FILE.pages }, (_, position) => {
    const side = fileSide(position);
    const card = byPage.get(position) ?? null;
    // a gift page is named by who made its card; "Me" is always "Me"
    const label = position === 0 ? FILE.meLabel : side === 'gift' ? (card?.maker?.handle ?? '') : (labelAt.get(position) ?? '');
    return { position, side, label, card };
  });
  return { owner: { handle: o.handle, displayName: o.display_name, gender: o.gender }, mine, pages };
}

/** Your own cards (the ones you made for yourself), newest first; `page` says where each sits. */
export async function listMyCards(db: Db, userId: string): Promise<FileCard[]> {
  const found = await rows<CardRow>(db, sql`${cardSelect}
    where c.maker_id = ${userId}::uuid and c.for_id = ${userId}::uuid order by c.created_at desc, c.id`);
  return found.map((r) => toCard(r, userId));
}

async function getMade(db: Db, userId: string, id: string): Promise<FileCard> {
  if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found');
  const [r] = await rows<CardRow>(db, sql`${cardSelect} where c.id = ${id}::uuid and c.maker_id = ${userId}::uuid`);
  if (!r) throw new ApiError(404, 'not_found');
  return toCard(r, userId);
}

// ─── Validation ─────────────────────────────────────────────────────────────

const bad = (detail: string) => new ApiError(400, 'file_invalid', detail);

function str(v: unknown, what: string, max: number, { multiline = false } = {}): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw bad(`${what} must be text.`);
  const s = (multiline ? v.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : v.replace(/\s+/g, ' ')).trim();
  if (Array.from(s).length > max) throw bad(`${what} can be at most ${max} characters.`);
  return s;
}

function cleanPhotos(v: unknown): Required<PhotoInput>[] {
  if (!Array.isArray(v)) throw bad('Photos must be a list.');
  if (v.length < 1) throw bad('A card needs at least one photo.');
  if (v.length > FILE.photosMax) throw bad(`Up to ${FILE.photosMax} photos on a card.`);
  const seen = new Set<string>();
  return v.map((raw) => {
    const i = (raw ?? {}) as Record<string, unknown>;
    if (typeof i.id !== 'string' || !UUID_RE.test(i.id) || seen.has(i.id)) throw bad('One of the photos is not valid.');
    seen.add(i.id);
    return { id: i.id, caption: str(i.caption, 'Caption', FILE.captionMax) };
  });
}

const position = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= FILE.pages) throw new ApiError(404, 'not_found');
  return v;
};

// ─── Writes ─────────────────────────────────────────────────────────────────

const lock = (tx: Db, userId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}::text, 24))`);

/** Every member has all 12 pages; the rows are made the first time something is written. */
async function ensurePages(tx: Db, userId: string) {
  await tx.execute(sql`
    insert into file_pages (user_id, position)
    select ${userId}::uuid, g from generate_series(0, ${FILE.pages - 1}) g
    on conflict do nothing`);
}

/**
 * Replace a card's photos with `inputs`, in that order. Each is a photo already on the card or one
 * of the maker's pending uploads (moved in, same id). Photos left out are deleted; their blob keys
 * come back for removal after the transaction commits.
 */
async function syncPhotos(tx: Db, userId: string, cardId: string, inputs: Required<PhotoInput>[]): Promise<string[]> {
  const keep = inputs.map((i) => i.id);
  const gone = rowsOf<{ r2_key: string }>(await tx.execute(sql`
    delete from file_card_photos where card_id = ${cardId}::uuid
      and id not in (${sql.join(keep.map((k) => sql`${k}::uuid`), sql`, `)})
    returning r2_key`));
  for (const [pos, i] of inputs.entries()) {
    const updated = rowsOf<{ id: string }>(await tx.execute(sql`
      update file_card_photos set position = ${pos}, caption = ${i.caption}
       where id = ${i.id}::uuid and card_id = ${cardId}::uuid returning id`));
    if (updated.length) continue;
    const moved = rowsOf<{ id: string }>(await tx.execute(sql`
      with up as (
        delete from post_images where id = ${i.id}::uuid and uploader_id = ${userId}::uuid and post_id is null
        returning id, r2_key, width, height)
      insert into file_card_photos (id, card_id, r2_key, width, height, position, caption)
      select id, ${cardId}::uuid, r2_key, width, height, ${pos}, ${i.caption} from up
      returning id`));
    if (moved.length !== 1) throw bad('One of the photos is not available.');
  }
  return gone.map((g) => g.r2_key);
}

async function removeBlobs(storage: Storage, keys: string[]) {
  await Promise.all(keys.map((k) => storage.delete(k).catch((e) => console.error('storage delete failed', k, e))));
}

/** Put a card on a page of its owner's File. Whatever was there comes off (it is kept, unplaced). */
async function place(tx: Db, ownerId: string, pos: number, cardId: string | null) {
  await ensurePages(tx, ownerId);
  if (cardId) await tx.execute(sql`update file_pages set card_id = null where user_id = ${ownerId}::uuid and card_id = ${cardId}::uuid`);
  await tx.execute(sql`update file_pages set card_id = ${cardId}::uuid where user_id = ${ownerId}::uuid and position = ${pos}`);
}

/**
 * Make a card for yourself. `page` (one of your own pages, 0–6) puts it straight on that page;
 * without it the card waits, unplaced, and at most `FILE.draftsMax` may wait.
 */
export async function createCard(db: Db, userId: string, body: Record<string, unknown>): Promise<FileCard> {
  const headline = str(body.headline, 'Headline', FILE.headlineMax);
  if (!headline) throw bad('A card needs a headline.');
  const description = str(body.description, 'Description', FILE.descriptionMax, { multiline: true });
  const photos = cleanPhotos(body.photos);
  const pos = body.page === undefined || body.page === null ? null : position(body.page);
  if (pos !== null && fileSide(pos) !== 'own') throw bad('Your own cards go on your own pages.');
  const id = await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    await lock(tx, userId);
    if (pos === null) {
      const [n] = await rows<{ n: number }>(tx, sql`
        select count(*)::int as n from file_cards c
         where c.maker_id = ${userId}::uuid and c.for_id = ${userId}::uuid
           and not exists (select 1 from file_pages p where p.card_id = c.id)`);
      if ((n?.n ?? 0) >= FILE.draftsMax) throw new ApiError(409, 'file_limit', `You can keep up to ${FILE.draftsMax} cards that are not in your File. Delete one first.`);
    }
    const [created] = rowsOf<{ id: string }>(await tx.execute(sql`
      insert into file_cards (maker_id, for_id, headline, description)
      values (${userId}::uuid, ${userId}::uuid, ${headline}, ${description}) returning id`));
    await syncPhotos(tx, userId, created!.id, photos);
    if (pos !== null) await place(tx, userId, pos, created!.id);
    return created!.id;
  });
  return getMade(db, userId, id);
}

/** Change a card you made. `photos`, when given, replaces the whole list. */
export async function updateCard(db: Db, storage: Storage, userId: string, id: string, body: Record<string, unknown>): Promise<FileCard> {
  const current = await getMade(db, userId, id);
  const headline = body.headline === undefined ? current.headline : str(body.headline, 'Headline', FILE.headlineMax);
  if (!headline) throw bad('A card needs a headline.');
  const description = body.description === undefined
    ? current.description : str(body.description, 'Description', FILE.descriptionMax, { multiline: true });
  const photos = body.photos === undefined ? null : cleanPhotos(body.photos);
  const gone = await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    await tx.execute(sql`
      update file_cards set headline = ${headline}, description = ${description}, updated_at = now()
       where id = ${id}::uuid and maker_id = ${userId}::uuid`);
    return photos ? syncPhotos(tx, userId, id, photos) : [];
  });
  await removeBlobs(storage, gone);
  return getMade(db, userId, id);
}

/** Delete a card you made: it leaves whatever page it was on, and its photos are erased. */
export async function deleteCard(db: Db, storage: Storage, userId: string, id: string): Promise<void> {
  await getMade(db, userId, id);
  const gone = await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const keys = await rows<{ r2_key: string }>(tx, sql`delete from file_card_photos where card_id = ${id}::uuid returning r2_key`);
    await tx.execute(sql`delete from file_cards where id = ${id}::uuid and maker_id = ${userId}::uuid`);
    return keys.map((k) => k.r2_key);
  });
  await removeBlobs(storage, gone);
}

/**
 * Change one page of your File: its label (your own pages 1–6 only; "Me" and the gift pages name
 * themselves) and/or its card (`cardId: null` takes the card off; the card is kept).
 */
export async function setPage(db: Db, userId: string, pos: number, body: { label?: unknown; cardId?: unknown }): Promise<void> {
  position(pos);
  const side = fileSide(pos);
  let label: string | null = null;
  if (body.label !== undefined) {
    if (pos === 0 || side !== 'own') throw bad('That page’s name cannot be changed.');
    label = str(body.label, 'Label', FILE.labelMax);
  }
  const cardId = body.cardId;
  if (cardId !== undefined && cardId !== null && (typeof cardId !== 'string' || !UUID_RE.test(cardId))) throw new ApiError(404, 'not_found');
  await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    await lock(tx, userId);
    await ensurePages(tx, userId);
    if (label !== null) await tx.execute(sql`update file_pages set label = ${label} where user_id = ${userId}::uuid and position = ${pos}`);
    if (cardId === undefined) return;
    if (cardId !== null) {
      const [c] = await rows<{ maker_id: string }>(tx, sql`
        select maker_id from file_cards where id = ${cardId as string}::uuid and for_id = ${userId}::uuid`);
      if (!c) throw new ApiError(404, 'not_found');
      const own = c.maker_id === userId;
      if (own !== (side === 'own')) {
        throw bad(own ? 'Your own cards go on your own pages.' : 'A card made for you goes on one of the last five pages.');
      }
    }
    await place(tx, userId, pos, cardId as string | null);
  });
}

/**
 * Reorder your own pages 1–6 (a page moves with its label and its card). `order` lists those six
 * positions in their new order; "Me" stays first.
 */
export async function reorderPages(db: Db, userId: string, order: unknown): Promise<void> {
  const movable = Array.from({ length: FILE.ownPages - 1 }, (_, i) => i + 1);
  if (!Array.isArray(order) || order.length !== movable.length || movable.some((p) => !order.includes(p))) {
    throw bad('That order is not valid.');
  }
  await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    await lock(tx, userId);
    await ensurePages(tx, userId);
    const cur = await rows<{ position: number; label: string; card_id: string | null }>(tx, sql`
      select position, label, card_id from file_pages where user_id = ${userId}::uuid and position between 1 and ${FILE.ownPages - 1}`);
    const at = new Map(cur.map((r) => [Number(r.position), r]));
    // one card sits on one page (unique), so lift them all first
    await tx.execute(sql`update file_pages set card_id = null where user_id = ${userId}::uuid and position between 1 and ${FILE.ownPages - 1}`);
    for (const [i, from] of (order as number[]).entries()) {
      const src = at.get(from);
      await tx.execute(sql`
        update file_pages set label = ${src?.label ?? ''}, card_id = ${src?.card_id ?? null}::uuid
         where user_id = ${userId}::uuid and position = ${i + 1}`);
    }
  });
}

/** When an account closes: every card the member made or that was made for them goes. Returns blob keys. */
export async function dropFile(tx: Db, userId: string): Promise<string[]> {
  const keys = await rows<{ k: string }>(tx, sql`
    delete from file_card_photos where card_id in
      (select id from file_cards where maker_id = ${userId}::uuid or for_id = ${userId}::uuid) returning r2_key as k`);
  await tx.execute(sql`delete from file_cards where maker_id = ${userId}::uuid or for_id = ${userId}::uuid`);
  await tx.execute(sql`delete from file_pages where user_id = ${userId}::uuid`);
  return keys.map((r) => r.k);
}
