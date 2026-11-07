'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage, formatMoney, type Price, type ProductKey } from '@/lib/api';
import { ErrorNote } from './ui';

let pricingCache: Promise<Price[]> | null = null;
/** Active prices, fetched once per page load. */
export function usePrice(productKey: ProductKey): Price | null {
  const [price, setPrice] = useState<Price | null>(null);
  useEffect(() => {
    let alive = true;
    pricingCache ??= api.pricing().catch((e) => { pricingCache = null; throw e; });
    pricingCache.then((all) => { if (alive) setPrice(all.find((p) => p.productKey === productKey) ?? null); }, () => {});
    return () => { alive = false; };
  }, [productKey]);
  return price;
}

/** Starts Stripe Checkout (or the dev fake) and leaves the page. `label` gets the price appended. */
export function PayButton({ productKey, label, primary = false }: { productKey: ProductKey; label: string; primary?: boolean }) {
  const price = usePrice(productKey);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    try {
      const { url } = await api.checkout(productKey);
      window.location.assign(url);
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className={primary ? 'btn primary' : 'btn'} onClick={go} disabled={busy || !price}>
        {busy ? 'Opening checkout...' : price ? `${label} (${formatMoney(price.amountMinor, price.currency)})` : label}
      </button>
      <ErrorNote message={err} />
    </>
  );
}

/**
 * Shown after returning from checkout (?checkout=success|cancelled). Stripe confirms by webhook,
 * which can land a moment after the redirect, so on success we refresh /me a few times.
 */
export function CheckoutNotice({ refresh }: { refresh?: () => Promise<void> }) {
  const [kind, setKind] = useState<'success' | 'cancelled' | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const k = url.searchParams.get('checkout');
    if (k !== 'success' && k !== 'cancelled') return;
    setKind(k);
    url.searchParams.delete('checkout');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    if (k === 'success' && refresh) {
      const timers = [1500, 4000, 9000].map((ms) => setTimeout(() => void refresh(), ms));
      return () => timers.forEach(clearTimeout);
    }
  }, [refresh]);
  if (!kind) return null;
  return (
    <div className="banner notice row between" role="status">
      <span>{kind === 'success' ? 'Payment received. Thank you.' : 'Checkout cancelled. You have not been charged.'}</span>
      <button type="button" className="btn" onClick={() => setKind(null)}>Dismiss</button>
    </div>
  );
}
