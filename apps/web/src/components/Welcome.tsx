'use client';
/**
 * Shown once per member on their first visit to the feed. The house rules decide whether you
 * keep your seat, so new members learn them before they matter, not from a warning.
 * Dismissal is a per-device convenience in localStorage; losing it just shows the window again.
 */
import { useEffect, useState } from 'react';
import { RULES } from '@anti/shared';
import type { Me } from '@/lib/api';
import { Avatar } from './Avatar';
import { Win } from './retro';

const key = (handle: string) => `anti:welcomed:${handle}`;

/** Has this device already closed the welcome window for this member? */
export function wasWelcomed(handle: string): boolean {
  try { return !!localStorage.getItem(key(handle)); } catch { return true; }
}
/** The rules were shown somewhere else (the end of setup): no welcome window on top of them. */
export function markWelcomed(handle: string) {
  try { localStorage.setItem(key(handle), new Date().toISOString()); } catch { /* private mode */ }
}

/** The three rules that decide whether you keep your seat. Shown at the end of setup, and in the welcome window for members from before. */
export function HouseRules() {
  return (
    <ul className="house-rules">
      {/* one child per li: the li is a 2-column grid (dot + text), loose text nodes would each take a cell */}
      <li><span><strong>Show up.</strong> Sign in at least once every {RULES.inactivity_days} days, or your seat goes to the next person in line.</span></li>
      <li><span><strong>Say something.</strong> Post or reply now and then. Members who only read get a warning, then lose their seat.</span></li>
      <li><span><strong>Talk in public, meet in person.</strong> There are no messages. Reply where everyone can see, or host an event.</span></li>
    </ul>
  );
}

export function Welcome({ me, onDone }: { me: Me; onDone?: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(!localStorage.getItem(key(me.handle))); } catch { setShow(false); }
  }, [me.handle]);
  if (!show) return null;

  function dismiss() {
    try { localStorage.setItem(key(me.handle), new Date().toISOString()); } catch { /* private mode */ }
    setShow(false);
    onDone?.();
  }

  return (
    <Win title="welcome.txt" className="welcome" onClose={dismiss} bodyClassName="stack" as="aside">
      <div className="welcome-head">
        <Avatar seed={me.handle} gender={me.gender} size={72} />
        <div>
          <h2>You are in, {me.displayName.split(' ')[0]}.</h2>
          <p>One of a hundred seats is yours. Three things keep it that way:</p>
        </div>
      </div>
      <HouseRules />
      <div className="row dlg-actions">
        <button type="button" className="btn default" onClick={dismiss}>Got it</button>
      </div>
    </Win>
  );
}
