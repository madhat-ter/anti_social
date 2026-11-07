'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage, type MemberSummary, type Post } from '@/lib/api';
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
      <h2 className="section-h">Posts</h2>
      <PostList p={posts} empty="No posts yet." />
    </>
  );
}
