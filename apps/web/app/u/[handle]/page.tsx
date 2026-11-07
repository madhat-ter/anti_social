'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage, type MemberSummary, type Pick, type Post } from '@/lib/api';
import { PickCard } from '@/components/Picks';
import { usePaged, useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { PostList } from '@/components/PostList';
import { ErrorNote } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { Loading, Win } from '@/components/retro';

export default function ProfilePage() {
  useTitle('Profile');
  return <SeatedShell>{(me) => <Profile myHandle={me.handle} />}</SeatedShell>;
}

/** A member's picks, newest first; you can remove your own. Hidden when there are none. */
function MemberPicks({ handle, mine }: { handle: string; mine: boolean }) {
  const [items, setItems] = useState<Pick[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.memberPicks(handle).then((r) => setItems(r.items), (e) => setErr(errorMessage(e))); }, [handle]);
  if (err) return <ErrorNote message={err} />;
  if (!items?.length) return null;
  return (
    <section className="stack" aria-labelledby="picks-h">
      <h2 id="picks-h" className="section-h">Picks</h2>
      <ul className="pick-grid">
        {items.map((p) => (
          <li key={p.id}>
            <PickCard p={p} showAuthor={false} />
            {mine && (
              <button type="button" className="link-btn" onClick={async () => {
                try { await api.deletePick(p.id); setItems((cur) => cur?.filter((x) => x.id !== p.id) ?? null); }
                catch (e) { setErr(errorMessage(e)); }
              }}>Remove</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Profile({ myHandle }: { myHandle: string }) {
  const params = useParams<{ handle: string }>();
  const handle = decodeURIComponent(params.handle);
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const posts = usePaged<Post>(`u:${handle}`, (c) => api.memberPosts(handle, c));

  useEffect(() => {
    let alive = true;
    setMember(null); setError(null);
    api.member(handle).then(
      (m) => { if (alive) setMember(m); },
      (e) => { if (alive) setError(errorMessage(e)); },
    );
    return () => { alive = false; };
  }, [handle]);

  if (error) return <><ErrorNote message={error} /><p><Link href="/members">Back to members</Link></p></>;
  if (!member) return <Loading />;

  const mine = member.handle.toLowerCase() === myHandle.toLowerCase();
  return (
    <>
      <Win title={`${member.handle}.profile`} className="profile">
        <div className="profile-head">
        <Avatar seed={member.handle} size={112} label={`${member.displayName}'s avatar`} />
        <div className="stack">
        <div>
          <h1 id="prof-h">
            {member.displayName}
            {member.state === 'archived' && <span className="tag" title="This member's seat was released">archived</span>}
          </h1>
          <p className="mono muted">@{member.handle}</p>
        </div>
        {member.bio && <p className="body">{member.bio}</p>}
        <p className="muted small">
          {member.invitedBy && <>Invited by <Link href={`/u/${member.invitedBy.handle}`}>@{member.invitedBy.handle}</Link>. </>}
          {member.activatedAt && <>Member since {new Date(member.activatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}. </>}
          {member.postCount} {member.postCount === 1 ? 'post' : 'posts'}.
        </p>
        {mine && <div className="row"><Link className="btn" href="/settings">Edit profile</Link></div>}
        </div>
        </div>
      </Win>
      <MemberPicks handle={member.handle} mine={mine} />
      <h2 className="section-h">Posts</h2>
      <PostList p={posts} empty="No posts yet." />
    </>
  );
}
