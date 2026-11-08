'use client';
/** Collabs (RFC §10.5): cards for the lists, the status tag, and the create/edit form. */
import Link from 'next/link';
import { useId, useRef, useState, type FormEvent } from 'react';
import {
  COLLAB_DESCRIPTION_MAX, COLLAB_INTERESTS_MAX, COLLAB_PRICE_NOTE_MAX, COLLAB_REQUIREMENTS_MAX, COLLAB_ROLE_MAX,
  COLLAB_ROLES_MAX, COLLAB_TEAM_MAX, COLLAB_TEAM_MIN, COLLAB_TITLE_MAX,
} from '@anti/shared';
import { api, errorMessage, IMAGE_MAX_BYTES, type Collab, type CollabInput, type CollabSummary } from '@/lib/api';
import { InterestPicker, InterestTags } from './Interests';
import { NameMarks } from './Marks';
import { ErrorNote } from './ui';

export const STATUS_LABEL = { recruiting: 'recruiting', closed: 'team set', finished: 'finished' } as const;

export function StatusTag({ c }: { c: Pick<CollabSummary, 'status'> }) {
  return <span className={`tag collab-status ${c.status}`}>{STATUS_LABEL[c.status]}</span>;
}

/** Your relationship to it, if any. */
export function MyTag({ c }: { c: CollabSummary }) {
  if (c.my.role === 'host') return <span className="tag on">hosting</span>;
  if (c.my.role === 'cohost') return <span className="tag on">co-host</span>;
  if (c.my.role) return <span className="tag on">on the team</span>;
  if (c.my.invited) return <span className="tag on">invited</span>;
  if (c.my.request === 'pending') return <span className="tag">asked</span>;
  return null;
}

export function CollabCard({ c }: { c: CollabSummary }) {
  return (
    <li className="collab-card">
      <Link href={`/collabs/${c.id}`} className="collab-link">
        {c.cover
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="collab-cover" src={c.cover.url} alt="" width={c.cover.width} height={c.cover.height} loading="lazy" />
          : <span className="collab-cover blank" aria-hidden>{c.title.slice(0, 1).toUpperCase()}</span>}
        <span className="collab-main">
          <span className="collab-title">{c.title} <StatusTag c={c} /> <MyTag c={c} /></span>
          <span className="muted small">
            {c.teamCount} of {c.teamMax} people{c.host && <> · hosted by @{c.host.handle}<NameMarks admin={c.host.admin} verified={c.host.verified} size=".9em" /></>}
            {c.status === 'recruiting' && <> · {c.joinMode === 'open' ? 'anyone can join' : 'ask to join'}</>}
          </span>
          {c.roles.length > 0 && <span className="small">Looking for: {c.roles.join(', ')}</span>}
          <InterestTags slugs={c.interests} />
        </span>
      </Link>
    </li>
  );
}

// ─── Create / edit form ─────────────────────────────────────────────────────

type Cover = { id: string | null | undefined; preview: string | null; uploading: boolean };

export function CollabForm({ initial, submitLabel, onSubmit }: {
  initial?: Collab; submitLabel: string; onSubmit: (b: CollabInput) => Promise<void>;
}) {
  const id = useId();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [requirements, setRequirements] = useState(initial?.requirements ?? '');
  const [interests, setInterests] = useState<string[]>(initial?.interests ?? []);
  const [roles, setRoles] = useState<string[]>(initial?.roles ?? []);
  const [role, setRole] = useState('');
  const [teamMax, setTeamMax] = useState(String(initial?.teamMax ?? 5));
  const [joinMode, setJoinMode] = useState<'open' | 'approve'>(initial?.joinMode ?? 'approve');
  const [priceNote, setPriceNote] = useState(initial?.priceNote ?? '');
  const [payUrl, setPayUrl] = useState(initial?.paymentUrl ?? '');
  const [cover, setCover] = useState<Cover>({ id: undefined, preview: null, uploading: false });
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function addRole() {
    const r = role.replace(/\s+/g, ' ').trim();
    if (!r) return;
    if (roles.length >= COLLAB_ROLES_MAX) { setErr(`Up to ${COLLAB_ROLES_MAX} roles.`); return; }
    if (!roles.some((x) => x.toLowerCase() === r.toLowerCase())) setRoles([...roles, r]);
    setRole('');
  }

  function pickCover(files: FileList | null) {
    const f = files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { setErr(`"${f.name}" is not an image.`); return; }
    if (f.size > IMAGE_MAX_BYTES) { setErr(`"${f.name}" is larger than 5 MB.`); return; }
    setErr(null);
    const preview = URL.createObjectURL(f);
    setCover((c) => { if (c.preview) URL.revokeObjectURL(c.preview); return { id: undefined, preview, uploading: true }; });
    api.upload(f).then(
      (im) => setCover((c) => (c.preview === preview ? { ...c, id: im.id, uploading: false } : c)),
      (e) => { setErr(errorMessage(e)); setCover((c) => (c.preview === preview ? { id: undefined, preview: null, uploading: false } : c)); },
    );
  }
  const coverUrl = cover.id === null ? null : cover.preview ?? initial?.cover?.url ?? null;

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setErr(null);
    const n = Number(teamMax);
    if (!Number.isInteger(n) || n < COLLAB_TEAM_MIN || n > COLLAB_TEAM_MAX) { setErr(`The team is ${COLLAB_TEAM_MIN} to ${COLLAB_TEAM_MAX} people, you included.`); return; }
    if (!interests.length) { setErr('Pick at least one interest, so the right people find it.'); return; }
    const pending = role.trim() && !roles.includes(role.trim()) ? [...roles, role.trim()] : roles;
    setBusy(true);
    try {
      await onSubmit({
        title, description, requirements, interests, roles: pending.slice(0, COLLAB_ROLES_MAX), teamMax: n, joinMode,
        priceNote: priceNote.trim() || null, paymentUrl: payUrl.trim() || null,
        ...(cover.id !== undefined ? { coverId: cover.id } : {}),
      });
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <form className="win collab-form" onSubmit={submit}>
      <div className="win-bar" aria-hidden="true">
        <span className="win-close" />
        <span className="win-title">{initial ? 'edit_collab' : 'new_collab'}</span>
      </div>
      <div className="win-body stack">
        {coverUrl && (
          <div className={`pf-coverwrap${cover.uploading ? ' uploading' : ''}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pf-coverimg" src={coverUrl} alt="" />
            {cover.uploading && <span className="spinner" role="status" aria-label="Uploading" />}
          </div>
        )}
        <div className="row">
          <input ref={fileRef} id={`${id}-cover`} type="file" accept="image/*" className="sr-only" onChange={(e) => pickCover(e.target.files)} />
          <label htmlFor={`${id}-cover`} className="btn attach">{coverUrl ? 'Change cover' : '+ Cover image (optional)'}</label>
          {coverUrl && <button type="button" className="link-btn" onClick={() => setCover((c) => { if (c.preview) URL.revokeObjectURL(c.preview); return { id: null, preview: null, uploading: false }; })}>Remove cover</button>}
        </div>
        <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={COLLAB_TITLE_MAX} required placeholder="A zine about the old market" /></label>
        <label>What is it, and what will you make or do together?
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={COLLAB_DESCRIPTION_MAX} rows={6} />
        </label>
        <fieldset className="stack">
          <legend>Interests <span className="muted small">(1 to {COLLAB_INTERESTS_MAX}; people who share them see it under For you)</span></legend>
          <InterestPicker value={interests} onChange={setInterests} max={COLLAB_INTERESTS_MAX} />
        </fieldset>
        <fieldset className="stack">
          <legend>Looking for <span className="muted small">(optional, up to {COLLAB_ROLES_MAX} roles)</span></legend>
          {roles.length > 0 && (
            <ul className="chips" aria-label="Roles">
              {roles.map((r) => (
                <li key={r}><button type="button" className="chip on" aria-label={`Remove ${r}`} onClick={() => setRoles(roles.filter((x) => x !== r))}>{r} ×</button></li>
              ))}
            </ul>
          )}
          {roles.length < COLLAB_ROLES_MAX && (
            <div className="row">
              <input aria-label="A role" value={role} maxLength={COLLAB_ROLE_MAX} placeholder="Photographer"
                onChange={(e) => setRole(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRole(); } }} />
              <button type="button" className="btn" onClick={addRole}>Add</button>
            </div>
          )}
        </fieldset>
        <label>Requirements (optional)
          <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} maxLength={COLLAB_REQUIREMENTS_MAX} rows={2} placeholder="A camera helps. Saturdays mostly." />
        </label>
        <div className="row two">
          <label>Team size, you included
            <input type="number" min={COLLAB_TEAM_MIN} max={COLLAB_TEAM_MAX} value={teamMax} onChange={(e) => setTeamMax(e.target.value)} required />
          </label>
          <fieldset className="stack">
            <legend>Joining</legend>
            <label className="check"><input type="radio" name={`${id}-join`} checked={joinMode === 'approve'} onChange={() => setJoinMode('approve')} /> People ask, you accept</label>
            <label className="check"><input type="radio" name={`${id}-join`} checked={joinMode === 'open'} onChange={() => setJoinMode('open')} /> Anyone can join</label>
          </fieldset>
        </div>
        <details open={!!(initial?.priceNote || initial?.paymentUrl)}>
          <summary className="muted">Cost or donations (optional)</summary>
          <div className="stack" style={{ marginTop: '.6rem' }}>
            <p className="muted small">anti never handles money. If it costs something, or you are raising money for a cause, say so and link to where people pay.</p>
            <label>Price or donation note<input value={priceNote} onChange={(e) => setPriceNote(e.target.value)} maxLength={COLLAB_PRICE_NOTE_MAX} placeholder="Free; we split printing costs" /></label>
            <label>Link<input type="url" value={payUrl} onChange={(e) => setPayUrl(e.target.value)} placeholder="https://" /></label>
          </div>
        </details>
        <ErrorNote message={err} />
        <div className="row dlg-actions">
          <button className="btn primary" disabled={busy || cover.uploading}>{busy ? 'Saving…' : cover.uploading ? 'Uploading…' : submitLabel}</button>
        </div>
      </div>
    </form>
  );
}
