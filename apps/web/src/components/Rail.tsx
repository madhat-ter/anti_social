'use client';
/**
 * Desktop side windows (shown only on wide screens, see .shell in globals.css): the next few
 * events, the room's seats, and today's birthdays. Each is small, glanceable, and links on.
 * (No "you" window since 2026-11-09: your profile is in the menu; inviting is in Settings.)
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RULES } from '@anti/shared';
import { api, type AnEvent, type Me, type MemberSummary } from '@/lib/api';
import { membersCached, seatCapCached } from '@/lib/members';
import { BirthdaysWindow } from './Birthday';
import { Win } from './retro';
import { VisitorWindow } from './Visitor';
import { bnLang } from '@/lib/lang';

function Seats({ me }: { me: Me }) {
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [seatCap, setSeatCap] = useState<number>(RULES.seat_cap);
  useEffect(() => { membersCached().then(setMembers, () => setMembers(null)); }, []);
  useEffect(() => { seatCapCached().then(setSeatCap); }, []);
  const cap = Math.max(seatCap, members?.length ?? 0);
  return (
    <Win title="seats" as="section" bodyClassName="stack rail-seats">
      <div className="seat-chart small" role="img" aria-label={members ? `${members.length} of ${cap} seats taken` : 'Seats'}>
        {Array.from({ length: cap }, (_, i) => {
          const m = members?.[i];
          return <span key={i} className={!m ? 'open' : m.handle === me.handle ? 'taken me' : 'taken'} />;
        })}
      </div>
      <p className="ui">
        {members ? <><strong>{members.length}</strong> of {cap} taken</> : 'Counting…'}
        {' '}<Link href="/members">See who</Link>
      </p>
    </Win>
  );
}

function NextEvents() {
  const [events, setEvents] = useState<AnEvent[] | null>(null);
  useEffect(() => { api.events('upcoming', null, 3).then((p) => setEvents(p.items), () => setEvents([])); }, []);
  return (
    <Win title="next_events" as="section" bodyClassName="stack">
      {events === null ? <p className="ui muted">Loading…</p> : events.length === 0 ? (
        <p className="muted small">Nothing planned. <Link href="/events/new">Host something</Link>.</p>
      ) : (
        <ul className="rail-events">
          {events.map((e) => {
            const d = new Date(e.startsAt);
            return (
              <li key={e.id}>
                <Link href={`/events/${e.id}`}>
                  <span className="rail-date"><span className="d">{d.getDate()}</span><span className="m">{d.toLocaleDateString(undefined, { month: 'short' })}</span></span>
                  <span className="rail-ev-title" {...bnLang(e.title)}>{e.title}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Link className="ui" href="/events">All events</Link>
    </Win>
  );
}

export function Rail({ me }: { me: Me }) {
  return (
    // the owner dropped the "you" window (2026-11-09): the next events take the top; your profile is in the menu.
    // A visitor still gets their window first: it has the time left and the way out.
    <aside className="rail" aria-label="At a glance">
      {me.visitor && <VisitorWindow expiresAt={me.visitor.expiresAt} />}
      <NextEvents />
      <Seats me={me} />
      <BirthdaysWindow />
    </aside>
  );
}
