/**
 * RFC §10.21, One Collab: the words on its cards and its one join button, and an event's time.
 * Plain functions, shared by the website and the phone app (RFC §10.32) so both say the same.
 */
import type { AnEvent, CollabPageItem, CollabRole, CollabSummary, RsvpStatus } from './api';

/** "Sat, Nov 14 · 10:00 AM – 12:00 PM" in the viewer's time zone. */
export function eventWhen(startsAt: string, endsAt: string | null): string {
  const s = new Date(startsAt);
  const day = s.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (!endsAt) return `${day}, ${t(s)}`;
  const e = new Date(endsAt);
  const sameDay = e.toDateString() === s.toDateString();
  return sameDay ? `${day}, ${t(s)} – ${t(e)}` : `${day}, ${t(s)} – ${e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${t(e)}`;
}

/** On a card the date chip already says the day, so this is the weekday and the time: "Friday, 7:00 PM" or "Friday, 7:00 – 9:00 PM". */
export function eventTime(startsAt: string, endsAt: string | null): string {
  const s = new Date(startsAt);
  const wd = s.toLocaleDateString(undefined, { weekday: 'long' });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (!endsAt) return `${wd}, ${t(s)}`;
  const e = new Date(endsAt);
  return e.toDateString() === s.toDateString() ? `${wd}, ${t(s)} – ${t(e)}` : `${wd}, ${t(s)} – ${e.toLocaleDateString(undefined, { weekday: 'short' })} ${t(e)}`;
}

/** Who is coming. A zero is an invitation, not a count. */
export function spotsText(e: AnEvent): string {
  if (e.started) {
    if (e.attendedCount > 0) return `${e.attendedCount} attended`;
    return e.goingCount > 0 ? `${e.goingCount} going` : 'Nobody signed up';
  }
  if (e.capacity === null) return e.goingCount > 0 ? `${e.goingCount} going` : 'Be the first to go';
  const left = Math.max(e.capacity - e.goingCount, 0);
  if (left === 0) return `Full, ${e.waitlistCount} on the waitlist`;
  return e.goingCount > 0 ? `${e.goingCount} going, ${left} of ${e.capacity} spots left` : `${e.capacity} spots, be the first`;
}

export const KIND_LABEL: Record<'event' | 'activity' | 'project', string> = {
  event: 'event', activity: 'activity', project: 'project',
};

/** Where each kind lives. Events have their own page inside the section. */
export const collabHref = (t: 'event' | 'activity' | 'project', id: string) => (t === 'event' ? `/collab/event/${id}` : `/collab/${id}`);

/** The words for a collab's state: an activity runs or has ended; a project recruits, sets, finishes. */
export function collabStatusLabel(c: Pick<CollabSummary, 'kind' | 'status'>): string {
  if (c.status === 'finished') return c.kind === 'activity' ? 'ended' : 'finished';
  if (c.kind === 'activity') return 'running';
  return c.status === 'closed' ? 'team set' : 'recruiting';
}

/** The second line on a card, by kind (RFC §10.21 "Cards"). */
export function cardMeta(item: CollabPageItem): string {
  if (item.type === 'event') {
    const spots = (() => {
      if (item.capacity === null) return item.goingCount > 0 ? `${item.goingCount} going` : 'Be the first to go';
      const left = Math.max(item.capacity - item.goingCount, 0);
      return left === 0 ? 'Full · join the waitlist' : `${left} ${left === 1 ? 'spot' : 'spots'} left`;
    })();
    return `${eventTime(item.startsAt, item.endsAt)} · ${spots}`;
  }
  if (item.kind === 'activity') {
    if (item.status === 'finished') return `${item.meets} · ended`;
    return `${item.meets} · ${item.teamCount} in`;
  }
  const open = item.roles.length ? `Looking for ${item.roles.join(', ')}` : 'A team';
  if (item.status === 'finished') return `${open} · finished`;
  if (item.status === 'closed' || (item.teamMax !== null && item.teamCount >= item.teamMax)) {
    return `${open} · team set${item.teamMax !== null ? ` · ${item.teamCount} of ${item.teamMax}` : ''}`;
  }
  return `${open} · ${item.teamCount}${item.teamMax !== null ? ` of ${item.teamMax}` : ''}`;
}

// ─── The one join button ────────────────────────────────────────────────────

export type JoinMode = 'join' | 'ask' | 'waitlist' | 'in' | 'asked' | 'full' | 'host' | 'ended' | 'declined';

export type Joinable = {
  kind: 'event' | 'activity' | 'project';
  /** collabs */
  myRole?: CollabRole | null;
  /** events */
  myStatus?: RsvpStatus | null;
  request?: 'pending' | 'declined' | null;
  invited?: boolean;
  joinMode: 'open' | 'approve';
  /** at capacity, team set, or every role taken */
  full?: boolean;
  /** an event that has started, an activity that ended, a finished project */
  over?: boolean;
  isHost?: boolean;
};

/** The words on the button, by kind and situation (RFC §10.21 "The join button"). */
export function joinLabel(j: Joinable): { text: string; mode: JoinMode; leave?: string } {
  if (j.isHost) return { text: 'hosting', mode: 'host' };
  if (j.kind === 'event') {
    if (j.myStatus === 'going') return { text: "You're in ✓", mode: 'in', leave: "Can't make it" };
    if (j.myStatus === 'waitlisted') return { text: 'On the waitlist ✓', mode: 'in', leave: 'Leave the waitlist' };
    if (j.request === 'pending') return { text: 'Asked ✓', mode: 'asked' };
    if (j.request === 'declined') return { text: 'Not this time', mode: 'declined' };
    if (j.over) return { text: 'Over', mode: 'ended' };
    if (j.joinMode === 'approve' && !j.invited) return { text: 'Ask to come', mode: 'ask' };
    return j.full ? { text: 'Join the waitlist', mode: 'waitlist' } : { text: "I'm going", mode: 'join' };
  }
  if (j.myRole) return { text: "You're in ✓", mode: 'in', leave: 'Leave' };
  if (j.request === 'pending') return { text: 'Asked ✓', mode: 'asked' };
  if (j.request === 'declined') return { text: 'Not this time', mode: 'declined' };
  if (j.over) return { text: j.kind === 'activity' ? 'Ended' : 'Finished', mode: 'ended' };
  if (j.kind === 'project' && j.full) return { text: 'Team set', mode: 'full' };
  if (j.kind === 'activity' && j.full) return { text: 'Full', mode: 'full' };
  if (j.full) return { text: 'Team set', mode: 'full' };
  if (j.joinMode === 'approve' && !j.invited) return { text: j.kind === 'activity' ? 'Ask to join' : 'Ask to join', mode: 'ask' };
  return { text: 'Join', mode: 'join' };
}

/** The join state of an event row. */
export const eventJoinable = (e: AnEvent): Joinable => ({
  kind: 'event', myStatus: e.my?.status ?? null, request: e.request, invited: e.invited, joinMode: e.joinMode,
  full: e.capacity !== null && e.goingCount >= e.capacity, over: !e.rsvpOpen && !e.cancelledAt, isHost: e.isHost,
});

/** The join state of a collab row. */
export const collabJoinable = (c: CollabSummary): Joinable => ({
  kind: c.kind, myRole: c.my.role, request: c.my.request, invited: c.my.invited, joinMode: c.joinMode,
  full: (c.teamMax !== null && c.teamCount >= c.teamMax) || (c.roles.length > 0 && c.status === 'closed'),
  over: c.status === 'finished',
});
