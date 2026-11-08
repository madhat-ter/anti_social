import Link from 'next/link';
import type { MemberSummary } from '@/lib/api';
import { Avatar } from './Avatar';
import { BirthdayTag } from './Birthday';

/** One member in a list: the portfolio headline sits under the name when there is one, else the bio. */
export function MemberRow({ m }: { m: MemberSummary }) {
  const line = m.headline || m.bio;
  return (
    <li className="member">
      <Avatar seed={m.handle} gender={m.gender} size={44} />
      <Link href={`/u/${m.handle}`} className="member-link">
        <span>
          <span className="name">{m.displayName}</span>{' '}
          <span className="muted handle">@{m.handle}</span>
          {m.role === 'ops' && <span className="tag" title="Runs the room: moderates, invites, keeps it civil">admin</span>}
          <BirthdayTag b={m.birthday} />
          {m.state === 'archived' && <span className="tag">archived</span>}
          {m.openToWork && <span className="tag open-tag">open to work</span>}
        </span>
        {line && <span className="muted small bio-line">{line}</span>}
      </Link>
      <span className="muted small">{m.postCount} {m.postCount === 1 ? 'post' : 'posts'}</span>
    </li>
  );
}
