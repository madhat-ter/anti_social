'use client';
import { useTitle } from '@/lib/hooks';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage, type Post, type Thread } from '@/lib/api';
import { SeatedShell } from '@/components/Shell';
import { Composer } from '@/components/Composer';
import { PostCard } from '@/components/PostCard';
import { ErrorNote } from '@/components/ui';
import { Loading } from '@/components/retro';

export default function ThreadPage() {
  useTitle('Post');
  return <SeatedShell>{() => <ThreadView />}</SeatedShell>;
}

function ThreadView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setThread(null); setError(null);
    api.thread(id).then(
      (t) => { if (alive) { setThread(t); setFocus(window.location.hash.slice(1) || t.focusId); } },
      (e) => { if (alive) setError(errorMessage(e)); },
    );
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    if (!thread || !focus || focus === thread.root.id) return;
    const el = document.getElementById(`post-${focus}`);
    el?.scrollIntoView({ block: 'center' });
  }, [thread, focus]);

  if (error) {
    return (
      <>
        <ErrorNote message={error} />
        <p><Link href="/">Back to the feed</Link></p>
      </>
    );
  }
  if (!thread) return <Loading />;

  const { root, replies } = thread;
  const byId = new Map<string, Post>([[root.id, root], ...replies.map((r) => [r.id, r] as [string, Post])]);
  const update = (p: Post) => {
    setThread((t) => t && (t.root.id === p.id ? { ...t, root: p } : { ...t, replies: t.replies.map((r) => (r.id === p.id ? p : r)) }));
  };
  const added = (p: Post) => {
    setReplyTo(null);
    setThread((t) => t && { ...t, root: { ...t.root, replyCount: t.root.replyCount + 1 }, replies: [...t.replies, p] });
    setFocus(p.id);
  };

  return (
    <>
      <p>
        {root.collab ? <Link href={`/collab/${root.collab.id}`}>Back to {root.collab.title}</Link>
          : root.event ? <Link href={`/collab/event/${root.event.id}`}>Back to {root.event.title}</Link>
          : <Link href="/">Back to the feed</Link>}
      </p>
      <h1 className="sr-only">Thread</h1>
      <PostCard post={root} onChange={update} id={`post-${root.id}`} variant="lead" />
      {/* hidden after reports: an admin is reviewing it, nobody can reply */}
      {!root.hidden && <Composer parentId={root.id} onCreated={added} />}
      <h2 className="section-h">Replies{replies.length ? ` (${replies.length})` : ''}</h2>
      {replies.length === 0 && <p className="muted">No replies yet.</p>}
      {/* RFC §10.12: replies hang off the post on one line, smaller than it; flat, one level */}
      <div className="posts thread-replies">
        {replies.map((r) => {
          const parent = r.parentId && r.parentId !== root.id ? byId.get(r.parentId) : null;
          const handle = parent?.author?.handle ?? null;
          return (
            <div key={r.id} className="reply">
              <PostCard
                post={r} onChange={update} id={`post-${r.id}`} highlight={focus === r.id} replyingTo={handle} variant="reply"
                actions={!r.deleted && (
                  <button type="button" className="foot-btn" onClick={() => setReplyTo(replyTo === r.id ? null : r.id)} aria-expanded={replyTo === r.id}>
                    {replyTo === r.id ? 'Cancel reply' : 'Reply'}
                  </button>
                )}
              />
              {replyTo === r.id && <Composer parentId={r.id} onCreated={added} placeholder={`Reply to ${r.author ? '@' + r.author.handle : 'this post'}...`} />}
            </div>
          );
        })}
      </div>
    </>
  );
}
