'use client';
/**
 * Desktop side windows (shown only on wide screens, see .shell in globals.css):
 * you, the room's seats, and the next few events. Each is small, glanceable, and links on.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RULES } from '@anti/shared';
import { api, type AnEvent, type Me, type MemberSummary } from '@/lib/api';
import { membersCached, seatCapCached } from '@/lib/members';
import { Avatar } from './Avatar';
import { BirthdaysWindow } from './Birthday';
import { NameMarks } from './Marks';
import { Win } from './retro';
import { VisitorWindow } from './Visitor';

function You({ me }: { me: Me }) {
  return (
    <Win title="you" as="section" bodyClassName="rail-you">
      <Link href={`/u/${me.handle}`} className="rail-you-link">
        <Avatar seed={me.handle} gender={me.gender} size={56} />
        <span>
          <span className="rail-name">{me.displayName}<NameMarks admin={me.role === 'ops'} verified={!!me.verifiedAt} size=".85em" /></span>
          <span className="ui muted">@{me.handle}</span>
        </span>
      </Link>
      <Link className="btn" href="/settings">Invite someone</Link>
    </Win>
  );
}

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
                  <span className="rail-ev-title">{e.title}</span>
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
    <aside className="rail" aria-label="At a glance">
      {me.visitor ? <VisitorWindow expiresAt={me.visitor.expiresAt} /> : <You me={me} />}
      <Seats me={me} />
      <BirthdaysWindow />
      <NextEvents />
    </aside>
  );
}
