'use client';
import { useTitle } from '@/lib/hooks';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RULES } from '@anti/shared';
import { errorMessage, type MemberSummary } from '@/lib/api';
import { loadAllMembers, seatCapCached } from '@/lib/members';
import { SeatedShell } from '@/components/Shell';
import { ErrorNote } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { BirthdayTag } from '@/components/Birthday';
import { Loading } from '@/components/retro';

export default function MembersPage() {
  useTitle('Members');
  return <SeatedShell>{(me) => <SeatMap myHandle={me.handle} />}</SeatedShell>;
}


/** The members page is the room: one cell per seat, taken seats show their person. */
function SeatMap({ myHandle }: { myHandle: string }) {
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [seatCap, setSeatCap] = useState<number>(RULES.seat_cap);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadAllMembers().then(setMembers, (e) => setErr(errorMessage(e))); }, []);
  useEffect(() => { seatCapCached().then(setSeatCap); }, []);

  if (err) return <ErrorNote message={err} />;
  if (!members) return <Loading />;

  const cap = Math.max(seatCap, members.length);
  const open = cap - members.length;
  return (
    <>
      <h1>Members</h1>
      <figure className="seat-chart-wrap">
        {/* theatre seating plan: one square per seat, taken first, yours in red */}
        <div className="seat-chart" role="img" aria-label={`${members.length} of ${cap} seats taken`}>
          {Array.from({ length: cap }, (_, i) => {
            const m = members[i];
            const cls = !m ? 'open' : m.handle === myHandle ? 'taken me' : 'taken';
            return <span key={i} className={cls} title={m ? `@${m.handle}` : 'Open seat'} />;
          })}
        </div>
        <figcaption className="seat-count">
          <strong>{members.length}</strong> of {cap} seats taken.{' '}
          {open > 0 ? `${open} open. Invites from Settings fill them.` : 'The room is full; new people wait in line.'}
        </figcaption>
      </figure>
      <ol className="seatmap">
        {members.map((m) => (
          <li key={m.handle} className={m.handle === myHandle ? 'me' : undefined}>
            <Link href={`/u/${m.handle}`} title={m.headline || m.bio || undefined}>
              <Avatar seed={m.handle} gender={m.gender} size={56} />
              <span className="seat-name">{m.displayName}</span>
              <span className="seat-handle">@{m.handle}</span>
              <BirthdayTag b={m.birthday} />
              {m.headline && (
                <span className="seat-headline">
                  {m.openToWork && <span className="rdot on" role="img" aria-label="open to work" />}
                  <span className="seat-headline-text">{m.headline}</span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
