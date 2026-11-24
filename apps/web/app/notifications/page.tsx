'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, type Notification } from '@/lib/api';
import { relativeTime, fmtDate, usePaged, useTitle } from '@/lib/hooks';
import { SeatedShell, broadcastUnread } from '@/components/Shell';
import { ListStatus, PagedFooter } from '@/components/Paged';
import { ErrorNote } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { AlertIcon, Dot } from '@/components/retro';
import { describe, notificationHref, WARNINGS } from '@/lib/notifications';

export default function NotificationsPage() {
  useTitle('Notifications');
  return <SeatedShell>{(me) => <Notifications myHandle={me.handle} />}</SeatedShell>;
}

function Notifications({ myHandle }: { myHandle: string }) {
  const p = usePaged<Notification>('notifications', async (c) => {
    const r = await api.notifications(c);
    return r;
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const marked = useRef(new Set<string>());

  // Mark the visible unread ones as read once they load (styling stays until reload).
  useEffect(() => {
    const ids = p.items.filter((n) => !n.readAt && !marked.current.has(n.id)).map((n) => n.id);
    if (!ids.length) return;
    ids.forEach((id) => marked.current.add(id));
    api.markRead(ids).then((r) => broadcastUnread(r.unreadCount), () => { ids.forEach((id) => marked.current.delete(id)); });
  }, [p.items]);

  async function markAll() {
    setBusy(true); setErr(null);
    try {
      const r = await api.markRead();
      broadcastUnread(r.unreadCount);
      const now = new Date().toISOString();
      p.setItems((cur) => cur.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const anyUnread = p.items.some((n) => !n.readAt);
  return (
    <>
      <div className="row between">
        <h1>Notifications</h1>
        <button type="button" className="btn" onClick={markAll} disabled={busy || !anyUnread}>Mark all read</button>
      </div>
      <ErrorNote message={err} />
      <ListStatus p={p} count={p.items.length} empty="No notifications yet." />
      {p.items.length > 0 && (
        <ul className="notifs card">
          {p.items.map((n) => {
            const href = notificationHref(n, myHandle);
            const body = (
              <>
                {n.actor
                  ? <Avatar seed={n.actor.handle} gender={n.actor.gender} size={40} />
                  : <span className="notif-sys">{WARNINGS.has(n.kind) ? <AlertIcon size={28} /> : <Dot size="1.1rem" />}</span>}
                <span className="notif-text">
                  <span className="notif-title">{!n.readAt && <><span className="dot-unread" aria-hidden="true" /><span className="sr-only">Unread: </span></>}{describe(n)}</span>
                  {n.post?.snippet && <span className="muted small notif-snippet">{n.post.snippet}</span>}
                  <time className="muted small" dateTime={n.createdAt} title={fmtDate(n.createdAt)}>{relativeTime(n.createdAt)}</time>
                </span>
              </>
            );
            return (
              <li key={n.id} className={n.readAt ? 'notif' : 'notif unread'}>
                {href ? <Link href={href} className="notif-link">{body}</Link> : <div className="notif-link">{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
      <PagedFooter p={p} />
    </>
  );
}
