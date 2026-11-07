'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RULES } from '@anti/shared';
import { api, errorMessage, type MemberSummary } from '@/lib/api';
import { SeatedShell } from '@/components/Shell';
import { ErrorNote } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { Loading } from '@/components/retro';

export default function MembersPage() {
  return <SeatedShell>{(me) => <SeatMap myHandle={me.handle} />}</SeatedShell>;
}

/** Every member, all pages: there are at most a hundred. */
async function loadAll(): Promise<MemberSummary[]> {
  const all: MemberSummary[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const page = await api.members(cursor, 50);
    all.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return all;
}

/** The members page is the room: one cell per seat, taken seats show their person. */
function SeatMap({ myHandle }: { myHandle: string }) {
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadAll().then(setMembers, (e) => setErr(errorMessage(e))); }, []);

  if (err) return <ErrorNote message={err} />;
  if (!members) return <Loading />;

  const cap = Math.max(RULES.seat_cap, members.length);
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
            <Link href={`/u/${m.handle}`} title={m.bio || undefined}>
              <Avatar seed={m.handle} size={56} />
              <span className="seat-name">{m.displayName}</span>
              <span className="seat-handle">@{m.handle}</span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
