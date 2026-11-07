import Link from 'next/link';
import type { MemberSummary } from '@/lib/api';

export function MemberRow({ m }: { m: MemberSummary }) {
  return (
    <li className="member">
      <Link href={`/u/${m.handle}`} className="member-link">
        <span className="name">{m.displayName}</span>{' '}
        <span className="muted">@{m.handle}</span>
        {m.state === 'archived' && <span className="tag">archived</span>}
        {m.bio && <span className="muted small bio-line">{m.bio}</span>}
      </Link>
      <span className="muted small">{m.postCount} {m.postCount === 1 ? 'post' : 'posts'}</span>
    </li>
  );
}
