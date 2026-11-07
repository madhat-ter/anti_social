'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { fmtDate, useMe } from '@/lib/hooks';
import { ErrorNote } from '@/components/ui';

export default function Home() {
  const { me, loading, error, refresh } = useMe();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <p className="muted">Loading...</p>;
  if (error) return <ErrorNote message={errorMessage(error)} />;

  if (!me) {
    return (
      <div className="stack">
        <h1>A small, quiet network.</h1>
        <p className="muted">Invite-only, one hundred seats, passkeys instead of passwords.</p>
        <div className="row">
          <Link className="btn primary" href="/join">Join with an invite</Link>
          <Link className="btn" href="/login">Sign in with passkey</Link>
        </div>
      </div>
    );
  }

  async function rejoin() {
    setBusy(true); setErr(null);
    try { await api.rejoin(); await refresh(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <h1>@{me.handle}</h1>

      {me.state === 'waitlisted' && (
        <div className="card stack">
          <h2>You are on the waitlist</h2>
          {me.waitlist && <p><span className="big">#{me.waitlist.position}</span> <span className="muted">in the queue</span></p>}
          <p className="muted">When a seat opens you will be seated automatically. Check back any time.</p>
        </div>
      )}

      {me.state === 'archived' && (
        <div className="card stack">
          <h2>Your seat was released</h2>
          <p className="muted">Seats are given up after a long absence so others can join. Your account and handle are kept.</p>
          {me.waitlist?.offeredUntil && (
            <p>A seat is being held for you until {fmtDate(me.waitlist.offeredUntil)}. Payment arrives in Milestone 4.</p>
          )}
          <div className="row">
            <button className="btn primary" onClick={rejoin} disabled={busy}>Rejoin the queue</button>
            {me.waitlist?.offeredUntil && <button className="btn" disabled title="Payment arrives in Milestone 4">Pay to reinstate</button>}
          </div>
          <ErrorNote message={err} />
        </div>
      )}

      {me.state === 'flagged_lurker' && (
        <div className="banner" role="status">
          You have not been active lately.{' '}
          {me.lurker ? <>Post or interact before {fmtDate(me.lurker.graceEndsAt)} to keep your seat.</> : 'Interact soon to keep your seat.'}
        </div>
      )}

      {(me.state === 'active' || me.state === 'flagged_lurker') && (
        <div className="card stack">
          <h2>The feed arrives in Milestone 2</h2>
          <p className="muted">Nothing to read yet.</p>
          <div className="row"><Link className="btn" href="/settings">Settings</Link></div>
        </div>
      )}

      {(me.state === 'waitlisted' || me.state === 'archived') && (
        <div className="row"><Link href="/settings">Settings</Link></div>
      )}
    </div>
  );
}
