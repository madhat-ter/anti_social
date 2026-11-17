'use client';
import { fmtDate, useTitle } from '@/lib/hooks';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RULES } from '@anti/shared';
import { api, errorMessage, type Interest, type InviteInfo, type MemberSummary, type Post } from '@/lib/api';
import { loadAllMembers, seatCapCached } from '@/lib/members';
import { interestsCached } from '@/lib/interests';
import { SeatedShell } from '@/components/Shell';
import { CopyButton, ErrorNote } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { BirthdayTag } from '@/components/Birthday';
import { Loading } from '@/components/retro';
import { NameMarks } from '@/components/Marks';
import { PostCard, replaceIn } from '@/components/PostCard';

export default function MembersPage() {
  useTitle('Members');
  return <SeatedShell>{(me) => <SeatMap myHandle={me.handle} />}</SeatedShell>;
}

type Pick = 'all' | 'new' | 'consults' | `i:${string}`;
const NEW_DAYS = 30;
// Rendered only client-side (inside SeatedShell, after /me loads), so window is available.
const initialQuery = () => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('q') ?? '');

/**
 * RFC §10.26: inviting lives beside the seats it fills (it used to be a section of Settings).
 * One tap makes the code and shows it with Copy; "Your invites" opens the ones made before.
 */
function Invite({ open }: { open: number }) {
  const [list, setList] = useState<InviteInfo[]>([]);
  const [fresh, setFresh] = useState<{ code: string; expiresAt: string } | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setList(await api.invites()); } catch (e) { setErr(errorMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    setErr(null); setBusy(true);
    try { setFresh(await api.createInvite()); await load(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <div className="stack seat-invite">
      <div className="row">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void create()}>{busy ? 'Making a code…' : '+ Invite someone'}</button>
        {list.length > 0 && (
          <button type="button" className="link-btn" aria-expanded={shown} onClick={() => setShown((s) => !s)}>Your invites ({list.length})</button>
        )}
        {open === 0 && <span className="muted small">The room is full: whoever you invite waits in line.</span>}
      </div>
      <ErrorNote message={err} />
      {fresh && (
        <div className="stack" role="status">
          <p className="muted">Send this code to the person you are inviting. It is shown only once. Expires {fmtDate(fresh.expiresAt)}.</p>
          <p className="code">{fresh.code}</p>
          <div className="row"><CopyButton text={fresh.code} /><button type="button" className="btn" onClick={() => setFresh(null)}>Done</button></div>
        </div>
      )}
      {shown && (
        <ul className="list">
          {list.map((i, n) => (
            <li key={n}>
              <span>Created {fmtDate(i.createdAt)}<br /><small className="muted">
                {i.status === 'redeemed' ? `Used by @${i.redeemedBy?.handle ?? 'unknown'}` : i.status === 'open' ? `Expires ${fmtDate(i.expiresAt)}` : i.status}
              </small></span>
              <span className="muted">{i.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The members page is the room: one cell per seat, taken seats show their person. With a hundred
 * people a grid of faces needs a way in: chips for who is new, who offers consultations, and each
 * interest somebody here has, and one search box. RFC §10.26: that box is the site's only search;
 * it narrows the faces as you type and lists the posts that hold the same words underneath.
 */
function SeatMap({ myHandle }: { myHandle: string }) {
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [seatCap, setSeatCap] = useState<number>(RULES.seat_cap);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState(initialQuery);
  const [pick, setPick] = useState<Pick>('all');
  /** the words the posts were last searched for (a moment behind the box) */
  const [asked, setAsked] = useState(() => initialQuery().trim());
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [postsErr, setPostsErr] = useState<string | null>(null);
  useEffect(() => { loadAllMembers().then(setMembers, (e) => setErr(errorMessage(e))); }, []);
  useEffect(() => { seatCapCached().then(setSeatCap); }, []);
  useEffect(() => { interestsCached().then(setInterests, () => setInterests([])); }, []);

  useEffect(() => {
    const t = setTimeout(() => setAsked(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  // the address keeps the words, so a search can be sent to someone or come back after Back
  useEffect(() => {
    window.history.replaceState(window.history.state, '', asked ? `/members?q=${encodeURIComponent(asked)}` : '/members');
  }, [asked]);
  useEffect(() => {
    if (!asked) { setPosts(null); setPostsErr(null); return; }
    let alive = true;
    setPostsErr(null);
    api.search(asked).then(
      (r) => { if (alive) setPosts(r.posts); },
      (e) => { if (alive) { setPosts([]); setPostsErr(errorMessage(e)); } },
    );
    return () => { alive = false; };
  }, [asked]);

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
  const searching = term !== '';
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
          {open > 0 ? `${open} open.` : 'The room is full; new people wait in line.'}
        </figcaption>
      </figure>
      <Invite open={open} />
      <div className="stack members-tools">
        <form role="search" onSubmit={(e) => { e.preventDefault(); setAsked(q.trim()); }}>
          <input type="search" aria-label="Search people and posts" placeholder="Search people and posts" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </form>
        {members.length > 3 && (
          <div className="chips" role="group" aria-label="Show">
            {chip('all', 'Everyone')}
            {anyNew && chip('new', 'New this month', members.filter(isNew).length)}
            {anyConsult && chip('consults', 'Offers consultations', members.filter((m) => m.consults).length)}
            {shared.map((s) => chip(`i:${s.slug}`, s.label, s.n))}
          </div>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="empty">
          {searching && pick === 'all' ? 'Nobody by that name.' : <>Nobody matches. Try another word, or <button type="button" className="link-btn" onClick={() => { setQ(''); setPick('all'); }}>show everyone</button>.</>}
        </p>
      ) : (
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
      {/* the posts that hold the same words; nothing here until something is typed */}
      {searching && (
        <section aria-labelledby="s-p" className="stack">
          <h2 id="s-p" className="section-h">Posts</h2>
          <ErrorNote message={postsErr} />
          {posts === null || asked !== q.trim() ? <p className="muted" role="status">Searching...</p>
            : posts.length === 0 ? (!postsErr && <p className="muted">No posts found.</p>)
            : (
              <div className="posts">
                {posts.map((p) => <PostCard key={p.id} post={p} onChange={(np) => setPosts((cur) => (cur ? replaceIn(cur, np) : cur))} />)}
              </div>
            )}
        </section>
      )}
    </>
  );
}
