/**
 * What each notification says and where it leads. One source for the website's bell page and the
 * phone app (RFC §10.32), so a notice reads the same everywhere.
 */
import type { Notification } from './api';

/** System notices that need action get the warning triangle; good news gets the red dot. */
export const WARNINGS = new Set(['pin_locked', 'pin_blocked', 'pin_reset_code', 'lurker_warning', 'seat_offer_expired', 'payment_refunded', 'event_cancelled', 'post_removed', 'project_removed', 'file_card_removed', 'consult_removed', 'consult_switched_off', 'consult_not_approved']);

/** RFC §10.33: "a week", then "2 weeks", "3 weeks"… (the same words as the push, api/src/lib/push.ts) */
export const quietSpan = (days: number | null | undefined) => {
  const d = Number(days) || 7;
  return d < 14 ? 'a week' : `${Math.floor(d / 7)} weeks`;
};
/** "28 December" */
const dayMonth = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** RFC §10.33: the note about someone gone quiet carries a "Say hi" button (the whole note opens the post box) */
export const sayHiTo = (n: Notification): string | null => (n.kind === 'gone_quiet' && n.actor ? n.actor.handle : null);

export function describe(n: Notification): string {
  const who = n.actor ? `@${n.actor.handle}` : 'Someone';
  if (n.kind === 'reply') return `${who} replied to your post`;
  if (n.kind === 'mention') return `${who} mentioned you`;
  if (n.kind === 'like') return `${who} liked your post`;
  if (n.kind === 'pin_locked') return 'Someone typed five wrong PINs for your account, so it rested for a while. If it was not you, change your PIN in Settings.';
  if (n.kind === 'pin_blocked') return 'Too many wrong PINs today: signing in with a PIN is off until you use your recovery code or an admin’s reset code.';
  if (n.kind === 'pin_reset_code' && !n.actor) return 'A one-hour PIN reset code was made for you from the ops console. If you did not ask for it, tell an admin.';
  if (n.kind === 'pin_reset_code') return `${who} (an admin) made you a one-hour PIN reset code. If you did not ask for it, tell another admin.`;
  if (n.kind === 'invitee_first_post') return `${who}, whom you invited, wrote their first post. Say hello?`;
  // RFC §10.24: the File
  if (n.kind === 'file_card_received') return `${n.guestName ? `${n.guestName} (not a member)` : who} made a card for your File${n.cardTitle ? `: "${n.cardTitle}"` : ''}. It is waiting for your yes.`;
  if (n.kind === 'file_card_removed') return n.cardTitle ? `An admin removed a card you made: "${n.cardTitle}".` : 'An admin removed a card you made.';
  if (n.kind === 'file_card_placed') return `${who} put your card${n.cardTitle ? ` "${n.cardTitle}"` : ''} in their File.`;
  // RFC 10.25: someone outside asked for a seat from the landing page (admins only)
  if (n.kind === 'seat_request') return `${n.guestName ?? 'Someone'} asked for a seat. Their request is waiting in Admin.`;
  if (n.kind === 'activated') return 'You have a seat. Welcome in.';
  if (n.kind === 'seat_offered') return 'A seat opened up for you. Reinstate within 72 hours to keep it.';
  if (n.kind === 'seat_offer_expired') return 'Your seat offer expired. You can rejoin the queue.';
  if (n.kind === 'lurker_warning') return 'You have been quiet for a while. Post or reply twice in 7 days to keep your seat.';
  // RFC §10.33: someone you talk with has been away; and, for you, the week before the 30-day rule
  if (n.kind === 'gone_quiet') return `${who} hasn’t been around for ${quietSpan(n.quietDays)}. A hello might be nice.`;
  if (n.kind === 'seat_kept') return `Your seat is kept for you${n.keptUntil ? ` until ${dayMonth(n.keptUntil)}` : ''}. Come back any time.`;
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
  if (n.kind === 'pick_removed') return n.pickTitle ? `An admin removed your pick "${n.pickTitle}".` : 'An admin removed one of your picks.';
  if (n.kind === 'handle_changed') return n.newHandle ? `An admin changed your handle to @${n.newHandle}. Your profile link changed with it.` : 'An admin changed your handle.';
  if (n.kind === 'verified') return 'You are verified. The badge now shows by your name.';
  if (n.kind === 'unbanned') return 'An admin lifted your ban. Welcome back.';
  if (n.kind === 'made_admin') return 'You are now an admin. Your tools are under Admin in the menu.';
  if (n.kind === 'admin_removed') return 'You are no longer an admin.';
  if (n.kind === 'flag_threshold') return 'Something was hidden after 5 reports and needs review in Admin.';
  const co = n.collab ? `"${n.collab.title}"` : 'a collab';
  if (n.kind === 'collab_request') return `${who} asked to join ${co}`;
  if (n.kind === 'collab_joined') return `${who} joined ${co}`;
  if (n.kind === 'collab_accepted') return `You are on the team for ${co}. Say hello.`;
  if (n.kind === 'collab_declined') return `${co} has found its people this time. There are plenty more in Collab.`;
  if (n.kind === 'collab_update') return `${who} posted an update in ${co}`;
  if (n.kind === 'collab_meetup') return `${who} planned a meetup for ${co}${n.event ? `: "${n.event.title}"` : ''}`;
  if (n.kind === 'collab_finished') return `${co} is finished. Well done. A draft project is waiting in your portfolio: edit it and publish, or delete it.`;
  if (n.kind === 'event_update') return `${who} posted an update on ${ev}`;
  if (n.kind === 'collab_removed') return n.collabTitle ? `An admin removed your collab "${n.collabTitle}".` : 'An admin removed one of your collabs.';
  if (n.kind === 'event_request') return `${who} asked to come to ${ev}`;
  if (n.kind === 'event_accepted') return `You are in: the host accepted you for ${ev}`;
  if (n.kind === 'event_declined') return `${ev} is full of people already. There are plenty more in Collab.`;
  if (n.kind === 'event_invite') return `${who} invited you to ${ev}`;
  if (n.kind === 'collab_invite') return `${who} invited you to join ${co}`;
  // RFC §10.21: an admin can wipe any event
  if (n.kind === 'event_removed') return n.eventTitle ? `An admin removed your event "${n.eventTitle}".` : 'An admin removed your event.';
  // RFC §10.21: nothing waits forever
  const thing = n.collab ? `"${n.collab.title}"` : n.event ? `"${n.event.title}"` : 'it';
  if (n.kind === 'requests_waiting') return `${n.count ?? 1} ${(n.count ?? 1) === 1 ? 'person is' : 'people are'} waiting to join ${thing}`;
  if (n.kind === 'request_expired') return `Your request to join ${thing} wasn't answered in time. Nothing was decided either way.`;
  if (n.kind === 'collab_quiet') return `${thing} has gone quiet. Keep it going, or bring it to a close?`;
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
  if (n.kind === 'consult_asked') return `${who} switched their consulting offer on and is waiting for you to approve it.`;
  if (n.kind === 'consult_approved') return 'An admin approved your consulting. Switch the offer on when you are ready.';
  if (n.kind === 'consult_not_approved') return 'An admin has not approved your consulting. Ask them directly if you want to talk about it.';
  return n.post ? `${who} interacted with your post` : 'Account update';
}

/** The website address a notification opens, or null when it leads nowhere. */
export function notificationHref(n: Notification, myHandle: string): string | null {
  return n.kind === 'gone_quiet' ? (n.actor ? `/?say=${encodeURIComponent(n.actor.handle)}#compose` : null)
    : n.kind === 'seat_kept' ? '/'
    : n.kind === 'seat_request' ? '/admin#seat-requests'
    : n.kind === 'flag_threshold' || n.kind === 'made_admin' || n.kind === 'consult_reported' || n.kind === 'consult_asked' ? '/admin'
    : n.kind === 'consult_thanks' ? `/u/${myHandle}`
    : n.consultation ? `/consultations/${n.consultation.id}`
    : n.kind === 'consult_switched_off' || n.kind === 'consult_approved' || n.kind === 'consult_not_approved' ? '/consultations?tab=offer'
    : n.kind === 'collab_finished' && n.draftId ? `/u/${myHandle}/work/${n.draftId}/edit`
    : n.kind === 'checklist_reminder' ? '/'
    : n.kind === 'file_card_received' || n.kind === 'file_card_removed' ? '/file'
    : n.kind === 'file_card_placed' ? (n.actor ? `/file/${n.actor.handle}` : '/file')
    : n.kind.startsWith('pin_') ? '/settings#pin'
    : n.kind === 'verified' ? '/settings#contact'
    : n.kind === 'handle_changed' && n.newHandle ? `/u/${n.newHandle}`
    : n.post ? `/p/${n.post.rootId ?? n.post.id}#${n.post.id}` : n.event ? `/collab/event/${n.event.id}`
    : n.collab ? `/collab/${n.collab.id}` : n.kind.startsWith('collab_') || n.kind === 'requests_waiting' || n.kind === 'event_removed' ? '/collab' : null;
}
