import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { JOBS, runJob } from '../src/lib/jobs';
import { signPayload } from '../src/lib/payments';
import { cleanup, setup, ORIGIN, type Client } from './client';

afterEach(cleanup);

async function world(seatCap = 3) {
  const w = await setup({ seatCap });
  const rowsOf = async (q: ReturnType<typeof sql>) => ((await w.t.db.execute(q)) as any).rows as any[];
  const member = async (handle: string) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle)).status).toBe(200);
    return c;
  };
  const job = (name: string) => runJob(w.t.db, JOBS.find((j) => j.name === name)!, { storage: w.storage, payments: w.payments });
  const flagLurker = async (handle: string) => {
    await w.t.db.execute(sql`update users set activated_at = now() - interval '40 days', last_seen_at = now(),
      last_seen_on = current_date where handle = ${handle}`);
    await w.t.db.execute(sql`insert into user_seen_days(user_id, day)
      select id, current_date - g from users, generate_series(0, 9) g where handle = ${handle} on conflict do nothing`);
    await job('lifecycle');
  };
  /** alice archived for inactivity, then rejoins; the seat she freed is held for her (72 h, pay to take). */
  const offerForAlice = async () => {
    const alice = await member('alice');
    const bob = await member('bob');
    await w.t.db.execute(sql`update users set activated_at = now() - interval '60 days',
      last_seen_at = now() - interval '31 days', last_seen_on = current_date - 31 where handle = 'alice'`);
    await job('lifecycle');
    expect((await alice.post('/me/waitlist/rejoin')).status).toBe(200);
    await bob.del('/me');
    expect((await alice.get('/me')).body.waitlist.offeredUntil).toBeString();
    return alice;
  };
  return { ...w, rowsOf, member, job, flagLurker, offerForAlice };
}

const sessionOf = (url: string) => new URL(url).searchParams.get('session')!;

async function checkout(c: Client, productKey: string) {
  const r = await c.post('/payments/checkout', { productKey });
  expect(r.status).toBe(200);
  expect(r.body.url).toStartWith(`${ORIGIN}/dev/checkout?session=cs_fake_`);
  return sessionOf(r.body.url);
}

const pay = (c: Client, session: string) => c.post(`/dev/fake-checkout/${session}/pay`);

describe('checkout', () => {
  test('pricing lists both products; eligibility is enforced', async () => {
    const w = await world(1);
    const a = await w.member('alice');
    expect((await a.get('/pricing')).body).toEqual([
      { productKey: 'reinstatement', name: 'Reinstatement', amountMinor: 1000, currency: 'usd' },
      { productKey: 'stay_fee_90d', name: 'Stay fee (90-day lurker exemption)', amountMinor: 500, currency: 'usd' },
    ]);
    expect((await a.post('/payments/checkout', { productKey: 'nope' })).body.error).toBe('product_unavailable');
    expect((await a.post('/payments/checkout', { productKey: 'reinstatement' })).body.error).toBe('no_open_offer');

    const b = w.client();
    await b.register(await w.mint(), 'bob'); // waitlisted
    expect((await b.post('/payments/checkout', { productKey: 'stay_fee_90d' })).body.error).toBe('stay_fee_not_applicable');

    await w.t.db.execute(sql`update pricing set active = false where product_key = 'stay_fee_90d'`);
    expect((await a.post('/payments/checkout', { productKey: 'stay_fee_90d' })).body.error).toBe('product_unavailable');
    expect((await w.client().post('/payments/checkout', { productKey: 'stay_fee_90d' })).status).toBe(401);
  });

  test('the fake checkout page shows only your own session', async () => {
    const w = await world();
    const a = await w.member('alice');
    const b = await w.member('bob');
    const s = await checkout(a, 'stay_fee_90d');
    expect((await a.get(`/dev/fake-checkout/${s}`)).body).toMatchObject({
      productKey: 'stay_fee_90d', amountMinor: 500, currency: 'usd', status: 'pending',
      successUrl: `${ORIGIN}/?checkout=success`,
    });
    expect((await b.get(`/dev/fake-checkout/${s}`)).status).toBe(404);
    expect((await b.post(`/dev/fake-checkout/${s}/pay`)).status).toBe(404);
  });
});

describe('stay fee', () => {
  test('flagged lurker pays → active, exempt for 90 days, not re-flagged', async () => {
    const w = await world();
    const a = await w.member('alice');
    await w.flagLurker('alice');
    expect((await a.get('/me')).body.state).toBe('flagged_lurker');

    const s = await checkout(a, 'stay_fee_90d');
    expect((await pay(a, s)).body.outcome).toBe('applied');

    const me = (await a.get('/me')).body;
    expect(me.state).toBe('active');
    const days = (new Date(me.lurkerExemptUntil).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThanOrEqual(90);

    await w.job('lifecycle');
    expect((await a.get('/me')).body.state).toBe('active');

    const hist = (await a.get('/me/payments')).body;
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ productKey: 'stay_fee_90d', amountMinor: 500, status: 'paid' });
    expect((await a.get('/notifications')).body.items[0].kind).toBe('stay_fee_paid');
    expect((await pay(a, s)).body.error).toBe('checkout_closed'); // can't pay twice
  });
});

describe('reinstatement', () => {
  test('held seat + payment → active again, seat count unchanged', async () => {
    const w = await world(2);
    const alice = await w.offerForAlice();
    const s = await checkout(alice, 'reinstatement');
    // the checkout never outlives the held seat
    const [p] = await w.rowsOf(sql`select expires_at <= (select offer_expires_at from waitlist) as ok from payments`);
    expect(p.ok).toBe(true);

    const seats = async () => (await w.rowsOf(sql`select seats_used() as n`))[0].n;
    const before = await seats(); // the held offer already counts as a used seat
    expect((await pay(alice, s)).body.outcome).toBe('applied');
    const me = (await alice.get('/me')).body;
    expect(me.state).toBe('active');
    expect(me.waitlist).toBeNull();
    expect(await seats()).toBe(before); // paying converts the held seat; it doesn't take another
    expect((await alice.get('/notifications')).body.items[0].kind).toBe('reinstated');
  });

  test('payment that lands after the offer lapsed is refunded automatically', async () => {
    const w = await world(2);
    const alice = await w.offerForAlice();
    const s = await checkout(alice, 'reinstatement');
    await w.t.db.execute(sql`update waitlist set offer_expires_at = now() - interval '1 second'`);

    expect((await pay(alice, s)).body.outcome).toBe('refund');
    expect((await alice.get('/me')).body.state).toBe('archived');
    expect(w.payments.refunds).toHaveLength(1);
    const [row] = await w.rowsOf(sql`select status, refund_reason, refunded_at is not null as done from payments`);
    expect(row).toEqual({ status: 'refunded', refund_reason: 'no_open_offer', done: true });
    expect((await alice.get('/notifications')).body.items[0].kind).toBe('payment_refunded');
  });

  test('a failed refund stays pending and the hourly payments job retries it', async () => {
    const w = await world(2);
    const alice = await w.offerForAlice();
    const s = await checkout(alice, 'reinstatement');
    await w.t.db.execute(sql`update waitlist set offer_expires_at = now() - interval '1 second'`);
    w.payments.failRefunds = true;
    expect((await pay(alice, s)).body.outcome).toBe('refund');
    expect((await w.rowsOf(sql`select status from payments`))[0].status).toBe('refund_pending');

    expect((await w.job('payments'))).toEqual({ status: 'ran', result: { expired: 0, refunded: 0, failed: 1 } });
    w.payments.failRefunds = false;
    expect((await w.job('payments'))).toEqual({ status: 'ran', result: { expired: 0, refunded: 1, failed: 0 } });
    expect((await w.rowsOf(sql`select status from payments`))[0].status).toBe('refunded');
  });
});

describe('StripeProvider (against a mock Stripe API)', () => {
  test('sends the Checkout and Refund requests Stripe expects', async () => {
    const seen: { path: string; auth: string | null; idem: string | null; form: Record<string, string> }[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const form = Object.fromEntries(new URLSearchParams(await req.text()));
        const path = new URL(req.url).pathname;
        seen.push({ path, auth: req.headers.get('authorization'), idem: req.headers.get('idempotency-key'), form });
        return Response.json(path.endsWith('/checkout/sessions') ? { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/cs_test_1' } : { id: 're_1' });
      },
    });
    try {
      const { StripeProvider } = await import('../src/lib/payments');
      const p = new StripeProvider('sk_test_x', 'whsec_x', `http://localhost:${server.port}/v1`);
      const expiresAt = new Date('2030-01-01T00:00:00Z');
      expect(await p.createCheckout({
        paymentId: 'pay-1', userId: 'user-1', productKey: 'reinstatement', productName: 'Reinstatement',
        amountMinor: 1000, currency: 'usd', expiresAt, successUrl: 'https://x/ok', cancelUrl: 'https://x/no',
      })).toEqual({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/cs_test_1' });
      await p.refund('pi_1', 'pay-1');

      expect(seen[0]).toEqual({
        path: '/v1/checkout/sessions', auth: 'Bearer sk_test_x', idem: 'checkout-pay-1',
        form: {
          mode: 'payment', 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][unit_amount]': '1000', 'line_items[0][price_data][product_data][name]': 'Reinstatement',
          client_reference_id: 'user-1', 'metadata[payment_id]': 'pay-1', 'metadata[product_key]': 'reinstatement',
          expires_at: String(expiresAt.getTime() / 1000), success_url: 'https://x/ok', cancel_url: 'https://x/no',
        },
      });
      expect(seen[1]).toEqual({ path: '/v1/refunds', auth: 'Bearer sk_test_x', idem: 'refund-pay-1', form: { payment_intent: 'pi_1' } });

      // and it verifies Stripe-format webhook signatures
      const raw = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed',
        data: { object: { object: 'checkout.session', id: 'cs_test_1', payment_intent: 'pi_1' } } });
      expect(p.verifyWebhook(raw, signPayload('whsec_x', raw))).toEqual({
        id: 'evt_1', type: 'checkout.session.completed', session: { id: 'cs_test_1', paymentIntent: 'pi_1' },
      });
      expect(() => p.verifyWebhook(raw, signPayload('whsec_other', raw))).toThrow();
    } finally {
      server.stop(true);
    }
  });
});

describe('webhook', () => {
  test('signed events are processed once; bad or stale signatures are rejected', async () => {
    const w = await world();
    const a = await w.member('alice');
    const s = await checkout(a, 'stay_fee_90d');
    const ev = w.payments.event('checkout.session.completed', s);
    const send = (raw: string, sig: string) =>
      w.client().raw('POST', '/webhooks/stripe', raw, { 'content-type': 'application/json', 'stripe-signature': sig })
        .then(async (r) => ({ status: r.status, body: await r.json() as any }));

    expect(await send(ev.raw, signPayload('whsec_wrong', ev.raw))).toMatchObject({ status: 400, body: { error: 'bad_signature' } });
    expect((await send(ev.raw, signPayload(w.payments.webhookSecret, ev.raw, Math.floor(Date.now() / 1000) - 600))).status).toBe(400);
    expect((await send(ev.raw.replace('}', ',"x":1}'), ev.signature)).status).toBe(400); // body tampered
    expect((await send(ev.raw, ''))).toMatchObject({ status: 400 });

    expect((await send(ev.raw, ev.signature)).body).toEqual({ received: true, outcome: 'applied' });
    expect((await send(ev.raw, ev.signature)).body.outcome).toBe('duplicate'); // replay
    const other = w.payments.event('checkout.session.completed', 'cs_not_ours');
    expect((await send(other.raw, other.signature)).body.outcome).toBe('ignored');
  });

  test('expired checkout cannot be paid; stale pending checkouts are swept', async () => {
    const w = await world();
    const a = await w.member('alice');
    const s = await checkout(a, 'stay_fee_90d');
    expect((await a.post(`/dev/fake-checkout/${s}/expire`)).body.outcome).toBe('expired');
    expect((await pay(a, s)).body.error).toBe('checkout_closed');

    const s2 = await checkout(a, 'stay_fee_90d');
    await w.t.db.execute(sql`update payments set expires_at = now() - interval '2 hours' where stripe_checkout_session_id = ${s2}`);
    expect((await w.job('payments'))).toEqual({ status: 'ran', result: { expired: 1, refunded: 0, failed: 0 } });
    expect((await a.get('/me/payments')).body).toEqual([]); // expired checkouts are not history
  });

  test('payment completing after the account was deleted is refunded', async () => {
    const w = await world();
    const a = await w.member('alice');
    const s = await checkout(a, 'stay_fee_90d');
    await a.del('/me');
    const ev = w.payments.event('checkout.session.completed', s);
    const r = await w.client().raw('POST', '/webhooks/stripe', ev.raw, { 'content-type': 'application/json', 'stripe-signature': ev.signature });
    expect(((await r.json()) as any).outcome).toBe('refund');
    expect((await w.rowsOf(sql`select status, refund_reason from payments`))[0]).toEqual({ status: 'refunded', refund_reason: 'account_deleted' });
  });
});
