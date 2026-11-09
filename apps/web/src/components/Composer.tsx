'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { api, errorMessage, IMAGE_MAX_BYTES, IMAGES_MAX, POST_MAX, type Image, type Post } from '@/lib/api';
import { ErrorNote } from './ui';
import { VISITOR_NOTE, useReadOnly, why } from './Visitor';

interface Att {
  key: string;
  preview: string;
  status: 'uploading' | 'done' | 'error';
  image?: Image;
  error?: string;
}

export function Composer({
  parentId,
  collabId,
  eventId,
  meetups,
  title,
  onCreated,
  placeholder,
  submitLabel,
  collapsible = false,
}: {
  parentId?: string;
  /** an update in this collab's thread (RFC §10.5) */
  collabId?: string;
  /** an update on this event's page */
  eventId?: string;
  /** a collab's meetups: the update can be tied to one */
  meetups?: { id: string; title: string }[];
  /** the window title */
  title?: string;
  onCreated: (p: Post) => void;
  placeholder?: string;
  submitLabel?: string;
  /** on phones (CSS), one line until it is tapped or holds a draft; nothing changes on wide screens */
  collapsible?: boolean;
}) {
  const id = useId();
  const [opened, setOpened] = useState(false);
  /** a visitor (RFC §10.8) sees the composer and can't use it: that is the point */
  const readOnly = useReadOnly();
  const [body, setBody] = useState('');
  const [atts, setAtts] = useState<Att[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [meetup, setMeetup] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const attsRef = useRef<Att[]>([]);
  attsRef.current = atts;

  useEffect(() => () => { attsRef.current.forEach((a) => URL.revokeObjectURL(a.preview)); }, []);

  // Draft autosave: text only, this device only, one draft per place you can write.
  // Restored after mount (localStorage is not available during server render).
  const draftKey = `anti:draft:${parentId ?? (collabId ? `c:${collabId}` : eventId ? `e:${eventId}` : 'feed')}`;
  const [restored, setRestored] = useState(false);
  const [savedDraft, setSavedDraft] = useState(false);
  useEffect(() => {
    try {
      const d = localStorage.getItem(draftKey);
      if (d) { setBody(d); setSavedDraft(true); setOpened(true); }
    } catch { /* storage blocked */ }
    setRestored(true);
  }, [draftKey]);
  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(() => {
      try {
        if (body.trim()) { localStorage.setItem(draftKey, body); setSavedDraft(true); }
        else { localStorage.removeItem(draftKey); setSavedDraft(false); }
      } catch { /* storage blocked */ }
    }, 400);
    return () => clearTimeout(t);
  }, [body, draftKey, restored]);

  const uploading = atts.some((a) => a.status === 'uploading');
  const hasFailed = atts.some((a) => a.status === 'error');
  const trimmed = body.trim();
  const over = body.length > POST_MAX;
  const hasImage = atts.some((a) => a.status === 'done');
  const canPost = !busy && !uploading && (trimmed.length > 0 || hasImage) && !over && !readOnly;

  function pick(files: FileList | null) {
    if (!files) return;
    setErr(null);
    const room = IMAGES_MAX - atts.length;
    const chosen = Array.from(files);
    if (chosen.length > room) setErr(`You can attach up to ${IMAGES_MAX} images.`);
    for (const f of chosen.slice(0, Math.max(room, 0))) {
      if (!f.type.startsWith('image/')) { setErr(`"${f.name}" is not an image.`); continue; }
      if (f.size > IMAGE_MAX_BYTES) { setErr(`"${f.name}" is larger than 5 MB.`); continue; }
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const preview = URL.createObjectURL(f);
      setAtts((cur) => [...cur, { key, preview, status: 'uploading' }]);
      api.upload(f).then(
        (image) => setAtts((cur) => cur.map((a) => (a.key === key ? { ...a, status: 'done', image } : a))),
        (e) => setAtts((cur) => cur.map((a) => (a.key === key ? { ...a, status: 'error', error: errorMessage(e) } : a))),
      );
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  function remove(key: string) {
    setAtts((cur) => {
      const a = cur.find((x) => x.key === key);
      if (a) URL.revokeObjectURL(a.preview);
      return cur.filter((x) => x.key !== key);
    });
  }

  async function submit() {
    if (!canPost) return;
    setBusy(true); setErr(null);
    try {
      const imageIds = atts.filter((a) => a.status === 'done' && a.image).map((a) => a.image!.id);
      const post = await api.createPost({
        body: trimmed,
        ...(parentId ? { parentId } : {}),
        ...(collabId ? { collabId } : {}),
        ...(eventId ?? meetup ? { eventId: eventId ?? meetup } : {}),
        ...(imageIds.length ? { imageIds } : {}),
      });
      atts.forEach((a) => URL.revokeObjectURL(a.preview));
      try { localStorage.removeItem(draftKey); } catch { /* storage blocked */ }
      setSavedDraft(false);
      setBody(''); setAtts([]); setOpened(false);
      onCreated(post);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={`composer win${collapsible ? ' collapsible' : ''}${opened || atts.length > 0 ? ' open' : ''}`}
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <div className="win-bar" aria-hidden="true">
        <span className="win-close" />
        <span className="win-title">{title ?? (parentId ? 'reply.txt' : 'new_post.txt')}</span>
      </div>
      <div className="win-body">
      <label htmlFor={`${id}-body`} className="sr-only">{parentId ? 'Write a reply' : 'Write a post'}</label>
      <textarea
        id={`${id}-body`}
        value={body}
        rows={parentId ? 3 : 4}
        placeholder={readOnly ? VISITOR_NOTE : placeholder ?? (parentId ? 'Write a reply...' : 'What is on your mind?')}
        disabled={readOnly}
        title={readOnly ? VISITOR_NOTE : undefined}
        onChange={(e) => { setBody(e.target.value); if (e.target.value) setOpened(true); }}
        onFocus={() => setOpened(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); }
        }}
        aria-describedby={`${id}-count`}
      />
      {atts.length > 0 && (
        <ul className="thumbs" aria-label="Attached images">
          {atts.map((a, i) => (
            <li key={a.key} className={`thumb ${a.status}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.preview} alt={`Attachment ${i + 1} of ${atts.length}`} />
              {a.status === 'uploading' && <span className="spinner" role="status" aria-label="Uploading" />}
              {a.status === 'error' && <span className="thumb-err" title={a.error}>Failed</span>}
              <button type="button" className="thumb-x" onClick={() => remove(a.key)} aria-label={`Remove image ${i + 1}`}>×</button>
            </li>
          ))}
        </ul>
      )}
      {atts.filter((a) => a.error).map((a) => <ErrorNote key={a.key} message={a.error ?? null} />)}
      <ErrorNote message={err} />
      {meetups && meetups.length > 0 && (
        <label className="inline composer-meetup">From a meetup
          <select value={meetup} onChange={(e) => setMeetup(e.target.value)}>
            <option value="">None</option>
            {meetups.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        </label>
      )}
      <div className="row composer-bar">
        <input
          ref={fileRef}
          id={`${id}-file`}
          type="file"
          accept="image/*"
          multiple
          disabled={atts.length >= IMAGES_MAX || readOnly}
          className="sr-only"
          onChange={(e) => pick(e.target.files)}
        />
        <label htmlFor={`${id}-file`} className={`btn attach${atts.length >= IMAGES_MAX || readOnly ? ' disabled' : ''}`} aria-disabled={atts.length >= IMAGES_MAX || readOnly} {...why(readOnly ? VISITOR_NOTE : atts.length >= IMAGES_MAX && `Up to ${IMAGES_MAX} pictures`)}>
          + Image
        </label>
        <span className="grow" />
        {savedDraft && body.trim() && <span className="counter" role="status">Draft saved</span>}
        <span id={`${id}-count`} className={`counter${over ? ' over' : ''}`} aria-live="polite">
          {body.length}/{POST_MAX}
        </span>
        <button className="btn primary" type="submit" disabled={!canPost} title={readOnly ? undefined : hasFailed ? 'Failed uploads are skipped' : 'Ctrl/Cmd+Enter'} {...why(readOnly && VISITOR_NOTE)}>
          {busy ? 'Posting...' : (submitLabel ?? (parentId ? 'Reply' : 'Post'))}
        </button>
      </div>
      </div>
    </form>
  );
}
