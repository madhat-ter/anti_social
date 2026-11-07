import Link from 'next/link';
import type { MemberSummary } from '@/lib/api';
import { Avatar } from './Avatar';

export function MemberRow({ m }: { m: MemberSummary }) {
  return (
    <li className="member">
      <Avatar seed={m.handle} size={44} />
      <Link href={`/u/${m.handle}`} className="member-link">
        <span>
          <span className="name">{m.displayName}</span>{' '}
          <span className="muted handle">@{m.handle}</span>
          {m.state === 'archived' && <span className="tag">archived</span>}
        </span>
        {m.bio && <span className="muted small bio-line">{m.bio}</span>}
      </Link>
      <span className="muted small">{m.postCount} {m.postCount === 1 ? 'post' : 'posts'}</span>
    </li>
  );
}
