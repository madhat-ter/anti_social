'use client';
/**
 * The phone shell (under 900px). The menu column of the desktop becomes two things that never
 * scroll away: a bell in the sticky header (notifications) and a bar of five tabs along the
 * bottom: the four rooms (Feed, Collab, Monologue, Members) and "You", which goes straight to your
 * profile (RFC §10.26; it used to open a sheet). The drawers (Pet Corner, consultations, settings,
 * admin) are a row of links at the top of your own profile; search is the box on Members.
 * Notifications are the bell only (RFC §10.20).
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Me } from '@/lib/api';
import { Avatar } from './Avatar';
import { isAdult } from './Consult';

type Room = { href: string; label: string; icon: IconName; match: (p: string) => boolean };
const ROOMS: Room[] = [
  { href: '/', label: 'Feed', icon: 'feed', match: (p) => p === '/' || p.startsWith('/p/') },
  // RFC §10.21: events, activities and projects are one place
  { href: '/collab', label: 'Collab', icon: 'collabs', match: (p) => p.startsWith('/collab') },
  // RFC §10.22: monologues fill the fifth slot
  { href: '/monologue', label: 'Monologue', icon: 'tape', match: (p) => p.startsWith('/monologue') },
  { href: '/members', label: 'Members', icon: 'members', match: (p) => p === '/members' },
];
/** pages reached from your profile: the "You" tab stays lit on them */
const YOURS = /^\/(settings|admin|consultations|pets|pet\/)/;

type IconName = 'feed' | 'events' | 'collabs' | 'members' | 'bell' | 'tape' | 'file';
/** 1-bit tab icons, drawn to match the alert triangle and the pick icons. */
export function TabIcon({ name, size = 22 }: { name: IconName; size?: number }) {
  // the fill follows --icon-fill so a lit (ink) tab can flip it to ink and keep the lines visible
  const s = { fill: 'var(--icon-fill, var(--paper))', stroke: 'currentColor', strokeWidth: 2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="tb-icon">
      {name === 'feed' && (<>
        <rect x="4" y="3" width="16" height="18" {...s} />
        <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>)}
      {name === 'events' && (<>
        <rect x="3" y="5" width="18" height="16" {...s} />
        <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <rect x="13" y="13" width="4" height="4" fill="currentColor" />
      </>)}
      {name === 'collabs' && (<>
        <rect x="3" y="3" width="12" height="12" {...s} />
        <rect x="9" y="9" width="12" height="12" {...s} />
      </>)}
      {name === 'members' && (<>
        <rect x="3" y="4" width="8" height="8" {...s} />
        <rect x="13" y="4" width="8" height="8" {...s} fill="currentColor" />
        <rect x="3" y="14" width="8" height="8" {...s} />
        <rect x="13" y="14" width="8" height="8" {...s} />
      </>)}
      {name === 'tape' && (<>
        <rect x="2" y="5" width="20" height="14" rx="1.5" {...s} />
        <circle cx="8" cy="11" r="2.2" {...s} />
        <circle cx="16" cy="11" r="2.2" {...s} />
        <path d="M7 19l1.6-3.2h6.8L17 19" {...s} />
      </>)}
      {/* RFC §10.24: a folder with its tab */}
      {name === 'file' && (<>
        <path d="M3 20V5h7l2 3h9v12Z" {...s} />
        <path d="M3 11h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>)}
      {name === 'bell' && (<>
        <path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4l2-2Z" {...s} />
        <path d="M10 21h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>)}
    </svg>
  );
}

function Badge({ n, what }: { n: number; what: string }) {
  if (n <= 0) return null;
  return <span className="badge" aria-label={`${n} ${what}`}>{n > 99 ? '99+' : n}</span>;
}

/** The bell in the sticky header: the one thing a member comes back for most. */
export function TopBell({ unread }: { unread: number }) {
  const path = usePathname() ?? '/';
  const on = path === '/notifications';
  return (
    <Link href="/notifications" className="top-bell" aria-current={on ? 'page' : undefined}
      aria-label={unread > 0 ? `Notifications, ${unread > 99 ? '99+' : unread} unread` : 'Notifications'}>
      <TabIcon name="bell" />
      {unread > 0 && <span className="badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}

/** RFC §10.24: your File, in the sticky header beside the bell (the owner asked for it there). */
export function TopFile() {
  const path = usePathname() ?? '/';
  const on = path.startsWith('/file');
  return (
    <Link href="/file" className="top-bell top-file" aria-current={on ? 'page' : undefined} aria-label="Your File">
      <TabIcon name="file" />
    </Link>
  );
}

export function PhoneBar({ me, waiting, adult }: { me: Me; waiting: number; adult: boolean }) {
  const path = usePathname() ?? '/';
  const mine = `/u/${me.handle}`;
  const youOn = path === mine || YOURS.test(path);
  return (
    <nav className="tabbar" aria-label="Main">
      {ROOMS.map((r) => (
        <Link key={r.href} href={r.href} className="tb" aria-current={r.match(path) ? 'page' : undefined}>
          <TabIcon name={r.icon} />
          <span className="tb-label">{r.label}</span>
        </Link>
      ))}
      {/* RFC §10.26: one tap to your profile; its drawers are a row of links on the profile itself (MeLinks) */}
      <Link href={mine} className={`tb tb-you${youOn ? ' on' : ''}`} aria-current={path === mine ? 'page' : undefined}>
        <span className="tb-face">
          <Avatar seed={me.handle} gender={me.gender} size={26} />
          {/* RFC §10.20: unread lives on the bell; this badge counts only the consultations waiting on you */}
          {adult && waiting > 0 && <span className="badge" aria-hidden="true">{waiting > 99 ? '99+' : waiting}</span>}
        </span>
        <span className="tb-label">You{adult && waiting > 0 && <span className="sr-only">, {waiting} waiting on you</span>}</span>
      </Link>
    </nav>
  );
}

/**
 * RFC §10.26: the drawers that used to sit in the "You" sheet, as a row at the top of your own
 * profile on phones (wide screens have them in the menu). One tap from the profile, no sheet.
 */
export function MeLinks({ me, waiting }: { me: Me; waiting: number }) {
  const adult = isAdult(me);
  return (
    <nav className="me-links" aria-label="Yours">
      <Link href="/pets">Pet Corner</Link>
      {adult && <Link href="/consultations">Consultations <Badge n={waiting} what="waiting on you" /></Link>}
      <Link href="/settings">Settings</Link>
      {me.role === 'ops' && <Link href="/admin">Admin</Link>}
    </nav>
  );
}
