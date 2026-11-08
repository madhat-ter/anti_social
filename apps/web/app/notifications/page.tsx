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

/** System notices that need action get the warning triangle; good news gets the red dot. */
const WARNINGS = new Set(['lurker_warning', 'seat_offer_expired', 'payment_refunded', 'event_cancelled', 'post_removed', 'project_removed']);

export default function NotificationsPage() {
  useTitle('Notifications');
  return <SeatedShell>{() => <Notifications />}</SeatedShell>;
}

function describe(n: Notification): string {
  const who = n.actor ? `@${n.actor.handle}` : 'Someone';
  if (n.kind === 'reply') return `${who} replied to your post`;
  if (n.kind === 'like') return `${who} liked your post`;
  if (n.kind === 'activated') return 'You have a seat. Welcome in.';
  if (n.kind === 'seat_offered') return 'A seat opened up for you. Reinstate within 72 hours to keep it.';
  if (n.kind === 'seat_offer_expired') return 'Your seat offer expired. You can rejoin the queue.';
  if (n.kind === 'lurker_warning') return 'You have been quiet for a while. Post or reply twice in 7 days to keep your seat.';
  const ev = n.event ? `"${n.event.title}"` : 'an event';
  if (n.kind === 'event_rsvp') return `${who} is going to ${ev}`;
  if (n.kind === 'event_promoted') return `A spot opened up: you are now going to ${ev}`;
  if (n.kind === 'event_updated') return `The time or place of ${ev} changed`;
  if (n.kind === 'event_cancelled') return `${ev} was cancelled`;
  if (n.kind === 'stay_fee_paid') return 'Stay fee received. You are exempt from the posting rule for 90 days.';
  if (n.kind === 'reinstated') return 'Payment received. Welcome back, your seat is yours again.';
  if (n.kind === 'payment_refunded') return 'Your payment was refunded.';
  if (n.kind === 'post_removed') return 'An admin removed one of your posts.';
  if (n.kind === 'project_removed') return n.projectTitle ? `An admin removed your project "${n.projectTitle}".` : 'An admin removed one of your projects.';
  if (n.kind === 'checklist_reminder') return `Finish your profile: ${n.checklist?.done ?? 0} of ${n.checklist?.total ?? 5} done. The checklist is on the feed.`;
  if (n.kind === 'pick_remark') return `${who} left a remark on your pick "${n.pickTitle ?? ''}"`;
  if (n.kind === 'remark_removed') return `An admin removed your remark on "${n.pickTitle ?? 'a pick'}"`;
  if (n.kind === 'handle_changed') return n.newHandle ? `An admin changed your handle to @${n.newHandle}. Your profile link changed with it.` : 'An admin changed your handle.';
  if (n.kind === 'unbanned') return 'An admin lifted your ban. Welcome back.';
  if (n.kind === 'made_admin') return 'You are now an admin. Your tools are under Admin in the menu.';
  if (n.kind === 'admin_removed') return 'You are no longer an admin.';
  if (n.kind === 'flag_threshold') return 'Something was hidden after 5 reports and needs review in Admin.';
  return n.post ? `${who} interacted with your post` : 'Account update';
}

function Notifications() {
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
            const href = n.kind === 'flag_threshold' || n.kind === 'made_admin' ? '/admin'
              : n.kind === 'checklist_reminder' ? '/'
              : n.kind === 'handle_changed' && n.newHandle ? `/u/${n.newHandle}`
              : n.post ? `/p/${n.post.rootId ?? n.post.id}#${n.post.id}` : n.event ? `/events/${n.event.id}` : null;
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
