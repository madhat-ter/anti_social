import { Elysia, t } from 'elysia';
import { sql } from 'drizzle-orm';
import { rows } from '@anti/db';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { PRODUCTS, processEvent, startCheckout } from '../lib/billing';
import { FakeStripeProvider, WebhookSignatureError } from '../lib/payments';
import { authPlugin, requireUser } from '../plugins/auth';

const iso = (col: string) => sql.raw(`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

export const paymentRoutes = (deps: Deps) => {
  const { db, cfg, payments } = deps;

  /** Shared by the real webhook and the fake checkout: verify the signature, then process once. */
  async function handleWebhook(raw: string, signature: string | null) {
    let ev;
    try {
      ev = payments.verifyWebhook(raw, signature);
    } catch (e) {
      if (e instanceof WebhookSignatureError) throw new ApiError(400, 'bad_signature', e.message);
      throw e;
    }
    return processEvent(db, payments, ev);
  }

  return new Elysia()
    .use(authPlugin(deps))

    .get('/pricing', async ({ auth }) => {
      requireUser(auth);
      const r = await rows<{ product_key: string; amount_minor: number; currency: string }>(db, sql`
        select product_key, amount_minor, currency from pricing where active order by product_key`);
      return r
        .filter((p) => p.product_key in PRODUCTS)
        .map((p) => ({
          productKey: p.product_key, name: PRODUCTS[p.product_key as keyof typeof PRODUCTS],
          amountMinor: Number(p.amount_minor), currency: p.currency,
        }));
    })

    .post('/payments/checkout', async ({ auth, body }) => {
      const a = requireUser(auth);
      const { url } = await startCheckout(db, payments, cfg.webOrigin, a.user, body.productKey);
      return { url };
    }, { body: t.Object({ productKey: t.String({ maxLength: 40 }) }) })

    .get('/me/payments', async ({ auth }) => {
      const a = requireUser(auth);
      const r = await rows<any>(db, sql`
        select id, product_key, amount_minor, currency, status, refund_reason,
               ${iso('created_at')} as created, ${iso('paid_at')} as paid, ${iso('refunded_at')} as refunded
          from payments where user_id = ${a.user.id}::uuid and status <> 'pending' and status <> 'expired'
         order by created_at desc limit 50`);
      return r.map((p) => ({
        id: p.id, productKey: p.product_key, amountMinor: Number(p.amount_minor), currency: p.currency,
        status: p.status, refundReason: p.refund_reason, createdAt: p.created, paidAt: p.paid, refundedAt: p.refunded,
      }));
    })

    // Stripe → us. Public; authenticated by the signature over the raw body.
    .post('/webhooks/stripe', async ({ request }) => {
      const outcome = await handleWebhook(await request.text(), request.headers.get('stripe-signature'));
      return { received: true, outcome };
    }, { parse: 'none' })

    .use(fakeCheckoutRoutes(deps, handleWebhook));
};

/** Dev-only fake checkout (PAYMENTS=fake). Stands in for Stripe's hosted page; absent with real Stripe. */
function fakeCheckoutRoutes(deps: Deps, handleWebhook: (raw: string, sig: string | null) => Promise<unknown>) {
  const { db, cfg, payments } = deps;
  if (!(payments instanceof FakeStripeProvider)) return new Elysia({ name: 'fake-checkout-off' });
  const fake = payments;
  {
    const ownSession = async (userId: string, sessionId: string) => {
      const [p] = await rows<any>(db, sql`
        select id, product_key, amount_minor, currency, status, ${iso('expires_at')} as expires
          from payments where stripe_checkout_session_id = ${sessionId} and user_id = ${userId}::uuid`);
      if (!p) throw new ApiError(404, 'payment_not_found', 'Unknown checkout session.');
      return p;
    };
    return new Elysia()
      .use(authPlugin(deps))
      .get('/dev/fake-checkout/:sessionId', async ({ auth, params }) => {
        const p = await ownSession(requireUser(auth).user.id, params.sessionId);
        return {
          sessionId: params.sessionId, productKey: p.product_key,
          productName: PRODUCTS[p.product_key as keyof typeof PRODUCTS] ?? p.product_key,
          amountMinor: Number(p.amount_minor), currency: p.currency, status: p.status, expiresAt: p.expires,
          successUrl: `${cfg.webOrigin}/?checkout=success`, cancelUrl: `${cfg.webOrigin}/?checkout=cancelled`,
        };
      })
      .post('/dev/fake-checkout/:sessionId/:action', async ({ auth, params }) => {
        const p = await ownSession(requireUser(auth).user.id, params.sessionId);
        if (params.action !== 'pay' && params.action !== 'expire') throw new ApiError(404, 'not_found');
        if (p.status !== 'pending') throw new ApiError(409, 'checkout_closed', 'This checkout is no longer open.');
        if (params.action === 'pay' && new Date(p.expires).getTime() <= Date.now()) {
          throw new ApiError(409, 'checkout_closed', 'This checkout has expired.');
        }
        const ev = fake.event(params.action === 'pay' ? 'checkout.session.completed' : 'checkout.session.expired', params.sessionId);
        const outcome = await handleWebhook(ev.raw, ev.signature);
        return { outcome };
      });
  }
}
