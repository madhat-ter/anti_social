'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage, type Me } from '@/lib/api';
import { isSeated, setUnreadInTitle, useMe } from '@/lib/hooks';
import { ErrorNote } from './ui';
import { LurkerBanner } from './Lifecycle';
import { Avatar } from './Avatar';
import { Loading } from './retro';
import { Rail } from './Rail';
import { PickWindow, useWide } from './Picks';

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
  const wide = useWide();

  const needsSetup = !!me?.setupNeeded;
  useEffect(() => {
    if (loading || own.error) return;
    if (!seated) router.replace('/');
    else if (needsSetup) router.replace('/setup'); // RFC §10.3: nothing else until setup is done
  }, [loading, own.error, seated, needsSetup, router]);

  if (loading) return <Loading />;
  if (own.error && !given) return <ErrorNote message={errorMessage(own.error)} />;
  if (!me || !seated || needsSetup) return <Loading what="Redirecting" />;

  // phones/tablets: nav on top, one column. Wide screens: menu | content | side windows (CSS).
  return (
    <div className="shell">
      <div className="shell-left">
        <NavBar me={me} />
        {wide && <PickWindow />}
      </div>
      <div className="shell-main">
        <LurkerBanner me={me} />
        <div className="stack">{children(me)}</div>
      </div>
      <Rail me={me} />
    </div>
  );
}

function NavBar({ me }: { me: Me }) {
  const path = usePathname() ?? '/';
  const [unread, setUnread] = useState(0);
  useEffect(() => { setUnreadInTitle(unread); }, [unread]);
  useEffect(() => () => setUnreadInTitle(0), []);

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
  const items: { href: string; label: string; match: (p: string) => boolean; badge?: number; cls?: string }[] = [
    { href: '/', label: 'Feed', match: (p) => p === '/' || p.startsWith('/p/') },
    { href: '/events', label: 'Events', match: (p) => p.startsWith('/events') },
    { href: '/members', label: 'Members', match: (p) => p === '/members' },
    { href: '/search', label: 'Search', match: (p) => p === '/search' },
    { href: '/notifications', label: 'Notifications', match: (p) => p === '/notifications', badge: unread },
    { href: '/settings', label: 'Settings', match: (p) => p === '/settings' },
    ...(me.role === 'ops' ? [{ href: '/admin', label: 'Admin', match: (p: string) => p === '/admin', cls: 'nav-admin' }] : []),
  ];

  return (
    <nav className="nav" aria-label="Main">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={i.cls} aria-current={i.match(path) ? 'page' : undefined}>
          {i.label}
          {!!i.badge && i.badge > 0 && (
            <span className="badge" aria-label={`${i.badge} unread`}>{i.badge > 99 ? '99+' : i.badge}</span>
          )}
        </Link>
      ))}
      <Link href={mine} className="nav-me" aria-current={path === mine ? 'page' : undefined}>
        <Avatar seed={me.handle} gender={me.gender} size={28} />
        {/* name: "Your profile @maya" — always contains the visible "@maya" (desktop shows it) */}
        <span className="sr-only">Your profile </span>
        <span className="nav-me-label">@{me.handle}</span>
      </Link>
    </nav>
  );
}
