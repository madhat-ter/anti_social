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
const WARNINGS = new Set(['lurker_warning', 'seat_offer_expired', 'payment_refunded', 'event_cancelled', 'post_removed', 'project_removed', 'consult_removed', 'consult_switched_off']);

export default function NotificationsPage() {
  useTitle('Notifications');
  return <SeatedShell>{(me) => <Notifications myHandle={me.handle} />}</SeatedShell>;
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
  const co = n.collab ? `"${n.collab.title}"` : 'a collab';
  if (n.kind === 'collab_request') return `${who} asked to join ${co}`;
  if (n.kind === 'collab_joined') return `${who} joined ${co}`;
  if (n.kind === 'collab_accepted') return `You are on the team for ${co}. Say hello.`;
  if (n.kind === 'collab_declined') return `${co} has found its people this time. There are plenty more in Collabs.`;
  if (n.kind === 'collab_update') return `${who} posted an update in ${co}`;
  if (n.kind === 'collab_meetup') return `${who} planned a meetup for ${co}${n.event ? `: "${n.event.title}"` : ''}`;
  if (n.kind === 'collab_finished') return `${co} is finished. Well done. A draft project is waiting in your portfolio: edit it and publish, or delete it.`;
  if (n.kind === 'event_update') return `${who} posted an update on ${ev}`;
  if (n.kind === 'collab_removed') return n.collabTitle ? `An admin removed your collab "${n.collabTitle}".` : 'An admin removed one of your collabs.';
  if (n.kind === 'event_request') return `${who} asked to come to ${ev}`;
  if (n.kind === 'event_accepted') return `You are in: the host accepted you for ${ev}`;
  if (n.kind === 'event_declined') return `${ev} is full of people already. There are plenty more in Events.`;
  if (n.kind === 'event_invite') return `${who} invited you to ${ev}`;
  if (n.kind === 'collab_invite') return `${who} invited you to join ${co}`;
  const on = n.consultation?.topic ? ` on ${n.consultation.topic}` : '';
  if (n.kind === 'consult_request') return `${who} asked you for a consultation${on}`;
  if (n.kind === 'consult_accepted') return n.consultation?.pricing === 'paid'
    ? `${who} accepted your request${on} and set a price. Agree to it to swap contacts.`
    : `${who} accepted your request${on}, free. Your contacts are swapped.`;
  if (n.kind === 'consult_declined') return `Your consultation request${on} was declined. There are other people to ask.`;
  if (n.kind === 'consult_agreed') return `${who} agreed to your price${on}. Your contacts are swapped.`;
  if (n.kind === 'consult_expired') return n.consultation?.was === 'accepted'
    ? `Your price for a consultation${on} was not agreed to in 7 days, so it expired.`
    : `Your consultation request${on} was not answered in 7 days, so it expired.`;
  if (n.kind === 'consult_done') return `${who} marked your consultation${on} done.`;
  if (n.kind === 'consult_thanks') return `${who} left a thank-you on your portfolio.`;
  if (n.kind === 'consult_closed') return n.actor ? `${who} closed a consultation${on}. The contacts are hidden again.` : `A consultation${on} was closed. The contacts are hidden again.`;
  if (n.kind === 'consult_removed') return `An admin closed a consultation${on} after a report.`;
  if (n.kind === 'consult_switched_off') return 'An admin switched your consulting off. Sessions already agreed can still be finished.';
  if (n.kind === 'consult_reported') return 'A consultation request was reported and needs review in Admin.';
  return n.post ? `${who} interacted with your post` : 'Account update';
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
            const href = n.kind === 'flag_threshold' || n.kind === 'made_admin' || n.kind === 'consult_reported' ? '/admin'
              : n.kind === 'consult_thanks' ? `/u/${myHandle}`
              : n.consultation ? `/consultations/${n.consultation.id}`
              : n.kind === 'consult_switched_off' ? '/consultations?tab=offer'
              : n.kind === 'collab_finished' && n.draftId ? `/u/${myHandle}/work/${n.draftId}/edit`
              : n.kind === 'checklist_reminder' ? '/'
              : n.kind === 'handle_changed' && n.newHandle ? `/u/${n.newHandle}`
              : n.post ? `/p/${n.post.rootId ?? n.post.id}#${n.post.id}` : n.event ? `/events/${n.event.id}`
              : n.collab ? `/collabs/${n.collab.id}` : n.kind.startsWith('collab_') ? '/collabs' : null;
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
