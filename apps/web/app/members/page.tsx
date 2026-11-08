'use client';
import { useTitle } from '@/lib/hooks';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { RULES } from '@anti/shared';
import { errorMessage, type Interest, type MemberSummary } from '@/lib/api';
import { loadAllMembers, seatCapCached } from '@/lib/members';
import { interestsCached } from '@/lib/interests';
import { SeatedShell } from '@/components/Shell';
import { ErrorNote } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { BirthdayTag } from '@/components/Birthday';
import { Loading } from '@/components/retro';
import { NameMarks } from '@/components/Marks';

export default function MembersPage() {
  useTitle('Members');
  return <SeatedShell>{(me) => <SeatMap myHandle={me.handle} />}</SeatedShell>;
}

type Pick = 'all' | 'new' | 'consults' | `i:${string}`;
const NEW_DAYS = 30;

/**
 * The members page is the room: one cell per seat, taken seats show their person. With a hundred
 * people a grid of faces needs a way in: a search over names and headlines, and chips for who is
 * new, who offers consultations, and each interest somebody here has.
 */
function SeatMap({ myHandle }: { myHandle: string }) {
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [seatCap, setSeatCap] = useState<number>(RULES.seat_cap);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Pick>('all');
  useEffect(() => { loadAllMembers().then(setMembers, (e) => setErr(errorMessage(e))); }, []);
  useEffect(() => { seatCapCached().then(setSeatCap); }, []);
  useEffect(() => { interestsCached().then(setInterests, () => setInterests([])); }, []);

  // interests somebody in the room actually has, most shared first
  const shared = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of members ?? []) for (const s of m.interests) counts.set(s, (counts.get(s) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([slug, n]) => ({ slug, n, label: interests.find((i) => i.slug === slug)?.label ?? slug }));
  }, [members, interests]);

  if (err) return <ErrorNote message={err} />;
  if (!members) return <Loading />;

  const cap = Math.max(seatCap, members.length);
  const open = cap - members.length;
  const since = Date.now() - NEW_DAYS * 86_400_000;
  const isNew = (m: MemberSummary) => !!m.activatedAt && new Date(m.activatedAt).getTime() > since;
  const anyConsult = members.some((m) => m.consults);
  const anyNew = members.some(isNew);
  const term = q.trim().replace(/^@/, '').toLowerCase();
  const matches = (m: MemberSummary) =>
    (!term || m.handle.toLowerCase().includes(term) || m.displayName.toLowerCase().includes(term) || m.headline.toLowerCase().includes(term))
    && (pick === 'all' || (pick === 'new' && isNew(m)) || (pick === 'consults' && m.consults) || (pick.startsWith('i:') && m.interests.includes(pick.slice(2))));
  const shown = members.filter(matches);
  const chip = (value: Pick, label: string, n?: number) => (
    <button key={value} type="button" className={`chip${pick === value ? ' on' : ''}`} aria-pressed={pick === value} onClick={() => setPick(value)}>
      {label}{n !== undefined && <span className="chip-n">{n}</span>}
    </button>
  );
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
      {members.length > 3 && (
        <div className="stack members-tools">
          <input type="search" aria-label="Find a member" placeholder="Find by name, handle or headline" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="chips" role="group" aria-label="Show">
            {chip('all', 'Everyone')}
            {anyNew && chip('new', 'New this month', members.filter(isNew).length)}
            {anyConsult && chip('consults', 'Offers consultations', members.filter((m) => m.consults).length)}
            {shared.map((s) => chip(`i:${s.slug}`, s.label, s.n))}
          </div>
        </div>
      )}
      {shown.length === 0 ? <p className="empty">Nobody matches. Try another word, or <button type="button" className="link-btn" onClick={() => { setQ(''); setPick('all'); }}>show everyone</button>.</p> : (
        <ol className="seatmap">
          {shown.map((m) => (
            <li key={m.handle} className={m.handle === myHandle ? 'me' : undefined}>
              <Link href={`/u/${m.handle}`} title={m.headline || m.bio || undefined}>
                <Avatar seed={m.handle} gender={m.gender} size={56} />
                <span className="seat-name">{m.displayName}<NameMarks admin={m.role === 'ops'} verified={m.verified} size=".85em" /></span>
                <span className="seat-handle">@{m.handle}</span>
                <BirthdayTag b={m.birthday} />
                {isNew(m) && <span className="tag new-tag" title={`Joined in the last ${NEW_DAYS} days`}>new</span>}
                {m.consults && <span className="tag consults-tag" title="Takes consultations">consults</span>}
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
      )}
    </>
  );
}
