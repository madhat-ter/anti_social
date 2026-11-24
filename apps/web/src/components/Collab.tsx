'use client';
/**
 * RFC §10.21: One Collab. Events, activities and projects share one card, one label shape and one
 * join button whose words follow the rules. An activity keeps going, a project has a team and a
 * finish, an event happens once.
 */
import Link from 'next/link';
import type { CollabPageItem } from '@/lib/api';
import { cardMeta, collabHref, KIND_LABEL } from '@/lib/collab';
export { cardMeta, collabHref, collabJoinable, collabStatusLabel, eventJoinable, joinLabel, KIND_LABEL } from '@/lib/collab';
export type { Joinable, JoinMode } from '@/lib/collab';
import { InterestTags } from './Interests';
import { NameMarks } from './Marks';
import { bnLang } from '@/lib/lang';

/** A small label saying what kind it is. */
export function KindTag({ kind }: { kind: 'event' | 'activity' | 'project' }) {
  return <span className={`tag kind kind-${kind}`}>{KIND_LABEL[kind]}</span>;
}

/** One card for all three kinds, used on the Collab page, Yours, the profile tab and For you. */
export function CollabItemCard({ item }: { item: CollabPageItem }) {
  const href = collabHref(item.type === 'event' ? 'event' : item.kind, item.id);
  const title = item.title;
  const cover = item.type === 'event' ? null : item.cover;
  const host = item.host;
  const interests = item.interests ?? [];
  const start = item.type === 'event' ? new Date(item.startsAt) : null;
  return (
    <li className={`collab-card kind-${item.type === 'event' ? 'event' : item.kind}`}>
      <Link href={href} className="collab-link">
        {start
          // an event shows its date: the month, the day big on the red dot (the owner's call, 2026-11-11)
          ? <span className="date-chip collab-date" aria-hidden>
              <span className="m">{start.toLocaleDateString(undefined, { month: 'short' })}</span>
              <span className="d">{start.getDate()}</span>
            </span>
          : cover
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
