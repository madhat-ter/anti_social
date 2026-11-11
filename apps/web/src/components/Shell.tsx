'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, errorMessage, type Me } from '@/lib/api';
import { isSeated, setUnreadInTitle, useMe } from '@/lib/hooks';
import { ErrorNote } from './ui';
import { LurkerBanner } from './Lifecycle';
import { Avatar } from './Avatar';
import { NameMarks } from './Marks';
import { Loading } from './retro';
import { Rail } from './Rail';
import { isAdult } from './Consult';
import { ReadOnlyProvider, VisitorPill, isVisitor, membersOnlyPath, useVisitorEnd } from './Visitor';
import { PhoneBar, TopBell } from './PhoneBar';
import { Shortcuts } from './Shortcuts';
import { PinGate } from './Pin';

export const UNREAD_EVENT = 'anti:unread';
/** a consultation changed: the menu badge re-counts what waits on you */
export const CONSULT_EVENT = 'anti:consult';
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

  const needsSetup = !!me?.setupNeeded;
  // a visitor (RFC §10.8) on a members-only page (settings, inbox, writing, editing) goes back to the feed
  const path = usePathname() ?? '/';
  const visitorAstray = isVisitor(me) && membersOnlyPath(path);
  useVisitorEnd(me);
  useEffect(() => {
    if (loading || own.error) return;
    if (!seated || visitorAstray) router.replace('/');
    else if (needsSetup) router.replace('/setup'); // RFC §10.3: nothing else until setup is done
  }, [loading, own.error, seated, needsSetup, visitorAstray, router]);

  if (loading) return <Loading />;
  if (own.error && !given) return <ErrorNote message={errorMessage(own.error)} />;
  if (!me || !seated || needsSetup || visitorAstray) return <Loading what="Redirecting" />;
  // RFC §10.13: joined with a passkey, no PIN yet: choosing one comes first (once)
  if (me.pinSet === false && !isVisitor(me)) return <PinGate me={me} />;

  // phones/tablets: nav on top, one column. Wide screens: menu | content | side windows (CSS).
  return (
    <ReadOnlyProvider on={isVisitor(me)}>
      <div className={`shell${isVisitor(me) ? ' visiting' : ''}`}>
        <div className="shell-left">
          <NavBar me={me} />
          <Shortcuts />
        </div>
        <div className="shell-main">
          <LurkerBanner me={me} />
          <div className="stack">{children(me)}</div>
        </div>
        <Rail me={me} />
      </div>
    </ReadOnlyProvider>
  );
}

function NavBar({ me }: { me: Me }) {
  const path = usePathname() ?? '/';
  const [unread, setUnread] = useState(0);
  const [waiting, setWaiting] = useState(0);
  const visitor = isVisitor(me);
  const adult = isAdult(me) && !visitor;
  useEffect(() => { setUnreadInTitle(unread); }, [unread]);
  // consultations waiting on you (to answer, or a price to agree to); 18+ only
  useEffect(() => {
    if (!adult) return;
    const poll = () => { api.consultWaiting().then((r) => setWaiting(r.waiting), () => {}); };
    poll();
    window.addEventListener(CONSULT_EVENT, poll);
    return () => window.removeEventListener(CONSULT_EVENT, poll);
  }, [adult, path, unread]);
  useEffect(() => () => setUnreadInTitle(0), []);

  useEffect(() => {
    if (visitor) return; // no inbox
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
  }, [visitor]);

  // phones (PhoneBar.tsx): the bell goes into the sticky header, the tabs along the bottom; CSS decides which shell shows
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById('top-actions')); }, []);
  const phone = (
    <>
      <PhoneBar me={me} unread={unread} waiting={waiting} adult={adult} />
      {slot && !visitor && createPortal(<TopBell unread={unread} />, slot)}
    </>
  );

  const mine = `/u/${me.handle}`;
  // a visitor (RFC §10.8) gets the rooms, not the drawers: no inbox, no settings, no admin
  // the rooms first; your drawers (Notifications, Settings, Admin) as a group at the bottom of the menu window
  const items: { href: string; label: string; match: (p: string) => boolean; badge?: number; cls?: string }[] = [
    { href: '/', label: 'Feed', match: (p) => p === '/' || p.startsWith('/p/') },
    // the same order as the phone's tabs (RFC §10.20); Events and Collabs are one place (§10.21)
    { href: '/collab', label: 'Collab', match: (p) => p.startsWith('/collab') },
    // RFC §10.22
    { href: '/monologue', label: 'Monologue', match: (p) => p.startsWith('/monologue') },
    ...(adult ? [{ href: '/consultations', label: 'Consultations', match: (p: string) => p.startsWith('/consultations'), badge: waiting }] : []),
    { href: '/members', label: 'Members', match: (p) => p === '/members' },
    { href: '/search', label: 'Search', match: (p) => p === '/search' },
    ...(visitor ? [] : [
      { href: '/pets', label: 'Pet Corner', match: (p: string) => p.startsWith('/pets') || p.startsWith('/pet/'), cls: 'nav-drawer nav-drawer-first' },
      { href: '/notifications', label: 'Notifications', match: (p: string) => p === '/notifications', badge: unread, cls: 'nav-drawer' },
      { href: '/settings', label: 'Settings', match: (p: string) => p === '/settings', cls: 'nav-drawer' },
    ]),
    ...(me.role === 'ops' ? [{ href: '/admin', label: 'Admin', match: (p: string) => p === '/admin', cls: 'nav-drawer nav-admin' }] : []),
  ];

  if (visitor) {
    return (
      <>
        <nav className="nav" aria-label="Main">
          {items.map((i) => (
            <Link key={i.href} href={i.href} className={i.cls} aria-current={i.match(path) ? 'page' : undefined}>{i.label}</Link>
          ))}
          <VisitorPill expiresAt={me.visitor.expiresAt} />
        </nav>
        {phone}
      </>
    );
  }

  return (
    <>
      <nav className="nav" aria-label="Main">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className={i.cls} aria-current={i.match(path) ? 'page' : undefined}>
            {i.label}
            {!!i.badge && i.badge > 0 && (
              <span className="badge" aria-label={i.href === '/consultations' ? `${i.badge} waiting on you` : `${i.badge} unread`}>{i.badge > 99 ? '99+' : i.badge}</span>
            )}
          </Link>
        ))}
        <Link href={mine} className="nav-me" aria-current={path === mine ? 'page' : undefined}>
          <Avatar seed={me.handle} gender={me.gender} size={28} />
          {/* name: "Your profile @maya" — always contains the visible "@maya" (desktop shows it) */}
          <span className="sr-only">Your profile </span>
          <span className="nav-me-label">@{me.handle}<NameMarks admin={me.role === 'ops'} verified={!!me.verifiedAt} size=".9em" /></span>
        </Link>
      </nav>
      {phone}
    </>
  );
}
