'use client';
import Link from 'next/link';
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { api, errorMessage, EDIT_WINDOW_MS, POST_MAX, type Post } from '@/lib/api';
import { fmtDate, relativeTime } from '@/lib/hooks';
import { ErrorNote } from './ui';
import { Avatar } from './Avatar';
import { BirthdayTag } from './Birthday';
import { NameMarks } from './Marks';
import { AlertDialog, Dot } from './retro';
import { ImageViewer } from './ImageViewer';
import { VISITOR_NOTE, useReadOnly, why } from './Visitor';

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
          <NameMarks admin={a.role === 'ops'} verified={a.verified} />
          <BirthdayTag b={a.birthday} />
          {a.isNew && a.state !== 'archived' && <span className="tag new-here" title="Joined in the last three weeks">new here</span>}
          {a.state === 'archived' && <span className="tag" title="This member's seat was released">archived</span>}
          {post.hidden && <span className="tag danger" title="Members can't see it; admins can, to review it">hidden after reports</span>}
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
  actions,
  context = 'all',
  variant,
}: {
  /**
   * RFC §10.12, posts and replies look different: 'lead' is the post at the top of its thread
   * (heavier, labelled), 'reply' a reply inside its thread (smaller, on the thread line). Left out,
   * a reply shown in a list (a profile, search) says what it answers and is drawn small too.
   */
  variant?: 'lead' | 'reply';
  /** say which collab / event an update belongs to; less where the page already says it */
  context?: 'all' | 'event' | 'none';
  post: Post;
  onChange: (p: Post) => void;
  highlight?: boolean;
  /** shown as "replying to @handle" */
  replyingTo?: string | null;
  id?: string;
  /** extra buttons for the footer row, e.g. Reply in a thread */
  actions?: ReactNode;
}) {
  const uid = useId();
  const readOnly = useReadOnly();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [menu, setMenu] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const likeBusy = useRef(false);
  // Every hook lives above the early return for deleted posts: deleting a post re-renders it as a
  // tombstone, and a hook below that return would change the hook count and crash React.
  const [ask, setAsk] = useState<null | 'delete' | 'report' | 'moderate'>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  /** true for a moment after *you* like it: the dot stamps in (never on page load) */
  const [stamp, setStamp] = useState(false);
  const [reported, setReported] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [menu]);

  /** a reply outside its thread: it carries a line saying what it answers */
  const listReply = !variant && !!post.parentId;
  const compact = variant === 'reply' || listReply;
  const cls = `post${highlight ? ' highlight' : ''}${variant === 'lead' ? ' lead' : ''}${compact ? ' compact' : ''}${listReply ? ' list-reply' : ''}`;
  const face = compact ? 36 : 52;

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
    if (nextLiked) { setStamp(true); setTimeout(() => setStamp(false), 400); }
    // the count exists only on your own posts; on anyone else's it stays null
    onChange({ ...post, likedByMe: nextLiked, likeCount: post.likeCount === null ? null : Math.max(0, post.likeCount + (nextLiked ? 1 : -1)) });
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
    setAsk(null);
    setErr(null);
    try {
      await api.deletePost(post.id);
      onChange({ ...post, deleted: true, body: '', images: [] });
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  /** an admin removes someone else's post: the author is told */
  async function moderate() {
    setAsk(null);
    setErr(null);
    try {
      await api.opsRemovePost(post.id);
      onChange({ ...post, deleted: true, body: '', images: [] });
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  async function report(reason: string) {
    setAsk(null);
    setErr(null);
    try {
      await api.flagPost(post.id, reason || undefined);
      setReported(true);
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  /** a number shows only on your own posts (the API sends null for everyone else's) */
  const liked = post.likeCount !== null && post.likeCount > 0;
  const replyLabel = post.replyCount > 0
    ? `${post.replyCount} ${post.replyCount === 1 ? 'reply' : 'replies'}`
    : post.firstPost && !post.canDelete ? 'Say hello' : 'Reply';
  const minutesLeft = Math.max(0, Math.ceil((new Date(post.createdAt).getTime() + EDIT_WINDOW_MS - Date.now()) / 60000));

  return (
    <article className={cls} id={id} aria-labelledby={`${uid}-h`}>
      {listReply && post.replyTo && (
        <p className="reply-to">
          <span aria-hidden="true">↳ </span>
          <Link href={`/p/${post.replyTo.rootId}#${post.id}`}>
            Replied to {post.replyTo.author ? `${post.replyTo.author.displayName}’s` : 'a'} post
          </Link>
          {post.replyTo.snippet && <span className="reply-to-quote">: &ldquo;{snip(post.replyTo.snippet)}&rdquo;</span>}
        </p>
      )}
      {post.author ? (
        <Link href={`/u/${post.author.handle}`} className="post-av" tabIndex={-1} aria-hidden="true">
          <Avatar seed={post.author.handle} gender={post.author.gender} size={face} />
        </Link>
      ) : (
        <span className="post-av"><Avatar seed={null} size={face} /></span>
      )}
      <div className="post-main">
      {variant === 'lead' && <p className="post-kind"><span className="tag">Post</span></p>}
      <header className="post-head">
        <span id={`${uid}-h`}><AuthorLine post={post} /></span>
        <span className="muted dot" aria-hidden="true">·</span>
        <Link href={`/p/${post.id}`} className="time muted" title={abs}>
          <time dateTime={post.createdAt}>{relativeTime(post.createdAt)}</time>
        </Link>
        {post.editedAt && <span className="muted edited" title={`Edited ${fmtDate(post.editedAt)}`}>(edited)</span>}
        {!readOnly && (post.canEdit || post.canDelete || post.canReport || post.canModerate) && (
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
                  <button type="button" role="menuitem" className="danger-text" onClick={() => { setMenu(false); setAsk('delete'); }}>Delete</button>
                )}
                {post.canReport && (
                  <button type="button" role="menuitem" onClick={() => { setMenu(false); setAsk('report'); }} disabled={reported}>{reported ? 'Reported' : 'Report'}</button>
                )}
                {post.canModerate && (
                  <button type="button" role="menuitem" className="danger-text" onClick={() => { setMenu(false); setAsk('moderate'); }}>Remove (admin)</button>
                )}
              </div>
            )}
          </div>
        )}
      </header>

      {post.firstPost && <p className="first-post"><span className="tag">First post</span></p>}
      {!post.parentId && ((context === 'all' && (post.collab || post.event)) || (context === 'event' && post.event)) && (
        <p className="muted small post-context">
          Update{context === 'all' && post.collab && <> in <Link href={`/collabs/${post.collab.id}`}>{post.collab.title}</Link></>}
          {post.event && <> from <Link href={`/events/${post.event.id}`}>{post.event.title}</Link></>}
        </p>
      )}
      {reported && <p className="muted small" role="status">Reported. Thanks, a moderator will take a look.</p>}
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
            <a
              key={im.id} href={im.url} target="_blank" rel="noopener noreferrer"
              aria-label={`Open image ${i + 1} of ${post.images.length}`}
              onClick={(e) => {
                // plain click opens the viewer window; ctrl/cmd/middle-click still opens a tab
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                setViewing(i);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.url} alt={`Image ${i + 1} of ${post.images.length}`} width={im.width} height={im.height} loading="lazy" />
            </a>
          ))}
        </div>
      )}

      <footer className="post-foot">
        {/* a zero is an invitation ("Reply"), not a count; on someone's first post, a welcome */}
        <Link href={replyHref} className="foot-btn" aria-label={replyLabel}>
          <span aria-hidden="true">↳ {replyLabel}</span>
        </Link>
        <button
          type="button"
          className={`foot-btn like${post.likedByMe ? ' on' : ''}${stamp ? ' stamp' : ''}`}
          aria-pressed={post.likedByMe}
          onClick={toggleLike}
          disabled={post.hidden || readOnly}
          {...why(readOnly ? VISITOR_NOTE : liked ? 'Only you see how many people liked your post' : false)}
        >
          <Dot on={post.likedByMe} size=".85em" />
          {/* name = "Like 3": includes the visible count, so voice control ("click 3") works; with no count shown the word stands alone */}
          <span className={liked ? 'sr-only' : undefined}>Like</span>
          {liked && <span>{post.likeCount}<span className="sr-only">, only you see this</span></span>}
        </button>
        {actions}
      </footer>
      <ErrorNote message={err} />
      </div>

      {post.images.length > 0 && (
        <ImageViewer
          images={post.images}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          alt={(i) => `Image ${i + 1} of ${post.images.length}${post.author ? ` posted by @${post.author.handle}` : ''}`}
        />
      )}
      <AlertDialog
        open={ask === 'delete'}
        title="Delete post"
        message={<>Delete this post? Replies stay, the post becomes a tombstone. <strong>This cannot be undone.</strong></>}
        confirmLabel="Delete"
        danger
        onConfirm={() => void remove()}
        onCancel={() => setAsk(null)}
      />
      <AlertDialog
        open={ask === 'moderate'}
        title="Remove post"
        message={<>Remove this post as admin? {post.author ? <>@{post.author.handle} is told it was removed. </> : null}<strong>This cannot be undone.</strong></>}
        confirmLabel="Remove"
        danger
        onConfirm={() => void moderate()}
        onCancel={() => setAsk(null)}
      />
      <AlertDialog
        open={ask === 'report'}
        title="Report post"
        message="Report this post to the moderators. What is wrong with it? (optional)"
        confirmLabel="Send report"
        input={{ label: 'Reason', placeholder: 'Spam, harassment, ...', maxLength: 500 }}
        onConfirm={(reason) => void report(reason)}
        onCancel={() => setAsk(null)}
      />
    </article>
  );
}

/** the start of the post a reply answers: a few words, cut at a space */
function snip(s: string, max = 60): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : max)}…`;
}

/** Replace one post in a list by id. */
export function replaceIn(list: Post[], p: Post): Post[] {
  return list.map((x) => (x.id === p.id ? p : x));
}
