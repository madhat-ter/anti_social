'use client';
import Link from 'next/link';
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { api, errorMessage, EDIT_WINDOW_MS, POST_MAX, type Post } from '@/lib/api';
import { fmtDate, relativeTime } from '@/lib/hooks';
import { ErrorNote } from './ui';

const URL_RE = /https?:\/\/[^\s<>"]+/g;

/** Turns plain text into nodes with http(s) URLs linked. Never injects HTML. */
export function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    const start = m.index ?? 0;
    // trailing punctuation belongs to the sentence, not the URL
    const trail = url.match(/[.,;:!?)\]'"]+$/)?.[0] ?? '';
    if (trail) url = url.slice(0, url.length - trail.length);
    if (!url) continue;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <a key={n++} href={url} target="_blank" rel="noopener noreferrer nofollow">{url}</a>,
    );
    last = start + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.map((x, i) => <Fragment key={i}>{x}</Fragment>);
}

export function AuthorLine({ post }: { post: Post }) {
  const a = post.author;
  return (
    <span className="author">
      {a ? (
        <>
          <Link href={`/u/${a.handle}`} className="name">{a.displayName}</Link>{' '}
          <Link href={`/u/${a.handle}`} className="handle muted">@{a.handle}</Link>
          {a.state === 'archived' && <span className="tag" title="This member's seat was released">archived</span>}
        </>
      ) : (
        <span className="muted">deleted user</span>
      )}
    </span>
  );
}

export function PostCard({
  post,
  onChange,
  highlight,
  replyingTo,
  id,
}: {
  post: Post;
  onChange: (p: Post) => void;
  highlight?: boolean;
  /** shown as "replying to @handle" */
  replyingTo?: string | null;
  id?: string;
}) {
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [menu, setMenu] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const likeBusy = useRef(false);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [menu]);

  const cls = `post${highlight ? ' highlight' : ''}`;

  if (post.deleted) {
    return (
      <article className={`${cls} tombstone`} id={id}>
        <p className="muted">This post was deleted.</p>
      </article>
    );
  }

  const threadHref = `/p/${post.rootId ?? post.id}`;
  const replyHref = post.rootId && post.rootId !== post.id ? `${threadHref}#${post.id}` : threadHref;
  const abs = fmtDate(post.createdAt);

  async function toggleLike() {
    if (likeBusy.current) return;
    likeBusy.current = true;
    setErr(null);
    const was = post;
    const nextLiked = !post.likedByMe;
    onChange({ ...post, likedByMe: nextLiked, likeCount: Math.max(0, post.likeCount + (nextLiked ? 1 : -1)) });
    try {
      const r = nextLiked ? await api.like(post.id) : await api.unlike(post.id);
      onChange({ ...was, likedByMe: r.likedByMe, likeCount: r.likeCount });
    } catch (e) {
      onChange(was);
      setErr(errorMessage(e));
    } finally {
      likeBusy.current = false;
    }
  }

  async function saveEdit() {
    const body = draft.trim();
    if (!body || body.length > POST_MAX) return;
    setBusy(true); setErr(null);
    try {
      onChange(await api.editPost(post.id, body));
      setEditing(false);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setMenu(false);
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    setErr(null);
    try {
      await api.deletePost(post.id);
      onChange({ ...post, deleted: true, body: '', images: [] });
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  const minutesLeft = Math.max(0, Math.ceil((new Date(post.createdAt).getTime() + EDIT_WINDOW_MS - Date.now()) / 60000));

  return (
    <article className={cls} id={id} aria-labelledby={`${uid}-h`}>
      <header className="post-head">
        <span id={`${uid}-h`}><AuthorLine post={post} /></span>
        <span className="muted dot" aria-hidden="true">·</span>
        <Link href={`/p/${post.id}`} className="time muted" title={abs}>
          <time dateTime={post.createdAt}>{relativeTime(post.createdAt)}</time>
        </Link>
        {post.editedAt && <span className="muted edited" title={`Edited ${fmtDate(post.editedAt)}`}>(edited)</span>}
        {(post.canEdit || post.canDelete) && (
          <div className="menu" ref={menuRef}>
            <button
              type="button"
              className="icon-btn"
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-label="Post actions"
              onClick={() => setMenu((m) => !m)}
            >
              ⋯
            </button>
            {menu && (
              <div className="menu-pop" role="menu">
                {post.canEdit && (
                  <button type="button" role="menuitem" onClick={() => { setMenu(false); setDraft(post.body); setEditing(true); }}>Edit</button>
                )}
                {post.canDelete && (
                  <button type="button" role="menuitem" className="danger-text" onClick={remove}>Delete</button>
                )}
              </div>
            )}
          </div>
        )}
      </header>

      {replyingTo && (
        <p className="muted replying">replying to <Link href={`/u/${replyingTo}`}>@{replyingTo}</Link></p>
      )}

      {editing ? (
        <div className="stack">
          <label htmlFor={`${uid}-edit`} className="sr-only">Edit post</label>
          <textarea
            id={`${uid}-edit`}
            value={draft}
            rows={4}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void saveEdit(); }
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <div className="row">
            <button type="button" className="btn primary" disabled={busy || !draft.trim() || draft.length > POST_MAX} onClick={saveEdit}>
              {busy ? 'Saving...' : 'Save'}
            </button>
            <button type="button" className="btn" onClick={() => { setEditing(false); setErr(null); }}>Cancel</button>
            <span className="grow" />
            <span className="muted small">{minutesLeft > 0 ? `~${minutesLeft} min left to edit` : ''}</span>
            <span className={`counter${draft.length > POST_MAX ? ' over' : ''}`}>{draft.length}/{POST_MAX}</span>
          </div>
        </div>
      ) : (
        <p className="body">{linkify(post.body)}</p>
      )}

      {post.images.length > 0 && (
        <div className={`imgs n${Math.min(post.images.length, 4)}`}>
          {post.images.map((im, i) => (
            <a key={im.id} href={im.url} target="_blank" rel="noopener noreferrer" aria-label={`Open image ${i + 1} of ${post.images.length}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.url} alt={`Image ${i + 1} of ${post.images.length}`} width={im.width} height={im.height} loading="lazy" />
            </a>
          ))}
        </div>
      )}

      <footer className="post-foot">
        <Link href={replyHref} className="foot-btn" aria-label={`${post.replyCount} ${post.replyCount === 1 ? 'reply' : 'replies'}`}>
          <span aria-hidden="true">Replies</span> {post.replyCount}
        </Link>
        <button
          type="button"
          className={`foot-btn like${post.likedByMe ? ' on' : ''}`}
          aria-pressed={post.likedByMe}
          aria-label={post.likedByMe ? `Unlike (${post.likeCount})` : `Like (${post.likeCount})`}
          onClick={toggleLike}
        >
          <span aria-hidden="true">{post.likedByMe ? '♥' : '♡'}</span> {post.likeCount}
        </button>
      </footer>
      <ErrorNote message={err} />
    </article>
  );
}

/** Replace one post in a list by id. */
export function replaceIn(list: Post[], p: Post): Post[] {
  return list.map((x) => (x.id === p.id ? p : x));
}
