import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { rows, scalar, type Db } from '@anti/db';
import { ApiError } from './errors';
import type { PaymentProvider, WebhookEvent } from './payments';

export const PRODUCTS = {
  stay_fee_90d: 'Stay fee (90-day lurker exemption)',
  reinstatement: 'Reinstatement',
} as const;
export type ProductKey = keyof typeof PRODUCTS;
export const isProductKey = (k: string): k is ProductKey => k in PRODUCTS;

const MIN = 60_000;
/** Stripe accepts Checkout expiry between 30 minutes and 24 hours from now. */
const CHECKOUT_MIN_MS = 30 * MIN;
const CHECKOUT_MAX_MS = 24 * 60 * MIN;
const STAY_FEE_CHECKOUT_MS = 60 * MIN;

type UserRow = { id: string; state: string };

/** Eligibility (RFC §9) → Checkout Session → `payments` row (pending). Returns the redirect URL. */
export async function startCheckout(
  db: Db, provider: PaymentProvider, webOrigin: string, user: UserRow, productKey: string,
): Promise<{ url: string; paymentId: string }> {
  if (!isProductKey(productKey)) throw new ApiError(404, 'product_unavailable', 'Unknown product.');
  const [price] = await rows<{ amount_minor: number; currency: string }>(db, sql`
    select amount_minor, currency from pricing where product_key = ${productKey} and active`);
  if (!price) throw new ApiError(404, 'product_unavailable', 'This product is not for sale right now.');

  const now = Date.now();
  let expiresAt: Date;
  if (productKey === 'stay_fee_90d') {
    if (user.state !== 'active' && user.state !== 'flagged_lurker') {
      throw new ApiError(409, 'stay_fee_not_applicable', 'The stay fee is only for members with a seat.');
    }
    expiresAt = new Date(now + STAY_FEE_CHECKOUT_MS);
  } else {
    const offer = await scalar<string>(db, sql`
      select offer_expires_at::text from waitlist
       where user_id = ${user.id}::uuid and offered_at is not null and offer_expires_at > now()`);
    if (!offer) throw new ApiError(409, 'no_open_offer', 'There is no seat being held for you.');
    // Never accept payment after the offer lapses; a payment that races the deadline is refunded.
    const until = new Date(offer).getTime();
    expiresAt = new Date(Math.max(now + CHECKOUT_MIN_MS, Math.min(until, now + CHECKOUT_MAX_MS)));
  }

  const paymentId = randomUUID();
  const session = await provider.createCheckout({
    paymentId, userId: user.id, productKey, productName: PRODUCTS[productKey],
    amountMinor: Number(price.amount_minor), currency: price.currency, expiresAt,
    successUrl: `${webOrigin}/?checkout=success`,
    cancelUrl: `${webOrigin}/?checkout=cancelled`,
  });
  await db.execute(sql`
    insert into payments(id, user_id, product_key, amount_minor, currency, stripe_checkout_session_id, status, expires_at)
    values (${paymentId}::uuid, ${user.id}::uuid, ${productKey}, ${Number(price.amount_minor)}, ${price.currency},
            ${session.id}, 'pending', ${expiresAt.toISOString()}::timestamptz)`);
  return { url: session.url, paymentId };
}

export type EventOutcome = 'duplicate' | 'applied' | 'refund' | 'expired' | 'ignored';

/**
 * Handles one verified webhook event exactly once (stripe_events PK). Refunds owed are
 * attempted right after the commit; failures stay `refund_pending` for the hourly retry.
 */
export async function processEvent(db: Db, provider: PaymentProvider, ev: WebhookEvent): Promise<EventOutcome> {
  const outcome = await db.transaction(async (txx): Promise<EventOutcome> => {
    const tx = txx as unknown as Db;
    const fresh = await rows(tx, sql`insert into stripe_events(id) values (${ev.id}) on conflict do nothing returning id`);
    if (!fresh.length) return 'duplicate';
    if (!ev.session) return 'ignored';

    if (ev.type === 'checkout.session.completed') {
      const known = await scalar<number>(tx, sql`
        select count(*)::int from payments where stripe_checkout_session_id = ${ev.session.id}`);
      if (!known) return 'ignored'; // not ours (e.g. another app on the same Stripe account)
      const r = await scalar<string>(tx, sql`select complete_payment(${ev.session.id}, ${ev.session.paymentIntent})`);
      return r === 'applied' ? 'applied' : r === 'refund' ? 'refund' : 'duplicate';
    }
    if (ev.type === 'checkout.session.expired') {
      await tx.execute(sql`update payments set status = 'expired'
                            where stripe_checkout_session_id = ${ev.session.id} and status = 'pending'`);
      return 'expired';
    }
    return 'ignored';
  });
  if (outcome === 'refund') await processRefunds(db, provider).catch((e) => console.error('refund failed', e));
  return outcome;
}

/** Issues refunds for `refund_pending` payments. Safe to run concurrently (row locks + Stripe idempotency). */
export async function processRefunds(db: Db, provider: PaymentProvider): Promise<{ refunded: number; failed: number }> {
  let done = 0;
  const failed: string[] = [];
  for (;;) {
    const cur: { id: string | null } = { id: null }; // set inside the tx callback
    try {
      const handled = await db.transaction(async (txx) => {
        const tx = txx as unknown as Db;
        const skip = failed.length ? sql`and id not in (${sql.join(failed.map((f) => sql`${f}::uuid`), sql`, `)})` : sql``;
        const [p] = await rows<{ id: string; user_id: string | null; intent: string; reason: string | null }>(tx, sql`
          select id, user_id, stripe_payment_intent_id as intent, refund_reason as reason from payments
           where status = 'refund_pending' and stripe_payment_intent_id is not null ${skip}
           order by paid_at limit 1 for update skip locked`);
        if (!p) return false;
        cur.id = p.id;
        await provider.refund(p.intent, p.id); // throws → rollback, row stays refund_pending
        await tx.execute(sql`update payments set status = 'refunded', refunded_at = now() where id = ${p.id}::uuid`);
        if (p.user_id) {
          await tx.execute(sql`insert into notifications(user_id, kind, payload)
            values (${p.user_id}::uuid, 'payment_refunded', ${JSON.stringify({ paymentId: p.id, reason: p.reason })}::jsonb)`);
        }
        return true;
      });
      if (!handled) break;
      done++;
    } catch (e) {
      if (!cur.id) throw e;
      console.error('refund failed; will retry', cur.id, e);
      failed.push(cur.id);
    }
  }
  return { refunded: done, failed: failed.length };
}

/** Pending checkouts well past their expiry (missed `expired` webhook) → expired. */
export async function expireStaleCheckouts(db: Db): Promise<number> {
  const r = await rows(db, sql`
    update payments set status = 'expired'
     where status = 'pending' and expires_at < now() - interval '1 hour' returning id`);
  return r.length;
}
