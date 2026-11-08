'use client';
/**
 * The profile as a portfolio: one large window laid out like a Behance page.
 *   hero      avatar, name, headline, where, "open to work"
 *   CV card   two columns: about, skills, tools | experience, education
 *   links     https addresses, opened in a new tab with nothing passed along
 * A portfolio with nothing in it looks like the plain profile. Its owner edits it where it
 * sits: "Edit portfolio" swaps every section for its inputs; Save sends one PATCH.
 */
import Link from 'next/link';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  ABOUT_MAX_WORDS, ABOUT_MIN_WORDS, PF_ABOUT_MAX, countWords, PF_ACCENTS, PF_BACKGROUNDS, PF_EDUCATION_MAX, PF_ENTRY_LINE_MAX, PF_ENTRY_PLACE_MAX, PF_ENTRY_TITLE_MAX,
  PF_EXPERIENCE_MAX, PF_FONTS, PF_HEADLINE_MAX, PF_LINKS_MAX, PF_LINK_LABEL_MAX, PF_LINK_URL_MAX, PF_LOCATION_MAX, PF_TAGS_MAX,
  PF_TAG_MAX, PROJECTS_MAX, PROJECT_IMAGES_MAX,
} from '@anti/shared';
import {
  api, errorMessage, IMAGE_MAX_BYTES, type MemberSummary, type PfAccent, type PfEntry, type PfLink, type PfStyle, type Portfolio,
  type PortfolioFields, type ProjectSummary,
} from '@/lib/api';
import { Avatar } from './Avatar';
import { BirthdayTag } from './Birthday';
import { InterestTags } from './Interests';
import { Win } from './retro';
import { ErrorNote } from './ui';

export const nn = (i: number) => String(i + 1).padStart(2, '0');
/** Classes that give a window the portfolio's look (see "the look" in globals.css). */
export const styleClass = (s: PfStyle) => `look-${s.font} bg-${s.bg} accent-${s.accent}`;

const FONT_LABEL: Record<PfStyle['font'], string> = { archivo: 'Archivo', mono: 'Space Mono', hand: 'Shantell Sans' };
const BG_LABEL: Record<PfStyle['bg'], string> = { paper: 'White', ink: 'Black' };
export const ACCENT_HEX: Record<PfAccent, string> = {
  red: '#e8412c', blue: '#2457e6', green: '#19a35a', yellow: '#f5c400', violet: '#7a4ae0', orange: '#f07a1a',
};

const copyOf = (p: Portfolio): PortfolioFields => ({
  headline: p.headline, location: p.location, openToWork: p.openToWork, about: p.about,
  skills: [...p.skills], tools: [...p.tools],
  experience: p.experience.map((e) => ({ ...e })), education: p.education.map((e) => ({ ...e })),
  links: p.links.map((l) => ({ ...l })),
  font: p.font, bg: p.bg, accent: p.accent,
});

/** The cover while editing: unchanged, removed, or a fresh upload (with a local preview). */
type CoverDraft = { id: string | null | undefined; preview: string | null; uploading: boolean };

export function PortfolioWindow({ member, pf, projects, onSaved, onReorder }: {
  member: MemberSummary; pf: Portfolio; projects: ProjectSummary[];
  onSaved: (p: Portfolio) => void;
  /** owner only: the contents list in its new order */
  onReorder: (ids: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState<PortfolioFields>(() => copyOf(pf));
  const [cover, setCover] = useState<CoverDraft>({ id: undefined, preview: null, uploading: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const v: PortfolioFields = editing ? d : pf;
  const set = <K extends keyof PortfolioFields>(k: K, val: PortfolioFields[K]) => setD((cur) => ({ ...cur, [k]: val }));

  const dropPreview = () => setCover((c) => { if (c.preview) URL.revokeObjectURL(c.preview); return { id: undefined, preview: null, uploading: false }; });
  const start = () => { setD(copyOf(pf)); dropPreview(); setErr(null); setEditing(true); };
  const cancel = () => { setEditing(false); dropPreview(); setErr(null); };
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      onSaved(await api.updatePortfolio(cover.id === undefined ? d : { ...d, coverId: cover.id }));
      dropPreview(); setEditing(false);
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };
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

  // what the cover strip shows right now
  const coverUrl = editing ? (cover.id === null ? null : cover.preview ?? pf.cover?.url ?? null) : pf.cover?.url ?? null;
  const hasCv = editing || !!v.about || v.skills.length > 0 || v.tools.length > 0 || v.experience.length > 0 || v.education.length > 0;
  const hasLinks = editing || v.links.length > 0;

  return (
    <Win title={`${member.handle}.portfolio`} className={`pf ${styleClass(v)}${editing ? ' editing' : ''}`} as="article">
      {coverUrl && (
        <div className={`pf-coverwrap${cover.uploading ? ' uploading' : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="pf-coverimg" src={coverUrl} alt="" width={pf.cover?.width} height={pf.cover?.height} />
          {cover.uploading && <span className="spinner" role="status" aria-label="Uploading" />}
        </div>
      )}
      {editing && (
        <div className="pf-coveredit">
          <input ref={fileRef} id={`${id}-cover`} type="file" accept="image/*" className="sr-only" onChange={(e) => pickCover(e.target.files)} />
          <label htmlFor={`${id}-cover`} className="btn attach">{coverUrl ? 'Change cover' : '+ Cover image'}</label>
          {coverUrl && <button type="button" className="link-btn" onClick={() => setCover((c) => { if (c.preview) URL.revokeObjectURL(c.preview); return { id: null, preview: null, uploading: false }; })}>Remove cover</button>}
          <span className="muted small">A wide strip across the top, about 21:9. Resized, metadata stripped.</span>
        </div>
      )}
      <header className="pf-hero">
        <Avatar seed={member.handle} gender={member.gender} size={112} label={`${member.displayName}'s avatar`} />
        <div className="pf-hero-main">
          <h1>
            {member.displayName}
            {member.role === 'ops' && <span className="tag" title="Runs the room: moderates, invites, keeps it civil">admin</span>}
            <BirthdayTag b={member.birthday} />
            {member.state === 'archived' && <span className="tag" title="This member's seat was released">archived</span>}
          </h1>
          <p className="mono muted">@{member.handle}</p>
          {editing ? (
            <div className="pf-hero-edit">
              <label>Headline
                <input value={d.headline} maxLength={PF_HEADLINE_MAX} placeholder="Industrial designer" onChange={(e) => set('headline', e.target.value)} />
              </label>
              <div className="row two">
                <label>Where
                  <input value={d.location} maxLength={PF_LOCATION_MAX} placeholder="Kathmandu" onChange={(e) => set('location', e.target.value)} />
                </label>
                <label className="check pf-otw">
                  <input type="checkbox" checked={d.openToWork} onChange={(e) => set('openToWork', e.target.checked)} />
                  Open to work
                </label>
              </div>
            </div>
          ) : (
            v.headline && <p className="pf-headline">{v.headline}</p>
          )}
          {member.bio && !editing && <p className="body pf-bio">{member.bio}</p>}
          <p className="pf-meta">
            {!editing && v.openToWork && <span className="tag open">Open to work</span>}
            {!editing && v.location && <span>{v.location}</span>}
            {member.invitedBy && <span>Invited by <Link href={`/u/${member.invitedBy.handle}`}>@{member.invitedBy.handle}</Link></span>}
            {member.interests.length > 0 && <InterestTags slugs={member.interests} />}
            {member.activatedAt && <span>Member since {new Date(member.activatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>}
            <span>{member.postCount} {member.postCount === 1 ? 'post' : 'posts'}</span>
          </p>
          {pf.mine && !editing && (
            <div className="row pf-actions">
              <button type="button" className="btn primary" onClick={start}>{pf.empty ? 'Start your portfolio' : 'Edit portfolio'}</button>
              <Link className="btn" href="/settings">Name and bio</Link>
            </div>
          )}
        </div>
      </header>

      {editing && (
        <div className="pf-look">
          <fieldset>
            <legend>Typeface</legend>
            <div className="pf-chips">
              {PF_FONTS.map((f) => (
                <label key={f} className={`pf-chip look-${f}${d.font === f ? ' on' : ''}`}>
                  <input type="radio" name={`${id}-font`} className="sr-only" checked={d.font === f} onChange={() => set('font', f)} />
                  <span className="pf-chip-sample">Aa</span>{FONT_LABEL[f]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Background</legend>
            <div className="pf-chips">
              {PF_BACKGROUNDS.map((b) => (
                <label key={b} className={`pf-chip${d.bg === b ? ' on' : ''}`}>
                  <input type="radio" name={`${id}-bg`} className="sr-only" checked={d.bg === b} onChange={() => set('bg', b)} />
                  <span className="pf-swatch" style={{ background: b === 'ink' ? '#000' : '#fff' }} />{BG_LABEL[b]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Accent</legend>
            <div className="pf-chips">
              {PF_ACCENTS.map((a) => (
                <label key={a} className={`pf-chip${d.accent === a ? ' on' : ''}`} title={a}>
                  <input type="radio" name={`${id}-accent`} className="sr-only" checked={d.accent === a} onChange={() => set('accent', a)} />
                  <span className="pf-swatch" style={{ background: ACCENT_HEX[a] }} /><span className="sr-only">{a}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {pf.mine && pf.empty && !editing && (
        <p className="empty pf-start">
          Your profile can be a portfolio: what you do, where you have worked and studied, your skills and tools,
          and links to your work. Every member can see it. Nothing is required.
        </p>
      )}

      {hasCv && (
        <div className="pf-cv">
          <div className="pf-col">
            {(editing || v.about) && (
              <section className="pf-sec" aria-labelledby={`${id}-about`}>
                <h2 id={`${id}-about`}>About</h2>
                {editing ? (
                  <label><span className="sr-only">About</span>
                    <textarea value={d.about} maxLength={PF_ABOUT_MAX} rows={8} placeholder="About you and your work." onChange={(e) => set('about', e.target.value)} />
                    {/* About is "About you" from setup: 50–300 words, never empty (RFC §10.3) */}
                    <span className={`counter${countWords(d.about) > ABOUT_MAX_WORDS || countWords(d.about) < ABOUT_MIN_WORDS ? ' over' : ''}`}>
                      {countWords(d.about)} / {ABOUT_MIN_WORDS}–{ABOUT_MAX_WORDS} words
                    </span>
                  </label>
                ) : <p className="pf-about">{v.about}</p>}
              </section>
            )}
            {(editing || v.skills.length > 0) && (
              <section className="pf-sec" aria-labelledby={`${id}-skills`}>
                <h2 id={`${id}-skills`}>Skills</h2>
                {editing ? <TagEditor value={d.skills} onChange={(t) => set('skills', t)} placeholder="Sketching, rendering, type…" />
                  : <Tags items={v.skills} />}
              </section>
            )}
            {(editing || v.tools.length > 0) && (
              <section className="pf-sec" aria-labelledby={`${id}-tools`}>
                <h2 id={`${id}-tools`}>Tools</h2>
                {editing ? <TagEditor value={d.tools} onChange={(t) => set('tools', t)} placeholder="Fusion 360, Procreate, Figma…" />
                  : <Tags items={v.tools} />}
              </section>
            )}
          </div>
          <div className="pf-col">
            {(editing || v.experience.length > 0) && (
              <section className="pf-sec" aria-labelledby={`${id}-exp`}>
                <h2 id={`${id}-exp`}>Experience</h2>
                {editing ? <EntryEditor value={d.experience} max={PF_EXPERIENCE_MAX} kind="experience" onChange={(x) => set('experience', x)} />
                  : <Entries items={v.experience} />}
              </section>
            )}
            {(editing || v.education.length > 0) && (
              <section className="pf-sec" aria-labelledby={`${id}-edu`}>
                <h2 id={`${id}-edu`}>Education</h2>
                {editing ? <EntryEditor value={d.education} max={PF_EDUCATION_MAX} kind="education" onChange={(x) => set('education', x)} />
                  : <Entries items={v.education} />}
              </section>
            )}
          </div>
        </div>
      )}

      {(projects.length > 0 || pf.mine) && !editing && (
        <Contents handle={member.handle} items={projects} mine={pf.mine} onReorder={onReorder} />
      )}

      {hasLinks && (
        <section className="pf-links" aria-label="Links">
          {editing ? <LinkEditor value={d.links} onChange={(l) => set('links', l)} /> : (
            <ul className="pf-link-list">
              {v.links.map((l) => (
                <li key={l.url}>
                  {/* no referrer, no opener: the destination learns nothing about this room */}
                  <a className="btn" href={l.url} target="_blank" rel="noopener noreferrer nofollow">{l.label} ↗</a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {editing && (
        <div className="pf-editbar">
          <p className="ui pf-reminder">Everything here is visible to every member. Nothing is required.</p>
          <ErrorNote message={err} />
          <div className="row pf-editbtns">
            <button type="button" className="btn" onClick={cancel} disabled={busy}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => void save()} disabled={busy || cover.uploading}>
              {busy ? 'Saving…' : cover.uploading ? 'Uploading…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </Win>
  );
}

/** Selected work: the numbered contents list. Owners add, and move entries up or down. */
function Contents({ handle, items, mine, onReorder }: { handle: string; items: ProjectSummary[]; mine: boolean; onReorder: (ids: string[]) => void }) {
  const move = (i: number, by: -1 | 1) => {
    const ids = items.map((p) => p.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    onReorder(ids);
  };
  return (
    <section className="pf-work" aria-labelledby="pf-work-h">
      <div className="row between">
        <h2 id="pf-work-h" className="pf-sec-h">Selected work</h2>
        {mine && items.length < PROJECTS_MAX && <Link className="btn" href={`/u/${handle}/work/new`}>+ Add project</Link>}
      </div>
      {items.length === 0 ? (
        <p className="muted">Projects are numbered case studies: a title, a line of details, a write-up and up to {PROJECT_IMAGES_MAX} images. Add the first one.</p>
      ) : (
        <ol className="pf-contents">
          {items.map((p, i) => (
            <li key={p.id}>
              <Link href={`/u/${handle}/work/${p.id}`} className={`pf-item${p.hidden ? ' hidden' : ''}`}>
                <span className="pf-num">{nn(i)}</span>
                {p.cover
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img className="pf-cover" src={p.cover.url} alt="" width={p.cover.width} height={p.cover.height} />
                  : <span className="pf-cover none" aria-hidden="true" />}
                <span className="pf-item-main">
                  <span className="pf-item-title">
                    {p.title}{p.draft && <span className="tag">draft</span>}{p.hidden && <span className="tag danger">hidden after reports</span>}
                  </span>
                  {(p.year || p.role) && <span className="pf-item-meta">{[p.year, p.role].filter(Boolean).join(' · ')}</span>}
                </span>
              </Link>
              {mine && (
                <span className="pf-move">
                  <button type="button" className="icon-btn" aria-label={`Move ${p.title} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button type="button" className="icon-btn" aria-label={`Move ${p.title} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ─── read-only pieces ────────────────────────────────────────────────────────

function Tags({ items }: { items: string[] }) {
  return <ul className="pf-tags">{items.map((t) => <li key={t}>{t}</li>)}</ul>;
}

export const years = (e: { from: number; to: number | null }) => (e.to === null ? `${e.from} – now` : e.to === e.from ? `${e.from}` : `${e.from} – ${e.to}`);

function Entries({ items }: { items: PfEntry[] }) {
  return (
    <ul className="pf-entries">
      {items.map((e, i) => (
        <li key={`${e.title}-${e.from}-${i}`} className="pf-entry">
          <span className="pf-years">{years(e)}</span>
          <span className="pf-entry-main">
            <span className="pf-entry-title">{e.title}</span>
            {e.place && <span className="pf-entry-place">{e.place}</span>}
            {e.line && <span className="pf-entry-line">{e.line}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ─── editors ─────────────────────────────────────────────────────────────────

/** Chips plus one input: Enter or a comma adds, Backspace on an empty input takes the last one back. */
export function TagEditor({ value, onChange, placeholder, max = PF_TAGS_MAX, label = 'Add a tag' }: {
  value: string[]; onChange: (v: string[]) => void; placeholder: string; max?: number; label?: string;
}) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) {
      if (next.length >= max) break;
      if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p.slice(0, PF_TAG_MAX));
    }
    onChange(next);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); }
    else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
  };
  const full = value.length >= max;
  return (
    <div className="pf-tagedit">
      {value.length > 0 && (
        <ul className="pf-tags">
          {value.map((t) => (
            <li key={t}>
              {t}
              <button type="button" className="pf-tag-x" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>×</button>
            </li>
          ))}
        </ul>
      )}
      <input
        value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={() => add(text)}
        maxLength={PF_TAG_MAX * 4} placeholder={full ? `That is ${max}, the most it holds` : placeholder} disabled={full}
        aria-label={label}
      />
    </div>
  );
}

const blankEntry = (): PfEntry => ({ title: '', place: '', from: new Date().getFullYear(), to: null, line: '' });

function EntryEditor({ value, max, kind, onChange }: { value: PfEntry[]; max: number; kind: 'experience' | 'education'; onChange: (v: PfEntry[]) => void }) {
  const upd = (i: number, patch: Partial<PfEntry>) => onChange(value.map((e, n) => (n === i ? { ...e, ...patch } : e)));
  const titlePh = kind === 'experience' ? 'Product design intern' : 'B.Des, product design';
  const placePh = kind === 'experience' ? 'Studio or company' : 'School';
  return (
    <div className="pf-edit-list">
      {value.map((e, i) => (
        <fieldset key={i} className="pf-edit-entry">
          <legend className="sr-only">{kind} entry {i + 1}</legend>
          <label>Title
            <input value={e.title} maxLength={PF_ENTRY_TITLE_MAX} placeholder={titlePh} onChange={(x) => upd(i, { title: x.target.value })} />
          </label>
          <label>Place
            <input value={e.place} maxLength={PF_ENTRY_PLACE_MAX} placeholder={placePh} onChange={(x) => upd(i, { place: x.target.value })} />
          </label>
          <label>From
            <input type="number" inputMode="numeric" value={e.from} min={1950} max={2100} onChange={(x) => upd(i, { from: Number(x.target.value) })} />
          </label>
          <label>To
            <input type="number" inputMode="numeric" value={e.to ?? ''} min={1950} max={2100} placeholder="now"
              onChange={(x) => upd(i, { to: x.target.value === '' ? null : Number(x.target.value) })} />
          </label>
          <label className="wide">One line
            <input value={e.line} maxLength={PF_ENTRY_LINE_MAX} placeholder="What you did there, in one line" onChange={(x) => upd(i, { line: x.target.value })} />
          </label>
          <div className="wide row">
            <button type="button" className="link-btn danger-text" onClick={() => onChange(value.filter((_, n) => n !== i))}>Remove</button>
          </div>
        </fieldset>
      ))}
      {value.length < max
        ? <button type="button" className="btn" onClick={() => onChange([...value, blankEntry()])}>+ Add {kind}</button>
        : <p className="muted small ui">That is {max}, the most it holds.</p>}
    </div>
  );
}

function LinkEditor({ value, onChange }: { value: PfLink[]; onChange: (v: PfLink[]) => void }) {
  const upd = (i: number, patch: Partial<PfLink>) => onChange(value.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  return (
    <div className="pf-edit-list pf-linkedit">
      <h2 className="pf-links-h">Links</h2>
      {value.map((l, i) => (
        <div key={i} className="pf-edit-link">
          <label>Label
            <input value={l.label} maxLength={PF_LINK_LABEL_MAX} placeholder="Behance" onChange={(x) => upd(i, { label: x.target.value })} />
          </label>
          <label>Address (https)
            <input type="url" value={l.url} maxLength={PF_LINK_URL_MAX} placeholder="https://" inputMode="url" onChange={(x) => upd(i, { url: x.target.value })} />
          </label>
          <button type="button" className="link-btn danger-text" onClick={() => onChange(value.filter((_, n) => n !== i))}>Remove</button>
        </div>
      ))}
      {value.length < PF_LINKS_MAX
        ? <button type="button" className="btn" onClick={() => onChange([...value, { label: '', url: '' }])}>+ Add link</button>
        : <p className="muted small ui">That is {PF_LINKS_MAX}, the most it holds.</p>}
      <p className="muted small">Web addresses only, starting with https://. No email or phone: the site never collects them.</p>
    </div>
  );
}
