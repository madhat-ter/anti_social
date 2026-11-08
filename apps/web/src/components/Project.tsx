'use client';
/**
 * A project: one numbered case study on a portfolio.
 *   ProjectView  the page: a side index 01–12, the title set big, a details line, the summary,
 *                the write-up, then each image full width or beside a text panel
 *   ProjectForm  the editor: fields, tools, up to 10 images with layout, panel text and caption
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  PROJECT_BODY_MAX, PROJECT_CAPTION_MAX, PROJECT_DURATION_MAX, PROJECT_IMAGES_MAX, PROJECT_PANEL_HEADING_MAX,
  PROJECT_PANEL_TEXT_MAX, PROJECT_ROLE_MAX, PROJECT_SUMMARY_MAX, PROJECT_TEAM_MAX, PROJECT_TITLE_MAX, PROJECT_TOOLS_MAX,
} from '@anti/shared';
import {
  api, errorMessage, IMAGE_MAX_BYTES, type Image, type Project, type ProjectImage, type ProjectImageInput, type ProjectInput,
  type ProjectLayout, type ProjectSummary, type PfStyle,
} from '@/lib/api';
import { ImageViewer } from './ImageViewer';
import { nn, styleClass, TagEditor } from './Portfolio';
import { AlertDialog, Win } from './retro';
import { ErrorNote } from './ui';
import { useReadOnly } from './Visitor';

/** "2026 · Industrial designer · Group of two · 3 weeks · Fusion 360, KeyShot" */
export function detailsLine(p: { year: number | null; role: string; team: string; duration: string; tools: string[] }): string {
  return [p.year, p.role, p.team, p.duration, p.tools.join(', ')].filter(Boolean).join(' · ');
}

export function ProjectView({ project: p, siblings, style }: { project: Project; siblings: ProjectSummary[]; style: PfStyle }) {
  const readOnly = useReadOnly();
  const [viewing, setViewing] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const [reported, setReported] = useState(false);
  const [reportErr, setReportErr] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const router = useRouter();
  /** an admin removes someone else's project: it is deleted and the owner is told */
  async function remove() {
    setRemoving(false); setReportErr(null);
    try { await api.opsRemoveProject(p.id); router.push(`/u/${p.handle}`); }
    catch (e) { setReportErr(errorMessage(e)); }
  }
  async function report(reason: string) {
    setAsking(false); setReportErr(null);
    try { await api.flagProject(p.id, reason || undefined); setReported(true); }
    catch (e) { setReportErr(errorMessage(e)); }
  }
  const idx = siblings.findIndex((s) => s.id === p.id);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  const home = `/u/${p.handle}`;
  const images = p.images.map((i): Image => ({ id: i.id, url: i.url, width: i.width, height: i.height }));
  const details = detailsLine(p);

  return (
    <Win title={`${p.handle}.work/${idx >= 0 ? nn(idx) : p.draft ? 'draft' : 'hidden'}`} className={`pj ${styleClass(style)}`} as="article">
      <div className="pj-grid">
        <nav className="pj-index" aria-label="Projects">
          <ol>
            {siblings.map((s, i) => (
              <li key={s.id}>
                <Link href={`${home}/work/${s.id}`} aria-current={s.id === p.id ? 'page' : undefined} title={s.title}>
                  {nn(i)}{s.draft && <span className="sr-only"> (draft)</span>}
                </Link>
              </li>
            ))}
          </ol>
          <Link href={home} className="pj-back ui">← @{p.handle}</Link>
        </nav>
        <div className="pj-main">
          {p.hidden && (p.mine ? (
            <p className="banner pj-hidden" role="status">
              <strong>Hidden after reports.</strong> Only you can see this project. A moderator will restore it or remove it;
              you will be told either way.
            </p>
          ) : (
            <p className="banner pj-hidden" role="status">
              <strong>Hidden after reports.</strong> Members can&apos;t see this project; you can because you are an admin.
              Keep it or remove it from the <Link href="/admin">Admin</Link> page.
            </p>
          ))}
          <header className="pj-head">
            <p className="pj-kicker ui">
              {idx >= 0 ? `Project ${nn(idx)}` : 'Project'} · <Link href={home}>@{p.handle}</Link>
              {p.draft && <span className="tag">draft, only you see this</span>}
            </p>
            <h1>{p.title}</h1>
            {details && <p className="pj-details ui">{details}</p>}
            {p.summary && <p className="pj-summary">{p.summary}</p>}
            {p.mine && (
              <div className="row pj-actions">
                <Link className="btn" href={`${home}/work/${p.id}/edit`}>Edit project</Link>
              </div>
            )}
            {p.canReport && !readOnly && (
              <div className="row pj-actions">
                {reported
                  ? <p className="muted small" role="status">Reported. Thanks, a moderator will take a look.</p>
                  : <button type="button" className="link-btn" onClick={() => setAsking(true)}>Report project</button>}
                {p.canModerate && (
                  <button type="button" className="btn danger" onClick={() => setRemoving(true)}>Remove (admin)</button>
                )}
                <ErrorNote message={reportErr} />
              </div>
            )}
          </header>
          {p.body && <div className="pj-body">{p.body}</div>}
          {p.images.map((im, i) => (
            <Figure key={im.id} im={im} alt={`${p.title}, image ${i + 1}`} onOpen={() => setViewing(i)} />
          ))}
          {(prev || next) && (
            <footer className="pj-foot">
              {prev ? <Link href={`${home}/work/${prev.id}`} className="pj-nav"><span className="ui">← {nn(idx - 1)}</span><span>{prev.title}</span></Link> : <span />}
              {next ? <Link href={`${home}/work/${next.id}`} className="pj-nav next"><span className="ui">{nn(idx + 1)} →</span><span>{next.title}</span></Link> : <span />}
            </footer>
          )}
        </div>
      </div>
      <ImageViewer images={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)}
        alt={(i) => p.images[i]?.caption || `${p.title}, image ${i + 1}`} />
      <AlertDialog
        open={asking}
        title="Report project"
        message="Report this project to the moderators. What is wrong with it? (optional)"
        confirmLabel="Send report"
        input={{ label: 'Reason', placeholder: 'Stolen work, spam, ...', maxLength: 500 }}
        onConfirm={(reason) => void report(reason)}
        onCancel={() => setAsking(false)}
      />
      <AlertDialog
        open={removing}
        title="Remove project"
        message={<>Remove this project as admin? @{p.handle} is told it was removed. <strong>This cannot be undone.</strong></>}
        confirmLabel="Remove"
        danger
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(false)}
      />
    </Win>
  );
}

function Figure({ im, alt, onOpen }: { im: ProjectImage; alt: string; onOpen: () => void }) {
  const img = (
    <button type="button" className="pj-img" onClick={onOpen} aria-label={`Open image: ${im.caption || alt}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={im.url} alt={im.caption || alt} width={im.width} height={im.height} />
    </button>
  );
  if (im.layout === 'full') {
    return <figure className="pj-full">{img}{im.caption && <figcaption className="ui">{im.caption}</figcaption>}</figure>;
  }
  return (
    <section className={`pj-split ${im.layout}`}>
      <div className="pj-panel">
        {im.heading && <h2>{im.heading}</h2>}
        {im.text && <p>{im.text}</p>}
      </div>
      <figure>{img}{im.caption && <figcaption className="ui">{im.caption}</figcaption>}</figure>
    </section>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

type Att = ProjectImageInput & {
  /** a local key for React; the id arrives once the upload finishes */
  key: string; preview: string; width: number; height: number; status: 'uploading' | 'done' | 'error'; error?: string;
};

const LAYOUTS: { v: ProjectLayout; label: string }[] = [
  { v: 'full', label: 'Full width' }, { v: 'left', label: 'Text on the left' }, { v: 'right', label: 'Text on the right' },
];

const fromProject = (p: Project): Att[] => p.images.map((i) => ({
  id: i.id, layout: i.layout, heading: i.heading, text: i.text, caption: i.caption,
  key: i.id, preview: i.url, width: i.width, height: i.height, status: 'done',
}));

export function ProjectForm({ handle, initial }: { handle: string; initial: Project | null }) {
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [year, setYear] = useState(initial?.year ? String(initial.year) : '');
  const [role, setRole] = useState(initial?.role ?? '');
  const [team, setTeam] = useState(initial?.team ?? '');
  const [duration, setDuration] = useState(initial?.duration ?? '');
  const [tools, setTools] = useState<string[]>(initial?.tools ?? []);
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [draft, setDraft] = useState(initial?.draft ?? false);
  const [atts, setAtts] = useState<Att[]>(() => (initial ? fromProject(initial) : []));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const attsRef = useRef<Att[]>([]);
  attsRef.current = atts;
  useEffect(() => () => { attsRef.current.forEach((a) => { if (a.preview.startsWith('blob:')) URL.revokeObjectURL(a.preview); }); }, []);

  const uploading = atts.some((a) => a.status === 'uploading');
  const home = `/u/${handle}`;

  function pick(files: FileList | null) {
    if (!files) return;
    setErr(null);
    const room = PROJECT_IMAGES_MAX - atts.length;
    const chosen = Array.from(files);
    if (chosen.length > room) setErr(`A project holds up to ${PROJECT_IMAGES_MAX} images.`);
    for (const f of chosen.slice(0, Math.max(room, 0))) {
      if (!f.type.startsWith('image/')) { setErr(`"${f.name}" is not an image.`); continue; }
      if (f.size > IMAGE_MAX_BYTES) { setErr(`"${f.name}" is larger than 5 MB.`); continue; }
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setAtts((cur) => [...cur, { key, id: '', preview: URL.createObjectURL(f), width: 0, height: 0, status: 'uploading', layout: 'full', heading: '', text: '', caption: '' }]);
      api.upload(f).then(
        (im) => setAtts((cur) => cur.map((a) => (a.key === key ? { ...a, id: im.id, width: im.width, height: im.height, status: 'done' } : a))),
        (e) => setAtts((cur) => cur.map((a) => (a.key === key ? { ...a, status: 'error', error: errorMessage(e) } : a))),
      );
    }
    if (fileRef.current) fileRef.current.value = '';
  }
  const upd = (key: string, patch: Partial<Att>) => setAtts((cur) => cur.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  const move = (i: number, by: -1 | 1) => setAtts((cur) => {
    const j = i + by;
    if (j < 0 || j >= cur.length) return cur;
    const next = [...cur];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  });
  const remove = (key: string) => setAtts((cur) => {
    const a = cur.find((x) => x.key === key);
    if (a?.preview.startsWith('blob:')) URL.revokeObjectURL(a.preview);
    return cur.filter((x) => x.key !== key);
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || uploading) return;
    setBusy(true); setErr(null);
    const input: ProjectInput = {
      title: title.trim(), year: year.trim() === '' ? null : Number(year), role, team, duration, tools, summary, body, draft,
      images: atts.filter((a) => a.status === 'done').map(({ id: iid, layout, heading, text, caption }) => ({ id: iid, layout, heading, text, caption })),
    };
    try {
      const saved = initial ? await api.updateProject(initial.id, input) : await api.createProject(input);
      router.push(`${home}/work/${saved.id}`);
    } catch (x) { setErr(errorMessage(x)); setBusy(false); }
  }

  async function destroy() {
    if (!initial) return;
    setConfirmDelete(false); setBusy(true); setErr(null);
    try { await api.deleteProject(initial.id); router.push(home); }
    catch (x) { setErr(errorMessage(x)); setBusy(false); }
  }

  return (
    <form onSubmit={submit}>
    <Win title={initial ? `${handle}.work/edit` : `${handle}.work/new`} as="div" className="pj-form" bodyClassName="stack">
      <div className="pj-form-body stack">
      <label>Title
        <input value={title} maxLength={PROJECT_TITLE_MAX} placeholder="Veloce" required onChange={(e) => setTitle(e.target.value)} />
      </label>
      <fieldset className="pj-details-edit">
        <legend className="ui">The details line</legend>
        <label>Year
          <input type="number" inputMode="numeric" value={year} min={1950} max={2100} placeholder="2026" onChange={(e) => setYear(e.target.value)} />
        </label>
        <label>Role
          <input value={role} maxLength={PROJECT_ROLE_MAX} placeholder="Industrial designer" onChange={(e) => setRole(e.target.value)} />
        </label>
        <label>Team
          <input value={team} maxLength={PROJECT_TEAM_MAX} placeholder="Solo, or group of two" onChange={(e) => setTeam(e.target.value)} />
        </label>
        <label>Duration
          <input value={duration} maxLength={PROJECT_DURATION_MAX} placeholder="3 weeks" onChange={(e) => setDuration(e.target.value)} />
        </label>
        <div className="wide stack" style={{ gap: '.3rem' }}>
          <span className="pj-label">Tools</span>
          <TagEditor value={tools} onChange={setTools} max={PROJECT_TOOLS_MAX} placeholder="Fusion 360, KeyShot…" label="Add a tool" />
        </div>
      </fieldset>
      <label>Summary <span className="counter">{summary.length}/{PROJECT_SUMMARY_MAX}</span>
        <textarea value={summary} maxLength={PROJECT_SUMMARY_MAX} rows={2} placeholder="One or two sentences: what it is and who it is for." onChange={(e) => setSummary(e.target.value)} />
      </label>
      <label>Write-up <span className="counter">{body.length}/{PROJECT_BODY_MAX}</span>
        <textarea value={body} maxLength={PROJECT_BODY_MAX} rows={8} placeholder="The longer story: the brief, what you tried, what you learnt." onChange={(e) => setBody(e.target.value)} />
      </label>

      <section className="stack" aria-labelledby={`${id}-imgs`}>
        <div className="row between">
          <h2 id={`${id}-imgs`} className="pf-sec-h">Images</h2>
          <span className="counter">{atts.length}/{PROJECT_IMAGES_MAX}</span>
        </div>
        <p className="muted small">The first image is the cover. Each one is full width, or sits beside a short text panel. Images are resized and stripped of metadata.</p>
        {atts.length > 0 && (
          <ol className="pj-atts">
            {atts.map((a, i) => (
              <li key={a.key} className={`pj-att ${a.status}`}>
                <div className="pj-att-pic">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.preview} alt={`Image ${i + 1}`} />
                  {a.status === 'uploading' && <span className="spinner" role="status" aria-label="Uploading" />}
                  {a.status === 'error' && <span className="thumb-err" title={a.error}>Failed</span>}
                  <span className="pf-num">{nn(i)}{i === 0 && <span className="muted"> cover</span>}</span>
                </div>
                <div className="pj-att-fields">
                  <fieldset className="pj-layouts">
                    <legend className="sr-only">Layout of image {i + 1}</legend>
                    {LAYOUTS.map((l) => (
                      <label key={l.v} className={`kind-opt${a.layout === l.v ? ' on' : ''}`}>
                        <input type="radio" name={`${id}-layout-${a.key}`} className="sr-only" checked={a.layout === l.v} onChange={() => upd(a.key, { layout: l.v })} />
                        <LayoutIcon v={l.v} />{l.label}
                      </label>
                    ))}
                  </fieldset>
                  {a.layout !== 'full' && (
                    <>
                      <label>Panel heading
                        <input value={a.heading} maxLength={PROJECT_PANEL_HEADING_MAX} placeholder="Concept" onChange={(e) => upd(a.key, { heading: e.target.value })} />
                      </label>
                      <label>Panel text
                        <textarea value={a.text} maxLength={PROJECT_PANEL_TEXT_MAX} rows={3} placeholder="A short paragraph beside the image." onChange={(e) => upd(a.key, { text: e.target.value })} />
                      </label>
                    </>
                  )}
                  <label>Caption (optional)
                    <input value={a.caption} maxLength={PROJECT_CAPTION_MAX} placeholder="Early foam models" onChange={(e) => upd(a.key, { caption: e.target.value })} />
                  </label>
                  <div className="row">
                    <button type="button" className="icon-btn" aria-label={`Move image ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button type="button" className="icon-btn" aria-label={`Move image ${i + 1} down`} disabled={i === atts.length - 1} onClick={() => move(i, 1)}>↓</button>
                    <button type="button" className="link-btn danger-text" onClick={() => remove(a.key)}>Remove</button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="row">
          <input ref={fileRef} id={`${id}-file`} type="file" accept="image/*" multiple className="sr-only" disabled={atts.length >= PROJECT_IMAGES_MAX} onChange={(e) => pick(e.target.files)} />
          <label htmlFor={`${id}-file`} className={`btn attach${atts.length >= PROJECT_IMAGES_MAX ? ' disabled' : ''}`} aria-disabled={atts.length >= PROJECT_IMAGES_MAX}>+ Image</label>
        </div>
      </section>

      <label className="check">
        <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
        Draft: only I can see this project
      </label>
      <ErrorNote message={err} />
      </div>
      <div className="pf-editbar">
        <p className="ui pf-reminder">{draft ? 'A draft is yours alone until you untick it.' : 'Every member can see this once it is saved.'}</p>
        <div className="row pf-editbtns">
          {initial && <button type="button" className="btn danger" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete</button>}
          <Link className="btn" href={initial ? `${home}/work/${initial.id}` : home}>Cancel</Link>
          <button type="submit" className="btn primary" disabled={busy || uploading || !title.trim()}>
            {busy ? 'Saving…' : uploading ? 'Uploading…' : initial ? 'Save' : 'Add project'}
          </button>
        </div>
      </div>
      <AlertDialog open={confirmDelete} title="Delete project" danger confirmLabel="Delete"
        message={<>Delete <strong>{initial?.title}</strong> and its images? This cannot be undone.</>}
        onConfirm={() => void destroy()} onCancel={() => setConfirmDelete(false)} />
    </Win>
    </form>
  );
}

function LayoutIcon({ v }: { v: ProjectLayout }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 2 };
  return (
    <svg viewBox="0 0 24 24" width={26} height={26} aria-hidden="true" className="kind-icon">
      {v === 'full' && <rect x="3" y="6" width="18" height="12" {...s} fill="currentColor" />}
      {v === 'left' && (<><path d="M4 8h5M4 11h5M4 14h3" {...s} /><rect x="11" y="6" width="10" height="12" {...s} fill="currentColor" /></>)}
      {v === 'right' && (<><rect x="3" y="6" width="10" height="12" {...s} fill="currentColor" /><path d="M15 8h5M15 11h5M15 14h3" {...s} /></>)}
    </svg>
  );
}
