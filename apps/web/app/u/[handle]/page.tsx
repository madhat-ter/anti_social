'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage, type MemberSummary, type CollabSummary, type Pick, type Portfolio, type Post, type ProjectSummary } from '@/lib/api';
import { PickCard } from '@/components/Picks';
import { CollabCard } from '@/components/Collabs';
import { PortfolioWindow } from '@/components/Portfolio';
import { ConsultingSection, isAdult } from '@/components/Consult';
import { usePaged, useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { PostList } from '@/components/PostList';
import { ErrorNote } from '@/components/ui';
import { AlertDialog, Loading } from '@/components/retro';

export default function ProfilePage() {
  useTitle('Profile');
  return <SeatedShell>{(me) => <Profile myHandle={me.handle} adult={isAdult(me)} />}</SeatedShell>;
}

/** A member's picks, newest first; you can remove your own. */
function MemberPicks({ handle, mine }: { handle: string; mine: boolean }) {
  const [items, setItems] = useState<Pick[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<Pick | null>(null);
  useEffect(() => { api.memberPicks(handle).then((r) => setItems(r.items), (e) => setErr(errorMessage(e))); }, [handle]);
  if (err) return <ErrorNote message={err} />;
  if (!items) return <Loading />;
  if (!items.length) return <p className="empty">{mine ? 'No picks yet. Suggest something from the pick window.' : 'No picks yet.'}</p>;
  return (
    <>
    <ul className="pick-grid">
      {items.map((p) => (
        <li key={p.id}>
          <PickCard p={p} showAuthor={false} onChange={(np) => setItems((cur) => cur?.map((x) => (x.id === np.id ? np : x)) ?? null)} />
          {mine && (
            <button type="button" className="link-btn" onClick={() => setAsk(p)}>Delete pick</button>
          )}
        </li>
      ))}
    </ul>
      {/* RFC §10.20: the same confirm the pick window asks */}
      <AlertDialog
        open={ask !== null}
        title="Delete pick"
        message={ask ? <>Delete <strong>{ask.title}</strong>? Its votes and remarks go with it.</> : ''}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          const p = ask; setAsk(null);
          if (!p) return;
          try { await api.deletePick(p.id); setItems((cur) => cur?.filter((x) => x.id !== p.id) ?? null); }
          catch (e) { setErr(errorMessage(e)); }
        }}
        onCancel={() => setAsk(null)}
      />
    </>
  );
}

/** The collabs they host or are on. */
function MemberCollabs({ handle, mine }: { handle: string; mine: boolean }) {
  const [items, setItems] = useState<CollabSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.memberCollabs(handle).then((r) => setItems(r.items), (e) => setErr(errorMessage(e))); }, [handle]);
  if (err) return <ErrorNote message={err} />;
  if (!items) return <Loading />;
  if (!items.length) return <p className="empty">{mine ? <>Not on any collab yet. <Link href="/collabs">Find one</Link>, or start your own.</> : 'Not on any collab yet.'}</p>;
  return <ul className="collabs">{items.map((c) => <CollabCard key={c.id} c={c} />)}</ul>;
}

/** The portfolio window on top; posts and picks underneath, behind folder tabs. */
function Profile({ myHandle, adult }: { myHandle: string; adult: boolean }) {
  const params = useParams<{ handle: string }>();
  const handle = decodeURIComponent(params.handle);
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [pf, setPf] = useState<Portfolio | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [orderErr, setOrderErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'posts' | 'collabs' | 'picks'>('posts');
  const posts = usePaged<Post>(`u:${handle}`, (c) => api.memberPosts(handle, c));

  useEffect(() => {
    let alive = true;
    setMember(null); setPf(null); setError(null); setTab('posts');
    Promise.all([api.member(handle), api.portfolio(handle), api.projects(handle)]).then(
      ([m, p, pr]) => { if (alive) { setMember(m); setPf(p); setProjects(pr.items); } },
      (e) => { if (alive) setError(errorMessage(e)); },
    );
    return () => { alive = false; };
  }, [handle]);

  if (error) return <><ErrorNote message={error} /><p><Link href="/members">Back to members</Link></p></>;
  if (!member || !pf) return <Loading />;

  const mine = member.handle.toLowerCase() === myHandle.toLowerCase();
  const reorder = async (ids: string[]) => {
    const byId = new Map(projects.map((p) => [p.id, p]));
    setProjects(ids.map((i) => byId.get(i)!));
    setOrderErr(null);
    try { await api.orderProjects(ids); }
    catch (e) { setOrderErr(errorMessage(e)); api.projects(handle).then((r) => setProjects(r.items), () => {}); }
  };
  return (
    <>
      <PortfolioWindow member={member} pf={pf} projects={projects} onSaved={setPf} onReorder={reorder}
        pets={member.pets ?? []}
        onPets={(pets) => setMember((cur) => cur ? { ...cur, pets } : cur)}
        consulting={<ConsultingSection handle={member.handle} viewerAdult={adult} />} />
      <ErrorNote message={orderErr} />
      <div className="tabs pf-tabs" role="tablist">
        {(['posts', 'collabs', 'picks'] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={tab === s} className={tab === s ? 'tab on' : 'tab'} onClick={() => setTab(s)}>
            {s === 'posts' ? 'Posts' : s === 'collabs' ? 'Collabs' : 'Picks'}
          </button>
        ))}
      </div>
      {tab === 'posts'
        ? <PostList framed p={posts} empty={mine ? 'You have not posted yet.' : 'No posts yet.'} />
        : tab === 'collabs' ? <MemberCollabs handle={member.handle} mine={mine} />
        : <MemberPicks handle={member.handle} mine={mine} />}
    </>
  );
}
