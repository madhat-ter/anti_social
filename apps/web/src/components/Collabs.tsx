'use client';
/**
 * RFC §10.21: one short form per kind. Only the basics show; every other setting lives in one
 * "More options" fold (never a fold inside a fold), and all of it can be changed later.
 */
import { useId, useRef, useState, type FormEvent } from 'react';
import {
  COLLAB_DESCRIPTION_MAX, COLLAB_MEETS_MAX, COLLAB_PRICE_NOTE_MAX, COLLAB_REQUIREMENTS_MAX, COLLAB_ROLE_MAX,
  COLLAB_ROLES_MAX, COLLAB_TEAM_MAX, COLLAB_TEAM_MIN, COLLAB_TITLE_MAX, ACTIVITY_SIZE_MAX,
} from '@anti/shared';
import { api, errorMessage, IMAGE_MAX_BYTES, type Collab, type CollabInput } from '@/lib/api';
import { InterestPicker } from './Interests';
import { ErrorNote } from './ui';

// ─── Create / edit form ─────────────────────────────────────────────────────

type Cover = { id: string | null | undefined; preview: string | null; uploading: boolean };

export function CollabForm({ kind, initial, prefill, submitLabel, fromEventId, onSubmit }: {
  kind: 'activity' | 'project';
  initial?: Collab;
  /** "Make it regular": the event's words and tags, ready to become an activity */
  prefill?: { title?: string; description?: string; interests?: string[]; requirements?: string; priceNote?: string | null; paymentUrl?: string | null };
  submitLabel: string;
  /** "Make it regular": invites the people who came to that past event */
  fromEventId?: string;
  onSubmit: (b: CollabInput) => Promise<void>;
}) {
  const id = useId();
  const [title, setTitle] = useState(initial?.title ?? prefill?.title ?? '');
  const [meets, setMeets] = useState(initial?.meets ?? '');
  const [description, setDescription] = useState(initial?.description ?? prefill?.description ?? '');
  const [requirements, setRequirements] = useState(initial?.requirements ?? prefill?.requirements ?? '');
  const [interests, setInterests] = useState<string[]>(initial?.interests ?? prefill?.interests ?? []);
  const [roles, setRoles] = useState<string[]>(initial?.roles ?? []);
  const [role, setRole] = useState('');
  const [teamMax, setTeamMax] = useState(initial ? (initial.teamMax === null ? '' : String(initial.teamMax)) : kind === 'project' ? '5' : '');
  const [joinMode, setJoinMode] = useState<'open' | 'approve'>(initial?.joinMode ?? (kind === 'activity' ? 'open' : 'approve'));
  const [priceNote, setPriceNote] = useState(initial?.priceNote ?? prefill?.priceNote ?? '');
  const [payUrl, setPayUrl] = useState(initial?.paymentUrl ?? prefill?.paymentUrl ?? '');
  const [cover, setCover] = useState<Cover>({ id: undefined, preview: null, uploading: false });
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(!!(initial && (initial.requirements || initial.priceNote || initial.paymentUrl || initial.cover)));

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
    let max: number | null = null;
    if (kind === 'project') {
      max = Number(teamMax);
      if (!Number.isInteger(max) || max < COLLAB_TEAM_MIN || max > COLLAB_TEAM_MAX) {
        setErr(`The team is ${COLLAB_TEAM_MIN} to ${COLLAB_TEAM_MAX} people, you included.`); setMore(true); return;
      }
    } else if (teamMax.trim()) {
      max = Number(teamMax);
      if (!Number.isInteger(max) || max < COLLAB_TEAM_MIN || max > ACTIVITY_SIZE_MAX) {
        setErr(`A size limit is ${COLLAB_TEAM_MIN} to ${ACTIVITY_SIZE_MAX} people, or empty for no limit.`); setMore(true); return;
      }
    }
    if (kind === 'activity' && !meets.trim()) { setErr('Say when you meet, even loosely: "Sundays 7am, by the lake".'); return; }
    if (!interests.length) { setErr('Pick at least one interest, so the right people find it.'); return; }
    const pending = role.trim() && !roles.includes(role.trim()) ? [...roles, role.trim()] : roles;
    setBusy(true);
    try {
      await onSubmit({
        kind, title, meets: meets.trim(), description, requirements, interests,
        roles: kind === 'project' ? pending.slice(0, COLLAB_ROLES_MAX) : [], teamMax: max, joinMode,
        priceNote: priceNote.trim() || null, paymentUrl: payUrl.trim() || null,
        ...(cover.id !== undefined ? { coverId: cover.id } : {}),
        ...(fromEventId ? { fromEventId } : {}),
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
        <span className="win-title">{initial ? `edit_${kind}` : `new_${kind}`}</span>
      </div>
      <div className="win-body stack">
        <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={COLLAB_TITLE_MAX} required
          placeholder={kind === 'activity' ? 'Sunday run club' : 'A zine about the old market'} /></label>
        {kind === 'activity' && (
          <label>When we meet
            <input value={meets} onChange={(e) => setMeets(e.target.value)} maxLength={COLLAB_MEETS_MAX} required
              placeholder="Sundays 7am, by the lake" />
          </label>
        )}
        <label>{kind === 'activity' ? 'What is it?' : 'What is it, and what will you make together?'}
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={COLLAB_DESCRIPTION_MAX} rows={5} />
        </label>
        {kind === 'project' && (
          <fieldset className="stack">
            <legend>Looking for <span className="muted small">(the roles you need, up to {COLLAB_ROLES_MAX})</span></legend>
            {roles.length > 0 && (
              <ul className="chips" aria-label="Roles">
                {roles.map((r) => (
                  <li key={r}><button type="button" className="chip on" aria-label={`Remove ${r}`} onClick={() => setRoles(roles.filter((x) => x !== r))}>{r} ×</button></li>
                ))}
              </ul>
            )}
            {roles.length < COLLAB_ROLES_MAX && (
              <div className="row">
                <input aria-label="A role" value={role} maxLength={COLLAB_ROLE_MAX} placeholder="Illustrator"
                  onChange={(e) => setRole(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRole(); } }} />
                <button type="button" className="btn" onClick={addRole}>Add</button>
              </div>
            )}
          </fieldset>
        )}
        <fieldset className="stack">
          <legend>Interests <span className="muted small">(1 to 5; people who share them see it under For you)</span></legend>
          <InterestPicker value={interests} onChange={setInterests} max={5} />
        </fieldset>

        <details open={more} onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}>
          <summary className="muted">More options</summary>
          <div className="stack" style={{ marginTop: '.6rem' }}>
            {coverUrl && (
              <div className={`pf-coverwrap${cover.uploading ? ' uploading' : ''}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="pf-coverimg" src={coverUrl} alt="" />
                {cover.uploading && <span className="spinner" role="status" aria-label="Uploading" />}
              </div>
            )}
            <div className="row">
              <input ref={fileRef} id={`${id}-cover`} type="file" accept="image/*" className="sr-only" onChange={(e) => pickCover(e.target.files)} />
              <label htmlFor={`${id}-cover`} className="btn attach">{coverUrl ? 'Change cover' : '+ Cover image'}</label>
              {coverUrl && <button type="button" className="link-btn" onClick={() => setCover((c) => { if (c.preview) URL.revokeObjectURL(c.preview); return { id: null, preview: null, uploading: false }; })}>Remove cover</button>}
            </div>
            <div className="row two">
              <label>{kind === 'activity' ? 'Size limit (empty = no limit)' : 'Team size, you included'}
                <input type="number" min={COLLAB_TEAM_MIN} max={kind === 'project' ? COLLAB_TEAM_MAX : ACTIVITY_SIZE_MAX}
                  value={teamMax} onChange={(e) => setTeamMax(e.target.value)} required={kind === 'project'} />
              </label>
              <fieldset className="stack">
                <legend>Joining</legend>
                <label className="check"><input type="radio" name={`${id}-join`} checked={joinMode === 'approve'} onChange={() => setJoinMode('approve')} /> People ask, you accept</label>
                <label className="check"><input type="radio" name={`${id}-join`} checked={joinMode === 'open'} onChange={() => setJoinMode('open')} /> Anyone can join</label>
              </fieldset>
            </div>
            <label>Requirements (optional)
              <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} maxLength={COLLAB_REQUIREMENTS_MAX} rows={2} placeholder="A camera helps. Saturdays mostly." />
            </label>
            <label>Price or donation note<input value={priceNote} onChange={(e) => setPriceNote(e.target.value)} maxLength={COLLAB_PRICE_NOTE_MAX} placeholder="Free; we split printing costs" /></label>
            <label>Payment link<input type="url" value={payUrl} onChange={(e) => setPayUrl(e.target.value)} placeholder="https://" /></label>
            <p className="muted small">anti never handles money. A note and a link, paid to you.</p>
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
