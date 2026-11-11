'use client';
/**
 * RFC §10.21: One Collab. Events, activities and projects share one card, one label shape and one
 * join button whose words follow the rules. An activity keeps going, a project has a team and a
 * finish, an event happens once.
 */
import Link from 'next/link';
import type { AnEvent, CollabPageItem, CollabRole, CollabSummary, RsvpStatus } from '@/lib/api';
import { InterestTags } from './Interests';
import { NameMarks } from './Marks';
import { eventTime } from './Events';
import { bnLang } from '@/lib/lang';

export const KIND_LABEL: Record<'event' | 'activity' | 'project', string> = {
  event: 'event', activity: 'activity', project: 'project',
};

/** Where each kind lives. Events have their own page inside the section. */
export const collabHref = (t: 'event' | 'activity' | 'project', id: string) => (t === 'event' ? `/collab/event/${id}` : `/collab/${id}`);

/** A small label saying what kind it is. */
export function KindTag({ kind }: { kind: 'event' | 'activity' | 'project' }) {
  return <span className={`tag kind kind-${kind}`}>{KIND_LABEL[kind]}</span>;
}

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

/** One card for all three kinds, used on the Collab page, Yours, the profile tab and For you. */
export function CollabItemCard({ item }: { item: CollabPageItem }) {
  const href = collabHref(item.type === 'event' ? 'event' : item.kind, item.id);
  const title = item.title;
  const cover = item.type === 'event' ? null : item.cover;
  const host = item.host;
  const interests = item.interests ?? [];
  return (
    <li className={`collab-card kind-${item.type === 'event' ? 'event' : item.kind}`}>
      <Link href={href} className="collab-link">
        {cover
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="collab-cover" src={cover.url} alt="" width={cover.width} height={cover.height} loading="lazy" />
          : <span className="collab-cover blank" aria-hidden>{title.slice(0, 1).toUpperCase()}</span>}
        <span className="collab-main">
          <span className="collab-title" {...bnLang(title)}>
            <KindTag kind={item.type === 'event' ? 'event' : item.kind} /> {title}
            {item.type === 'event' && item.audience === 'team' && <span className="tag">team only</span>}
            {item.type === 'event' && item.cancelledAt && <span className="tag danger">cancelled</span>}
          </span>
          <span className="meta">{cardMeta(item)}</span>
          <InterestTags slugs={interests} />
          {host && (
            <span className="meta">
              by @{host.handle}<NameMarks admin={host.admin} verified={host.verified} size=".9em" />
            </span>
          )}
        </span>
      </Link>
    </li>
  );
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
