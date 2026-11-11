import { sql } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';
import { sendNotification, WebPushError } from 'web-push';

/**
 * Web Push (RFC §6, §12). Notifications rows are the source of truth; the `push` job fans out
 * new rows to each of the user's subscriptions and stamps `pushed_at`. APNs/FCM can be added as
 * more `platform` values without touching the callers.
 */
export interface PushSubscriptionRow { id: string; endpoint: string; keys: { p256dh: string; auth: string } }
export interface PushMessage { title: string; body: string; url: string; tag: string }

export interface PushSender {
  /** VAPID public key for the browser, or null when push is not configured. */
  readonly publicKey: string | null;
  /** 'gone' = the subscription no longer exists (404/410): delete it. */
  send(sub: PushSubscriptionRow, msg: PushMessage): Promise<'ok' | 'gone'>;
}

export class WebPushSender implements PushSender {
  constructor(readonly publicKey: string, private privateKey: string, private subject: string) {}
  async send(sub: PushSubscriptionRow, msg: PushMessage) {
    try {
      await sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(msg), {
        vapidDetails: { subject: this.subject, publicKey: this.publicKey, privateKey: this.privateKey },
        TTL: 24 * 3600,
        urgency: 'normal',
      });
      return 'ok' as const;
    } catch (e) {
      if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) return 'gone' as const;
      throw e;
    }
  }
}

/** Push disabled (no VAPID keys): rows are still stamped so the queue never grows. */
export class NoPushSender implements PushSender {
  readonly publicKey = null;
  async send() { return 'ok' as const; }
}

/** Records sent messages; for tests. */
export class MemoryPushSender implements PushSender {
  readonly sent: { endpoint: string; msg: PushMessage }[] = [];
  readonly gone = new Set<string>();
  constructor(readonly publicKey: string | null = 'test-public-key') {}
  async send(sub: PushSubscriptionRow, msg: PushMessage) {
    if (this.gone.has(sub.endpoint)) return 'gone' as const;
    this.sent.push({ endpoint: sub.endpoint, msg });
    return 'ok' as const;
  }
}

export function loadPushSender(env: Record<string, string | undefined> = process.env): PushSender {
  const pub = env.VAPID_PUBLIC_KEY, priv = env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return new NoPushSender();
  return new WebPushSender(pub, priv, env.VAPID_SUBJECT ?? 'mailto:ops@localhost');
}

type Row = {
  id: string; user_id: string; kind: string; payload: any; stale: boolean;
  actor: string | null; post_snippet: string | null; root_id: string | null; event_title: string | null;
};

/** Text for the push-worthy kinds; null = in-app only (e.g. likes). */
export function describePush(r: Pick<Row, 'kind' | 'payload' | 'actor' | 'post_snippet' | 'root_id' | 'event_title'>): PushMessage | null {
  const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload ?? {});
  const ev = r.event_title ? `"${r.event_title}"` : 'an event';
  // RFC §10.21: one Collab place; events keep their own pages under it
  const eventUrl = p.eventId ? `/collab/event/${p.eventId}` : '/collab';
  const collab = p.title ? `"${p.title}"` : 'a collab';
  const collabUrl = p.collabId ? `/collab/${p.collabId}` : '/collab';
  const collabOrEventUrl = p.collabId ? collabUrl : eventUrl;
  const consultUrl = p.consultationId ? `/consultations/${p.consultationId}` : '/consultations';
  const m = (title: string, body: string, url: string): PushMessage => ({ title, body, url, tag: `${r.kind}:${p.postId ?? p.eventId ?? p.collabId ?? p.consultationId ?? ''}` });
  switch (r.kind) {
    case 'reply': return m(`@${r.actor ?? 'someone'} replied`, r.post_snippet ?? '', p.postId ? `/p/${r.root_id ?? p.postId}#${p.postId}` : '/notifications');
    // RFC §10.16: someone wrote your @handle in a post
    case 'mention': return m(`@${r.actor ?? 'someone'} mentioned you`, r.post_snippet ?? '', p.postId ? `/p/${r.root_id ?? p.postId}#${p.postId}` : '/notifications');
    case 'invitee_first_post': return m(`@${r.actor ?? 'someone'} posted for the first time`, r.post_snippet ? `${r.post_snippet} Say hello?` : 'Say hello?', p.postId ? `/p/${p.postId}` : '/notifications');
    // RFC §10.13: someone is guessing your PIN, or an admin made you a reset code
    case 'pin_locked': return m('Someone tried your PIN', 'Five wrong PINs in a row, so your account is resting for a while. If it was not you, change your PIN.', '/settings#pin');
    case 'pin_blocked': return m('Your PIN is locked for today', 'Too many wrong PINs. Use your recovery code, or ask an admin for a reset code.', '/settings#pin');
    case 'pin_reset_code': return m('An admin made you a PIN reset code', 'If you did not ask for one, tell another admin.', '/notifications');
    case 'activated': return m('You have a seat', 'Welcome in.', '/');
    case 'seat_offered': return m('A seat is being held for you', 'You have 72 hours to take it.', '/');
    case 'seat_offer_expired': return m('Your seat offer expired', 'You can rejoin the queue.', '/');
    case 'lurker_warning': return m('Your seat is at risk', 'Post or reply twice in the next 7 days to keep it.', '/');
    case 'reinstated': return m('Welcome back', 'Your seat is yours again.', '/');
    case 'payment_refunded': return m('Payment refunded', 'The seat was no longer being held for you.', '/');
    case 'event_promoted': return m('A spot opened up', `You are now going to ${ev}.`, eventUrl);
    case 'event_updated': return m('Event changed', `The time or place of ${ev} changed.`, eventUrl);
    case 'event_cancelled': return m('Event cancelled', `${ev} was cancelled.`, eventUrl);
    case 'checklist_reminder': return m('Finish your profile', `${p.done ?? 0} of ${p.total ?? 5} done. A few minutes makes this place yours.`, '/');
    case 'pick_remark': return m(`@${r.actor ?? 'someone'} tried your pick`, p.title ? `A remark on "${p.title}".` : 'They left a remark.', '/');
    // RFC §10.4: an admin took a pick out of the rotation
    case 'pick_removed': return m('An admin removed your pick', p.title ? `"${p.title}" is no longer in the rotation.` : 'It is no longer in the rotation.', '/');
    case 'collab_request': return m(`@${r.actor ?? 'someone'} wants to join`, collab, collabUrl);
    case 'collab_joined': return m(`@${r.actor ?? 'someone'} joined`, collab, collabUrl);
    case 'collab_accepted': return m('You are on the team', collab, collabUrl);
    case 'collab_declined': return m('Not this time', `${collab} has found its people. Plenty more to find.`, '/collab');
    case 'collab_update': return m(`@${r.actor ?? 'someone'} posted an update`, r.post_snippet ? `In ${collab}: ${r.post_snippet}` : collab, p.postId ? `/p/${p.postId}` : collabUrl);
    case 'collab_meetup': return m('A meetup is planned', `For ${collab}: ${ev}`, eventUrl);
    case 'collab_finished': return m('Finished. Well done.', `A draft project for ${collab} is waiting in your portfolio.`, collabUrl);
    // RFC §10.21: nothing waits forever
    case 'requests_waiting': return m(`${p.count ?? 1} waiting on you`, `To join ${collab}.`, collabOrEventUrl);
    case 'request_expired': return m('Your request was not answered in time', `${collab} waited a week. Nothing was decided either way.`, collabOrEventUrl);
    case 'collab_quiet': return m(
      p.kind === 'activity' ? 'Six quiet weeks' : 'Three quiet weeks',
      p.kind === 'activity' ? `Keep ${collab} running, or end it?` : `Finish ${collab}, keep going, or close it?`,
      collabUrl);
    case 'event_update': return m(`@${r.actor ?? 'someone'} posted an update`, `On ${ev}.`, eventUrl);
    case 'event_request': return m(`@${r.actor ?? 'someone'} asked to come`, ev, eventUrl);
    case 'event_accepted': return m('You are in', `You are on the list for ${ev}.`, eventUrl);
    case 'event_declined': return m('Not this time', `${ev} is full of people already. Plenty more in Collab.`, '/collab');
    // RFC §10.21: an admin wiped the event
    case 'event_removed': return m('An admin removed your event', p.title ? `"${p.title}" is gone.` : 'It is gone.', '/collab');
    case 'event_invite': return m(`@${r.actor ?? 'someone'} invited you`, `Come to ${ev}?`, eventUrl);
    case 'collab_invite': return m(`@${r.actor ?? 'someone'} invited you`, `Join ${collab}?`, collabUrl);
    // RFC §10.6: consultations. Never a contact in a push, only that something changed.
    case 'consult_request': return m(`@${r.actor ?? 'someone'} asked for a consultation`, p.topic ? `On ${p.topic}.` : 'Open it to answer.', consultUrl);
    case 'consult_accepted': return m(`@${r.actor ?? 'someone'} accepted`, p.pricing === 'paid' ? 'They set a price. Agree to it to swap contacts.' : 'Free. Your contacts are swapped.', consultUrl);
    case 'consult_declined': return m('Not this time', p.topic ? `Your request on ${p.topic} was declined.` : 'Your request was declined.', consultUrl);
    case 'consult_agreed': return m(`@${r.actor ?? 'someone'} agreed to the price`, 'Your contacts are swapped.', consultUrl);
    case 'consult_expired': return m('A consultation request expired', 'Nobody answered in 7 days.', consultUrl);
    case 'consult_done': return m('Session marked done', p.topic ? `On ${p.topic}.` : 'Thanks for taking part.', consultUrl);
    case 'consult_thanks': return m(`@${r.actor ?? 'someone'} said thanks`, 'A thank-you is on your portfolio.', consultUrl);
    case 'consult_closed': return m('A consultation was closed', 'The contacts are hidden again.', consultUrl);
    // RFC §10.18: consulting needs the badge, then an admin's yes
    case 'consult_asked': return m(`@${r.actor ?? 'someone'} wants to offer consulting`, 'Their offer is waiting for your approval.', '/admin');
    case 'consult_approved': return m('Your consulting is approved', 'Switch your offer on, or it stays as you left it.', '/consultations?tab=offer');
    case 'consult_not_approved': return m('Consulting not approved', 'An admin has not approved your consulting.', '/consultations?tab=offer');
    case 'verified': return m('You are verified', 'The badge now shows by your name.', '/settings');
    default: return null;
  }
}

const BATCH = 200;
/** Older than this when first seen by the job → never pushed (e.g. after downtime). */
const STALE = '1 hour';

/** One fan-out pass. Safe to run concurrently (skip locked). Returns counts. */
export async function fanOutPush(db: Db, sender: PushSender) {
  let sent = 0, skipped = 0, removed = 0, failed = 0;
  const queue = await rows<Row>(db, sql`
    select n.id, n.user_id, n.kind, n.payload, (n.created_at < now() - ${STALE}::interval) as stale,
           a.handle as actor, left(p.body, 120) as post_snippet, p.root_id, e.title as event_title
      from notifications n
      left join users a on a.id = case when n.payload->>'actorId' ~ '^[0-9a-f-]{36}$' then (n.payload->>'actorId')::uuid end
      left join posts p on p.id = case when n.payload->>'postId' ~ '^[0-9a-f-]{36}$' then (n.payload->>'postId')::uuid end
      left join events e on e.id = case when n.payload->>'eventId' ~ '^[0-9a-f-]{36}$' then (n.payload->>'eventId')::uuid end
     where n.pushed_at is null
     order by n.created_at
     limit ${BATCH}
     for update of n skip locked`);
  for (const r of queue) {
    const msg = r.stale ? null : describePush(r);
    if (msg && sender.publicKey) {
      const subs = await rows<PushSubscriptionRow>(db, sql`
        select id, endpoint, keys from push_subscriptions where user_id = ${r.user_id}::uuid and platform = 'webpush'`);
      for (const s of subs) {
        try {
          if ((await sender.send(s, msg)) === 'gone') {
            await db.execute(sql`delete from push_subscriptions where id = ${s.id}::uuid`);
            removed++;
          } else sent++;
        } catch (e) {
          failed++; // one bad endpoint must not block the rest; the in-app notification still exists
          console.error('push failed', s.endpoint.slice(0, 60), e instanceof Error ? e.message : e);
        }
      }
    } else skipped++;
    await db.execute(sql`update notifications set pushed_at = now() where id = ${r.id}::uuid`);
  }
  return { sent, skipped, removed, failed };
}
