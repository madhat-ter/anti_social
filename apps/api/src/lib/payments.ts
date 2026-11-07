import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Payment provider boundary (RFC-0001 §9). The API only talks to this interface:
 * `StripeProvider` in production, `FakeStripeProvider` for local dev and tests.
 * Both use Stripe's webhook signature scheme, so the webhook path is identical.
 */
export interface CheckoutRequest {
  paymentId: string;
  userId: string;
  productKey: string;
  productName: string;
  amountMinor: number;
  currency: string;
  expiresAt: Date;
  successUrl: string;
  cancelUrl: string;
}

export interface WebhookEvent {
  id: string;
  type: string;
  session: { id: string; paymentIntent: string | null } | null;
}

export interface PaymentProvider {
  readonly kind: 'stripe' | 'fake';
  createCheckout(r: CheckoutRequest): Promise<{ id: string; url: string }>;
  /** Idempotent per paymentId (Stripe Idempotency-Key). */
  refund(paymentIntentId: string, paymentId: string): Promise<void>;
  /** Verifies the `Stripe-Signature` header; throws WebhookSignatureError. */
  verifyWebhook(rawBody: string, signature: string | null): WebhookEvent;
}

export class WebhookSignatureError extends Error {}

const TOLERANCE_S = 300;

export function signPayload(secret: string, payload: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

export function verifySignature(secret: string, payload: string, header: string | null, now = Date.now()): void {
  if (!header) throw new WebhookSignatureError('missing signature');
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length) throw new WebhookSignatureError('malformed signature');
  if (Math.abs(now / 1000 - t) > TOLERANCE_S) throw new WebhookSignatureError('signature too old');
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex'));
  const ok = sigs.some((s) => {
    const b = Buffer.from(s);
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
  if (!ok) throw new WebhookSignatureError('bad signature');
}

function toEvent(raw: string): WebhookEvent {
  let e: any;
  try { e = JSON.parse(raw); } catch { throw new WebhookSignatureError('invalid json'); }
  if (typeof e?.id !== 'string' || typeof e?.type !== 'string') throw new WebhookSignatureError('invalid event');
  const o = e.data?.object;
  const session = o?.object === 'checkout.session' && typeof o.id === 'string'
    ? { id: o.id as string, paymentIntent: typeof o.payment_intent === 'string' ? o.payment_intent : null }
    : null;
  return { id: e.id, type: e.type, session };
}

// ─── Real Stripe (REST over fetch; no SDK) ──────────────────────────────────

export class StripeProvider implements PaymentProvider {
  readonly kind = 'stripe' as const;
  constructor(private secretKey: string, private webhookSecret: string, private api = 'https://api.stripe.com/v1') {}

  private async post(path: string, form: Record<string, string>, idempotencyKey?: string) {
    const res = await fetch(`${this.api}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: new URLSearchParams(form),
    });
    const body = (await res.json()) as any;
    if (!res.ok) throw new Error(`stripe ${path} ${res.status}: ${body?.error?.message ?? 'error'}`);
    return body;
  }

  async createCheckout(r: CheckoutRequest) {
    const s = await this.post('/checkout/sessions', {
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': r.currency,
      'line_items[0][price_data][unit_amount]': String(r.amountMinor),
      'line_items[0][price_data][product_data][name]': r.productName,
      client_reference_id: r.userId,
      'metadata[payment_id]': r.paymentId,
      'metadata[product_key]': r.productKey,
      expires_at: String(Math.floor(r.expiresAt.getTime() / 1000)),
      success_url: r.successUrl,
      cancel_url: r.cancelUrl,
    }, `checkout-${r.paymentId}`);
    return { id: s.id as string, url: s.url as string };
  }

  async refund(paymentIntentId: string, paymentId: string) {
    await this.post('/refunds', { payment_intent: paymentIntentId }, `refund-${paymentId}`);
  }

  verifyWebhook(rawBody: string, signature: string | null) {
    verifySignature(this.webhookSecret, rawBody, signature);
    return toEvent(rawBody);
  }
}

// ─── Fake Stripe for local dev and tests ────────────────────────────────────

export const FAKE_WEBHOOK_SECRET = 'whsec_fake_local_dev';

export class FakeStripeProvider implements PaymentProvider {
  readonly kind = 'fake' as const;
  readonly refunds: { paymentIntentId: string; paymentId: string }[] = [];
  /** Set to make the next refund call throw (tests). */
  failRefunds = false;

  constructor(private webOrigin: string, readonly webhookSecret = FAKE_WEBHOOK_SECRET) {}

  async createCheckout(_r: CheckoutRequest) {
    const id = `cs_fake_${randomBytes(12).toString('hex')}`;
    return { id, url: `${this.webOrigin}/dev/checkout?session=${id}` };
  }

  async refund(paymentIntentId: string, paymentId: string) {
    if (this.failRefunds) throw new Error('fake refund failure');
    if (!this.refunds.some((r) => r.paymentId === paymentId)) this.refunds.push({ paymentIntentId, paymentId });
  }

  verifyWebhook(rawBody: string, signature: string | null) {
    verifySignature(this.webhookSecret, rawBody, signature);
    return toEvent(rawBody);
  }

  /** Builds a signed Stripe-shaped event, as Stripe would POST it to the webhook. */
  event(type: 'checkout.session.completed' | 'checkout.session.expired', sessionId: string) {
    const raw = JSON.stringify({
      id: `evt_fake_${randomBytes(12).toString('hex')}`,
      object: 'event',
      type,
      data: {
        object: {
          object: 'checkout.session', id: sessionId,
          payment_intent: type === 'checkout.session.completed' ? `pi_fake_${randomBytes(12).toString('hex')}` : null,
        },
      },
    });
    return { raw, signature: signPayload(this.webhookSecret, raw) };
  }
}
