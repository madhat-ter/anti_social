'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage, type MemberSummary, type Post } from '@/lib/api';
import { usePaged } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { PostList } from '@/components/PostList';
import { ErrorNote } from '@/components/ui';

export default function ProfilePage() {
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
  if (!member) return <p className="muted" role="status">Loading...</p>;

  const mine = member.handle.toLowerCase() === myHandle.toLowerCase();
  return (
    <>
      <section className="card stack profile" aria-labelledby="prof-h">
        <div>
          <h1 id="prof-h">
            {member.displayName}
            {member.state === 'archived' && <span className="tag" title="This member's seat was released">archived</span>}
          </h1>
          <p className="muted">@{member.handle}</p>
        </div>
        {member.bio && <p className="body">{member.bio}</p>}
        <p className="muted small">
          {member.invitedBy && <>Invited by <Link href={`/u/${member.invitedBy.handle}`}>@{member.invitedBy.handle}</Link>. </>}
          {member.activatedAt && <>Member since {new Date(member.activatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}. </>}
          {member.postCount} {member.postCount === 1 ? 'post' : 'posts'}.
        </p>
        {mine && <div className="row"><Link className="btn" href="/settings">Edit profile in Settings</Link></div>}
      </section>
      <h2 className="section-h">Posts</h2>
      <PostList p={posts} empty="No posts yet." />
    </>
  );
}
