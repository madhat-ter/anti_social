'use client';
/** RFC §10.8: the link an admin sends. The code is filled in; one button starts the hour. */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { formatInviteCode, normalizeInviteCode } from '@anti/shared';
import { useMe, useTitle } from '@/lib/hooks';
import { VisitorCodeForm } from '@/components/Visitor';
import { Loading, Win } from '@/components/retro';

export default function VisitPage() {
  useTitle('Visitor pass');
  const params = useParams<{ code: string }>();
  const code = formatInviteCode(normalizeInviteCode(decodeURIComponent(params.code ?? '')));
  const { me, loading } = useMe();
  if (loading) return <Loading />;

  return (
    <div className="stack">
      <h1>Visitor pass</h1>
      <Win title="visitor_pass" bodyClassName="stack">
        {me && !me.visitor ? (
          <>
            <p>You are already a member. No pass needed.</p>
            <div className="row"><Link className="btn primary" href="/">Back to the feed</Link></div>
          </>
        ) : me?.visitor ? (
          <>
            <p>You are already visiting. Your hour is running.</p>
            <div className="row"><Link className="btn primary" href="/">Keep looking around</Link></div>
          </>
        ) : (
          <>
            <p>Someone inside gave you an hour to look around. You will see what members see and can&apos;t touch any of it. The hour starts when you press the button, and the pass works once, in this browser.</p>
            <VisitorCodeForm initial={code} />
            <p className="muted small">Already a member? <Link href="/login">Sign in</Link>. Have an invite? <Link href="/join">Join</Link>.</p>
          </>
        )}
      </Win>
    </div>
  );
}
