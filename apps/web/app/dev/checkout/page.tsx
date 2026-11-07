'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errorMessage, formatMoney, type FakeCheckout } from '@/lib/api';
import { fmtDate } from '@/lib/hooks';
import { ErrorNote } from '@/components/ui';

/**
 * Local stand-in for Stripe's hosted Checkout page (API running with PAYMENTS=fake).
 * "Pay" makes the API send itself a signed `checkout.session.completed` webhook, so the
 * same code path runs as with real Stripe. With real Stripe this route is never linked.
 */
export default function FakeCheckoutPage() {
  const [session, setSession] = useState<string | null>(null);
  const [co, setCo] = useState<FakeCheckout | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('session');
    setSession(s);
    if (!s) { setErr('No checkout session in the link.'); return; }
    api.fakeCheckout(s).then(setCo, (e) => setErr(errorMessage(e)));
  }, []);

  async function act(action: 'pay' | 'expire') {
    if (!session || !co) return;
    setBusy(true); setErr(null);
    try {
      await api.fakeCheckoutAction(session, action);
      window.location.assign(action === 'pay' ? co.successUrl : co.cancelUrl);
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="stack fake-checkout">
      <div className="test-ribbon" role="note">Test checkout. No real money moves. This page stands in for Stripe while payments run in fake mode.</div>
      {!co && !err && <p className="muted">Loading checkout...</p>}
      <ErrorNote message={err} />
      {co && (
        <div className="card stack">
          <p className="muted small">Pay anti</p>
          <h1>{formatMoney(co.amountMinor, co.currency)}</h1>
          <p>{co.productName}</p>
          {co.status === 'pending' ? (
            <>
              <label>Card number<input value="4242 4242 4242 4242" readOnly aria-readonly /></label>
              <div className="row">
                <label>Expiry<input value="12 / 34" readOnly aria-readonly size={8} /></label>
                <label>CVC<input value="123" readOnly aria-readonly size={5} /></label>
              </div>
              <p className="muted small">This checkout closes {fmtDate(co.expiresAt)}.</p>
              <div className="row">
                <button type="button" className="btn primary" onClick={() => act('pay')} disabled={busy}>
                  {busy ? 'Processing...' : `Pay ${formatMoney(co.amountMinor, co.currency)}`}
                </button>
                <a className="btn" href={co.cancelUrl}>Cancel</a>
                <button type="button" className="btn" onClick={() => act('expire')} disabled={busy} title="Simulates the checkout timing out">
                  Let it expire
                </button>
              </div>
            </>
          ) : (
            <p>This checkout is {co.status.replace('_', ' ')}. <Link href="/">Back to anti</Link></p>
          )}
        </div>
      )}
    </div>
  );
}
