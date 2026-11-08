/**
 * Projects: the numbered case studies on a portfolio (01, 02, …). Each has a title, a details
 * line (year, role, tools, team, duration), a summary, a write-up and up to 10 images, each
 * full-width or beside a text panel. Drafts are only shown to their owner.
 * Like the portfolio, this is about yourself: never a lurker contribution.
 */
import { sql, type SQL } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';
import {
  PROJECT_BODY_MAX, PROJECT_CAPTION_MAX, PROJECT_DURATION_MAX, PROJECT_IMAGES_MAX, PROJECT_LAYOUTS,
  PROJECT_PANEL_HEADING_MAX, PROJECT_PANEL_TEXT_MAX, PROJECT_ROLE_MAX, PROJECT_SUMMARY_MAX, PROJECT_TEAM_MAX,
  PROJECT_TITLE_MAX, PROJECT_TOOLS_MAX, PF_TAG_MAX, PF_YEAR_AHEAD, PF_YEAR_MIN, type ProjectLayout,
} from '@anti/shared';
import { ApiError } from './errors';
import { DEFAULT_STYLE, type PfStyle } from './portfolio';
import { mediaUrl, UUID_RE } from './posts';
import type { Storage } from './storage';

export type ProjectImage = {
  id: string; url: string; width: number; height: number;
  layout: ProjectLayout; heading: string; text: string; caption: string;
};
export type ProjectFields = {
  title: string; summary: string; body: string; year: number | null; role: string;
  tools: string[]; team: string; duration: string; draft: boolean;
};
/** What the contents list shows. `hidden` (after reports) is only ever true for the owner. */
export type ProjectSummary = {
  id: string; title: string; year: number | null; role: string; draft: boolean; hidden: boolean;
  cover: { url: string; width: number; height: number } | null;
};
export type Project = ProjectFields & {
  id: string; handle: string; images: ProjectImage[]; mine: boolean; hidden: boolean; canReport: boolean;
  createdAt: string; updatedAt: string;
};
/** One image as sent by the editor: an existing image of this project, or a pending upload. */
export type ImageInput = { id: string; layout?: ProjectLayout; heading?: string; text?: string; caption?: string };

const iso = (col: SQL) => sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const j = <T,>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
};

type Row = {
  id: string; user_id: string; handle: string; title: string; summary: string; body: string; year: number | null;
  role: string; tools: unknown; team: string; duration: string; draft: boolean; hidden: boolean;
  created_iso: string; updated_iso: string; images: unknown;
};
type ImgRow = { id: string; key: string; width: number; height: number; layout: ProjectLayout; heading: string; text: string; caption: string };

const select = sql`
  select p.id, p.user_id, u.handle, p.title, p.summary, p.body, p.year, p.role, p.tools, p.team, p.duration, p.draft,
    (p.hidden_at is not null) as hidden,
    ${iso(sql`p.created_at`)} as created_iso, ${iso(sql`p.updated_at`)} as updated_iso,
    coalesce((select json_agg(json_build_object('id', i.id, 'key', i.r2_key, 'width', i.width, 'height', i.height,
        'layout', i.layout, 'heading', i.heading, 'text', i.text, 'caption', i.caption) order by i.position)
      from project_images i where i.project_id = p.id), '[]'::json) as images
  from projects p
  join users u on u.id = p.user_id`;

function toProject(r: Row, viewerId: string): Project {
  const imgs = j<ImgRow[]>(r.images, []);
  const mine = r.user_id === viewerId;
  return {
    id: r.id, handle: r.handle, title: r.title, summary: r.summary, body: r.body, year: r.year, role: r.role,
    tools: j<string[]>(r.tools, []), team: r.team, duration: r.duration, draft: r.draft, hidden: !!r.hidden,
    images: imgs.map((i) => ({
      id: i.id, url: mediaUrl(i.key), width: i.width, height: i.height,
      layout: i.layout, heading: i.heading, text: i.text, caption: i.caption,
    })),
    mine, canReport: !mine && !r.draft, createdAt: r.created_iso, updatedAt: r.updated_iso,
  };
}

const toSummary = (p: Project): ProjectSummary => ({
  id: p.id, title: p.title, year: p.year, role: p.role, draft: p.draft, hidden: p.hidden,
  cover: p.images[0] ? { url: p.images[0].url, width: p.images[0].width, height: p.images[0].height } : null,
});

/** Visible to this viewer: everything of your own; others' projects only when neither draft nor hidden. */
const visibleTo = (viewerId: string, ownerId: string) =>
  (viewerId === ownerId ? sql`` : sql`and p.draft = false and p.hidden_at is null`);

/**
 * The member must be visible (seated or archived). Drafts are returned only to their owner.
 * Comes with the portfolio's look, so a project page is drawn the same way as the portfolio.
 */
export async function listProjects(db: Db, viewerId: string, handle: string): Promise<{ items: ProjectSummary[]; style: PfStyle } | null> {
  const [m] = await rows<{ id: string; font: PfStyle['font'] | null; bg: PfStyle['bg'] | null; accent: PfStyle['accent'] | null }>(db, sql`
    select u.id, pf.font, pf.bg, pf.accent from users u left join portfolios pf on pf.user_id = u.id
    where lower(u.handle) = lower(${handle}) and u.state in ('active', 'flagged_lurker', 'archived')`);
  if (!m) return null;
  const found = await rows<Row>(db, sql`${select}
    where p.user_id = ${m.id}::uuid ${visibleTo(viewerId, m.id)}
    order by p.position, p.created_at`);
  return {
    items: found.map((r) => toSummary(toProject(r, viewerId))),
    style: { font: m.font ?? DEFAULT_STYLE.font, bg: m.bg ?? DEFAULT_STYLE.bg, accent: m.accent ?? DEFAULT_STYLE.accent },
  };
}

export async function getProject(db: Db, viewerId: string, handle: string, id: string): Promise<Project | null> {
  if (!UUID_RE.test(id)) return null;
  const [r] = await rows<Row>(db, sql`${select}
    where p.id = ${id}::uuid and lower(u.handle) = lower(${handle}) and u.state in ('active', 'flagged_lurker', 'archived')`);
  if (!r) return null;
  const p = toProject(r, viewerId);
  return (p.draft || p.hidden) && !p.mine ? null : p;
}

async function getOwn(db: Db, userId: string, id: string): Promise<Project> {
  if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found');
  const [r] = await rows<Row>(db, sql`${select} where p.id = ${id}::uuid and p.user_id = ${userId}::uuid`);
  if (!r) throw new ApiError(404, 'not_found');
  return toProject(r, userId);
}

// ─── Validation ─────────────────────────────────────────────────────────────

const bad = (detail: string) => new ApiError(400, 'project_invalid', detail);

function str(v: unknown, what: string, max: number, { multiline = false } = {}): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw bad(`${what} must be text.`);
  const s = (multiline ? v.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : v.replace(/\s+/g, ' ')).trim();
  if (s.length > max) throw bad(`${what} can be at most ${max} characters.`);
  return s;
}

export const EMPTY_PROJECT: ProjectFields = {
  title: '', summary: '', body: '', year: null, role: '', tools: [], team: '', duration: '', draft: false,
};

/** Merge a partial body into the current fields and validate the whole thing. */
export function mergeProject(current: ProjectFields, body: Record<string, unknown>): ProjectFields {
  const has = (k: string) => body[k] !== undefined;
  const title = has('title') ? str(body.title, 'Title', PROJECT_TITLE_MAX) : current.title;
  if (!title) throw bad('A project needs a title.');
  let year = current.year;
  if (has('year')) {
    const raw = body.year;
    if (raw === null || raw === '') year = null;
    else {
      const n = typeof raw === 'string' ? Number(raw) : raw;
      const latest = new Date().getUTCFullYear() + PF_YEAR_AHEAD;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < PF_YEAR_MIN || n > latest) throw bad(`Year must be between ${PF_YEAR_MIN} and ${latest}.`);
      year = n;
    }
  }
  let tools = current.tools;
  if (has('tools')) {
    if (!Array.isArray(body.tools)) throw bad('Tools must be a list.');
    const seen = new Set<string>();
    tools = [];
    for (const raw of body.tools) {
      const s = str(raw, 'Tool', PF_TAG_MAX);
      if (!s || seen.has(s.toLowerCase())) continue;
      seen.add(s.toLowerCase());
      tools.push(s);
    }
    if (tools.length > PROJECT_TOOLS_MAX) throw bad(`Up to ${PROJECT_TOOLS_MAX} tools.`);
  }
  const draft = has('draft') ? body.draft : current.draft;
  if (typeof draft !== 'boolean') throw bad('Draft must be yes or no.');
  return {
    title, year, tools, draft,
    summary: has('summary') ? str(body.summary, 'Summary', PROJECT_SUMMARY_MAX) : current.summary,
    body: has('body') ? str(body.body, 'Write-up', PROJECT_BODY_MAX, { multiline: true }) : current.body,
    role: has('role') ? str(body.role, 'Role', PROJECT_ROLE_MAX) : current.role,
    team: has('team') ? str(body.team, 'Team', PROJECT_TEAM_MAX) : current.team,
    duration: has('duration') ? str(body.duration, 'Duration', PROJECT_DURATION_MAX) : current.duration,
  };
}

function cleanImages(v: unknown): Required<ImageInput>[] {
  if (!Array.isArray(v)) throw bad('Images must be a list.');
  if (v.length > PROJECT_IMAGES_MAX) throw bad(`Up to ${PROJECT_IMAGES_MAX} images per project.`);
  const out: Required<ImageInput>[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') throw bad('Images must be objects.');
    const i = raw as Record<string, unknown>;
    if (typeof i.id !== 'string' || !UUID_RE.test(i.id) || seen.has(i.id)) throw bad('One of the images is not valid.');
    seen.add(i.id);
    const layout = (i.layout ?? 'full') as ProjectLayout;
    if (!PROJECT_LAYOUTS.includes(layout)) throw bad('Image layout must be full, left or right.');
    out.push({
      id: i.id, layout,
      heading: str(i.heading, 'Panel heading', PROJECT_PANEL_HEADING_MAX),
      text: str(i.text, 'Panel text', PROJECT_PANEL_TEXT_MAX, { multiline: true }),
      caption: str(i.caption, 'Caption', PROJECT_CAPTION_MAX),
    });
  }
  return out;
}

// ─── Writes ─────────────────────────────────────────────────────────────────

const rowsOf = <T>(res: unknown): T[] => (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];

/**
 * Replace a project's images with `inputs`, in that order. Each must be an image already on this
 * project or one of the caller's pending uploads (moved in, same id). Images no longer listed are
 * deleted; their blob keys are returned for removal after the transaction commits.
 */
async function syncImages(tx: Db, userId: string, projectId: string, inputs: Required<ImageInput>[]): Promise<string[]> {
  const keep = inputs.map((i) => i.id);
  const gone = rowsOf<{ r2_key: string }>(await tx.execute(sql`
    delete from project_images where project_id = ${projectId}::uuid
      ${keep.length ? sql`and id not in (${sql.join(keep.map((k) => sql`${k}::uuid`), sql`, `)})` : sql``}
    returning r2_key`));
  for (const [position, i] of inputs.entries()) {
    const updated = rowsOf<{ id: string }>(await tx.execute(sql`
      update project_images set position = ${position}, layout = ${i.layout}, heading = ${i.heading}, text = ${i.text}, caption = ${i.caption}
      where id = ${i.id}::uuid and project_id = ${projectId}::uuid returning id`));
    if (updated.length) continue;
    const moved = rowsOf<{ id: string }>(await tx.execute(sql`
      with up as (
        delete from post_images where id = ${i.id}::uuid and uploader_id = ${userId}::uuid and post_id is null
        returning id, r2_key, width, height)
      insert into project_images (id, project_id, r2_key, width, height, position, layout, heading, text, caption)
      select id, ${projectId}::uuid, r2_key, width, height, ${position}, ${i.layout}, ${i.heading}, ${i.text}, ${i.caption} from up
      returning id`));
    if (moved.length !== 1) throw bad('One of the images is not available.');
  }
  return gone.map((g) => g.r2_key);
}

async function removeBlobs(storage: Storage, keys: string[]) {
  await Promise.all(keys.map((k) => storage.delete(k).catch((e) => console.error('storage delete failed', k, e))));
}

export async function createProject(db: Db, storage: Storage, userId: string, body: Record<string, unknown>, max: number): Promise<Project> {
  const f = mergeProject(EMPTY_PROJECT, body);
  const images = body.images === undefined ? [] : cleanImages(body.images);
  const id = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}::text, 1))`);
    const [n] = rowsOf<{ n: number; next: number }>(await tx.execute(sql`
      select count(*)::int as n, coalesce(max(position), -1) + 1 as next from projects where user_id = ${userId}::uuid`));
    if ((n?.n ?? 0) >= max) throw new ApiError(409, 'project_limit', `A portfolio holds up to ${max} projects.`);
    const [created] = rowsOf<{ id: string }>(await tx.execute(sql`
      insert into projects (user_id, title, summary, body, year, role, tools, team, duration, draft, position)
      values (${userId}::uuid, ${f.title}, ${f.summary}, ${f.body}, ${f.year}, ${f.role}, ${JSON.stringify(f.tools)}::jsonb,
        ${f.team}, ${f.duration}, ${f.draft}, ${n?.next ?? 0}) returning id`));
    await syncImages(tx as unknown as Db, userId, created!.id, images);
    return created!.id;
  });
  return getOwn(db, userId, id);
}

export async function updateProject(db: Db, storage: Storage, userId: string, id: string, body: Record<string, unknown>): Promise<Project> {
  const current = await getOwn(db, userId, id);
  const f = mergeProject(current, body);
  const images = body.images === undefined ? null : cleanImages(body.images);
  const gone = await db.transaction(async (tx) => {
    await tx.execute(sql`
      update projects set title = ${f.title}, summary = ${f.summary}, body = ${f.body}, year = ${f.year}, role = ${f.role},
        tools = ${JSON.stringify(f.tools)}::jsonb, team = ${f.team}, duration = ${f.duration}, draft = ${f.draft}, updated_at = now()
      where id = ${id}::uuid and user_id = ${userId}::uuid`);
    return images ? syncImages(tx as unknown as Db, userId, id, images) : [];
  });
  await removeBlobs(storage, gone);
  return getOwn(db, userId, id);
}

export async function deleteProject(db: Db, storage: Storage, userId: string, id: string): Promise<void> {
  await getOwn(db, userId, id);
  const gone = await db.transaction(async (tx) => {
    const keys = rowsOf<{ r2_key: string }>(await tx.execute(sql`
      delete from project_images where project_id = ${id}::uuid returning r2_key`));
    await tx.execute(sql`delete from projects where id = ${id}::uuid and user_id = ${userId}::uuid`);
    return keys.map((k) => k.r2_key);
  });
  await removeBlobs(storage, gone);
}

/** Put the owner's projects in this order. Every id must be theirs; ids left out keep their place after the listed ones. */
export async function reorderProjects(db: Db, userId: string, ids: string[]): Promise<void> {
  if (ids.some((i) => !UUID_RE.test(i)) || new Set(ids).size !== ids.length) throw bad('That order is not valid.');
  await db.transaction(async (tx) => {
    const mine = rowsOf<{ id: string }>(await tx.execute(sql`
      select id from projects where user_id = ${userId}::uuid order by position, created_at`)).map((r) => r.id);
    if (ids.some((i) => !mine.includes(i))) throw new ApiError(404, 'not_found');
    const order = [...ids, ...mine.filter((i) => !ids.includes(i))];
    for (const [position, pid] of order.entries()) {
      await tx.execute(sql`update projects set position = ${position} where id = ${pid}::uuid`);
    }
  });
}

/** Delete every project of a member (used when their account goes). Returns blob keys to remove. */
export async function projectBlobKeys(db: Db, userId: string): Promise<string[]> {
  const found = await rows<{ r2_key: string }>(db, sql`
    select i.r2_key from project_images i join projects p on p.id = i.project_id where p.user_id = ${userId}::uuid`);
  return found.map((r) => r.r2_key);
}
