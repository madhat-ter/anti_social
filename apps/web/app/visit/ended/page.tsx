'use client';
/** RFC §10.8: where a visitor lands when the hour is up (or the pass was revoked). */
import Link from 'next/link';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { useTitle } from '@/lib/hooks';
import { AlertIcon, Win } from '@/components/retro';

export default function VisitEndedPage() {
  useTitle('Your hour is up');
  // the API drops the cookie on its own once the pass is over; this only makes sure, in case the timer here fired first
  useEffect(() => { api.leaveVisit().catch(() => {}); }, []);
  return (
    <div className="stack">
      <h1>Your hour is up</h1>
      <Win title="hour_up" bodyClassName="stack">
        <div className="dlg-body">
          <AlertIcon />
          <div className="stack dlg-main">
            <p className="dlg-msg">Thanks for looking around. That was the whole place: one feed, a hundred seats, people who show up.</p>
            <p>Anti is invite-only. If you want in, ask the person who sent you the pass. Members get two invites at a time, and they choose carefully.</p>
            <div className="row dlg-actions">
              <Link className="btn" href="/login">Sign in</Link>
              <Link className="btn default" href="/join">Join with an invite</Link>
            </div>
          </div>
        </div>
      </Win>
    </div>
  );
}
