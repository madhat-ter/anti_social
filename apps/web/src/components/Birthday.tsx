'use client';
/**
 * Birthdays (RFC §10.3): on someone's day, on each viewer's own date, a "birthday today" tag by
 * their name, a small window in the desktop side panel and one line above the feed on phones.
 * Only month and day ever reach the browser, and only for people who show it; never the year.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { isBirthdayOn, localToday } from '@anti/shared';
import type { Birthday, MemberSummary } from '@/lib/api';
import { membersCached } from '@/lib/members';
import { Avatar } from './Avatar';
import { Win } from './retro';

export const isToday = (b: Birthday | null | undefined) => !!b && isBirthdayOn(b, localToday());

export function BirthdayTag({ b }: { b: Birthday | null | undefined }) {
  if (!isToday(b)) return null;
  return <span className="tag bday" title="It is their birthday today">birthday today</span>;
}

/** Members whose birthday it is today, where this viewer is. */
function useBirthdaysToday(): MemberSummary[] | null {
  const [list, setList] = useState<MemberSummary[] | null>(null);
  useEffect(() => {
    membersCached().then((all) => setList(all.filter((m) => isToday(m.birthday))), () => setList([]));
  }, []);
  return list;
}

/** Desktop side panel; nothing at all on days without a birthday. */
export function BirthdaysWindow() {
  const list = useBirthdaysToday();
  if (!list || list.length === 0) return null;
  return (
    <Win title="birthdays" as="section" bodyClassName="stack">
      <p className="ui">Today is the birthday of</p>
      <ul className="rail-bdays">
        {list.map((m) => (
          <li key={m.handle}>
            <Link href={`/u/${m.handle}`}>
              <Avatar seed={m.handle} gender={m.gender} size={32} />
              <span>{m.displayName}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Win>
  );
}

/** Phones (no side panel): one line above the feed. */
export function BirthdayLine() {
  const list = useBirthdaysToday();
  if (!list || list.length === 0) return null;
  return (
    <p className="banner bday-line" role="status">
      <strong>Birthday today:</strong>{' '}
      {list.map((m, i) => (
        <span key={m.handle}>{i > 0 && ', '}<Link href={`/u/${m.handle}`}>{m.displayName}</Link></span>
      ))}
    </p>
  );
}
