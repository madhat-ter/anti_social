'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { Gender } from '@anti/shared';
import { api, errorMessage, IMAGE_MAX_BYTES, IMAGES_MAX, POST_MAX, type Image, type PetLabel, type Post } from '@/lib/api';
import { ErrorNote } from './ui';
import { Avatar } from './Avatar';
import { VISITOR_NOTE, useReadOnly, why } from './Visitor';

type MentionItem = { handle: string; displayName: string; gender: Gender | null };

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
  pet,
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
  /** RFC §10.17: write as this pet (author stays the owner) */
  pet?: { id: string; name: string };
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
  /** RFC §10.17: a pet post carries one label */
  const [petLabel, setPetLabel] = useState<PetLabel>('everyday');
  const fileRef = useRef<HTMLInputElement>(null);
  const attsRef = useRef<Att[]>([]);
  attsRef.current = atts;

  /**
   * RFC §10.16: typing @ opens the members list under the box. No mention button: the list is the
   * only way in, and an @word that matches nobody stays plain text.
   */
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ at: number; query: string } | null>(null);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionAt, setMentionAt] = useState(0);

  useEffect(() => {
    if (!mention) { setMentionItems([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.mentionMembers(mention.query).then(
        (r) => { if (alive) { setMentionItems(r.items); setMentionAt(0); } },
        () => { if (alive) setMentionItems([]); },
      );
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [mention]);

  /** where the caret is, is there an unfinished @word right before it? */
  function trackMention(value: string, caret: number) {
    const open = value.slice(0, caret).match(/(^|[^\w@])@([a-zA-Z0-9_]{0,19})$/);
    if (!open) return setMention(null);
    setMention({ at: caret - open[2]!.length - 1, query: open[2]! });
  }

  function chooseMention(item: MentionItem) {
    const ta = bodyRef.current;
    if (!ta || !mention) return;
    const caret = ta.selectionStart ?? body.length;
    const next = `${body.slice(0, mention.at)}@${item.handle} ${body.slice(caret)}`;
    setBody(next);
    setMention(null);
    setMentionItems([]);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = mention.at + item.handle.length + 2;
      ta.setSelectionRange(pos, pos);
    });
  }

  useEffect(() => () => { attsRef.current.forEach((a) => URL.revokeObjectURL(a.preview)); }, []);

  // Draft autosave: text only, this device only, one draft per place you can write.
  // Restored after mount (localStorage is not available during server render).
  const draftKey = `anti:draft:${parentId ?? (pet ? `pet:${pet.id}` : collabId ? `c:${collabId}` : eventId ? `e:${eventId}` : 'feed')}`;
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
  // RFC §10.17: a pet post carries one picture, not a gallery
  const maxImages = pet ? 1 : IMAGES_MAX;
  const canPost = !busy && !uploading && (trimmed.length > 0 || hasImage) && !over && !readOnly;

  function pick(files: FileList | null) {
    if (!files) return;
    setErr(null);
    const room = maxImages - atts.length;
    const chosen = Array.from(files);
    if (chosen.length > room) setErr(pet ? 'A pet post carries one picture.' : `You can attach up to ${maxImages} images.`);
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
        ...(pet ? { petId: pet.id, petLabel } : {}),
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
        <span className="win-title">{title ?? (pet ? `posting_as_${pet.name.toLowerCase().replace(/\s+/g, '_')}.txt` : parentId ? 'reply.txt' : 'new_post.txt')}</span>
      </div>
      <div className="win-body">
      <label htmlFor={`${id}-body`} className="sr-only">{parentId ? 'Write a reply' : 'Write a post'}</label>
      <div className="composer-text">
        <textarea
          id={`${id}-body`}
          ref={bodyRef}
          value={body}
          rows={parentId ? 3 : 4}
          placeholder={readOnly ? VISITOR_NOTE : placeholder ?? (pet ? `What is ${pet.name} up to?` : parentId ? 'Write a reply...' : 'What is on your mind?')}
          disabled={readOnly}
          title={readOnly ? VISITOR_NOTE : undefined}
          onChange={(e) => {
            setBody(e.target.value);
            if (e.target.value) setOpened(true);
            trackMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onFocus={() => setOpened(true)}
          onBlur={() => { setTimeout(() => setMention(null), 100); }}
          onKeyDown={(e) => {
            if (mention && mentionItems.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setMentionAt((i) => (i + 1) % mentionItems.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setMentionAt((i) => (i - 1 + mentionItems.length) % mentionItems.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); chooseMention(mentionItems[mentionAt]!); return; }
              if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); }
          }}
          aria-describedby={`${id}-count`}
          aria-expanded={!!mention && mentionItems.length > 0}
          aria-controls={`${id}-mentions`}
        />
        {mention && mentionItems.length > 0 && (
          <ul className="mention-list" id={`${id}-mentions`} role="listbox" aria-label="Mention a member">
            {mentionItems.map((item, i) => (
              <li key={item.handle} role="option" aria-selected={i === mentionAt}>
                <button
                  type="button"
                  tabIndex={-1}
                  className={i === mentionAt ? 'on' : undefined}
                  onMouseDown={(e) => { e.preventDefault(); chooseMention(item); }}
                >
                  <Avatar seed={item.handle} gender={item.gender} size={24} />
                  <span className="mention-name">{item.displayName}</span>
                  <span className="mention-handle">@{item.handle}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
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
      {pet && (
        <div className="row chips composer-label" role="radiogroup" aria-label="Kind of update">
          {(['everyday', 'advice', 'health', 'help'] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={petLabel === l}
              className={`chip${petLabel === l ? ' on' : ''}`} onClick={() => setPetLabel(l)}>
              {l === 'everyday' ? 'Everyday' : l === 'advice' ? 'Advice' : l === 'health' ? 'Health' : 'Help'}
            </button>
          ))}
        </div>
      )}
      <div className="row composer-bar">
        <input
          ref={fileRef}
          id={`${id}-file`}
          type="file"
          accept="image/*"
          multiple
          disabled={atts.length >= maxImages || readOnly}
          className="sr-only"
          onChange={(e) => pick(e.target.files)}
        />
        <label htmlFor={`${id}-file`} className={`btn attach${atts.length >= maxImages || readOnly ? ' disabled' : ''}`} aria-disabled={atts.length >= maxImages || readOnly} {...why(readOnly ? VISITOR_NOTE : atts.length >= maxImages && (pet ? 'One picture per pet post' : `Up to ${maxImages} pictures`))}>
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
