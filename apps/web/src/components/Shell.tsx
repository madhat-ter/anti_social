'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage, type Me } from '@/lib/api';
import { isSeated, useMe } from '@/lib/hooks';
import { ErrorNote } from './ui';
import { LurkerBanner } from './Lifecycle';
import { Avatar } from './Avatar';
import { Loading } from './retro';

export const UNREAD_EVENT = 'anti:unread';
export function broadcastUnread(n: number) {
  window.dispatchEvent(new CustomEvent(UNREAD_EVENT, { detail: n }));
}

/** Wraps a page for seated members; redirects everyone else to '/'. */
export function SeatedShell({ children, me: given }: { children: (me: Me) => ReactNode; me?: Me }) {
  const router = useRouter();
  const own = useMe();
  const me = given ?? own.me;
  const loading = given ? false : own.loading;
  const seated = isSeated(me);

  useEffect(() => {
    if (!loading && !own.error && !seated) router.replace('/');
  }, [loading, own.error, seated, router]);

  if (loading) return <Loading />;
  if (own.error && !given) return <ErrorNote message={errorMessage(own.error)} />;
  if (!me || !seated) return <Loading what="Redirecting" />;

  return (
    <>
      <NavBar me={me} />
      <LurkerBanner me={me} />
      <div className="stack">{children(me)}</div>
    </>
  );
}

function NavBar({ me }: { me: Me }) {
  const path = usePathname() ?? '/';
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    const poll = () => {
      api.unreadCount().then((r) => { if (alive) setUnread(r.unreadCount); }, () => { /* keep last value */ });
    };
    poll();
    const t = setInterval(poll, 30_000);
    const onFocus = () => poll();
    const onVisible = () => { if (document.visibilityState === 'visible') poll(); };
    const onBroadcast = (e: Event) => setUnread((e as CustomEvent<number>).detail);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(UNREAD_EVENT, onBroadcast);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(UNREAD_EVENT, onBroadcast);
    };
  }, []);

  const mine = `/u/${me.handle}`;
  const items: { href: string; label: string; match: (p: string) => boolean; badge?: number }[] = [
    { href: '/', label: 'Feed', match: (p) => p === '/' || p.startsWith('/p/') },
    { href: '/events', label: 'Events', match: (p) => p.startsWith('/events') },
    { href: '/members', label: 'Members', match: (p) => p === '/members' },
    { href: '/search', label: 'Search', match: (p) => p === '/search' },
    { href: '/notifications', label: 'Notifications', match: (p) => p === '/notifications', badge: unread },
    { href: '/settings', label: 'Settings', match: (p) => p === '/settings' },
  ];

  return (
    <nav className="nav" aria-label="Main">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.match(path) ? 'page' : undefined}>
          {i.label}
          {!!i.badge && i.badge > 0 && (
            <span className="badge" aria-label={`${i.badge} unread`}>{i.badge > 99 ? '99+' : i.badge}</span>
          )}
        </Link>
      ))}
      <Link href={mine} className="nav-me" aria-label="Your profile" aria-current={path === mine ? 'page' : undefined}>
        <Avatar seed={me.handle} size={28} />
      </Link>
    </nav>
  );
}
