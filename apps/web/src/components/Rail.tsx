'use client';
/**
 * Desktop side windows (shown only on wide screens, see .shell in globals.css): the next few
 * events, the pick, Pet Corner, and today's birthdays. Each is small, glanceable, and links on.
 * (No "you" window since 2026-11-09: your profile is in the menu; inviting is in Settings.)
 * (Seats became Pet Corner, RFC §10.17; the seat chart lives on Members and Admin.)
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, type AnEvent, type Me } from '@/lib/api';
import { BirthdaysWindow } from './Birthday';
import { Win } from './retro';
import { VisitorWindow } from './Visitor';
import { PickWindow, RAIL_QUERY, useWide } from './Picks';
import { PetCorner } from './Pets';
import { bnLang } from '@/lib/lang';

function ComingUp() {
  const [events, setEvents] = useState<AnEvent[] | null>(null);
  useEffect(() => { api.events('upcoming', null, 3).then((p) => setEvents(p.items), () => setEvents([])); }, []);
  return (
    <Win title="coming_up" as="section" bodyClassName="stack">
      {events === null ? <p className="ui muted">Loading…</p> : events.length === 0 ? (
        <p className="muted small">Nothing coming up. <Link href="/collab/new?kind=event">Start something</Link>.</p>
      ) : (
        <ul className="rail-events">
          {events.map((e) => {
            const d = new Date(e.startsAt);
            return (
              <li key={e.id}>
                <Link href={`/collab/event/${e.id}`}>
                  <span className="rail-date"><span className="d">{d.getDate()}</span><span className="m">{d.toLocaleDateString(undefined, { month: 'short' })}</span></span>
                  <span className="rail-ev-title" {...bnLang(e.title)}>{e.title}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Link className="ui" href="/collab?kind=event">All events</Link>
    </Win>
  );
}

export function Rail({ me }: { me: Me }) {
  const path = usePathname() ?? '/';
  // the rail is on screen from 1180px (globals.css); below that the pick window sits in the feed
  const shown = useWide(RAIL_QUERY);
  return (
    // the owner dropped the "you" window (2026-11-09): the next events take the top; your profile is in the menu.
    // A visitor still gets their window first: it has the time left and the way out.
    // The pick window moved here from under the menu (2026-11-09) so the menu column never scrolls.
    // A window that repeats the page you are on (events on Events, seats on Members) stays away.
    <aside className="rail" aria-label="At a glance">
      {me.visitor && <VisitorWindow expiresAt={me.visitor.expiresAt} />}
      {/* Pet Corner opens the rail, except while you are already inside it (/pets or a pet's page) */}
      {!path.startsWith('/pets') && !path.startsWith('/pet/') && <PetCorner me={me} />}
      {/* RFC §10.21: one window, "coming up", and it stays away from its own page */}
      {!path.startsWith('/collab') && <ComingUp />}
      {shown && <PickWindow />}
      {path !== '/members' && <BirthdaysWindow />}
    </aside>
  );
}
