import { FakeStripeProvider, StripeProvider, type PaymentProvider } from './lib/payments';

export type Config = {
  rpId: string;
  rpName: string;
  webOrigin: string;
  cookieSecure: boolean;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  return {
    rpId: need('RP_ID'),
    rpName: env.RP_NAME ?? 'Anti',
    webOrigin: need('WEB_ORIGIN'),
    cookieSecure: env.COOKIE_SECURE !== 'false',
  };
}

/**
 * PAYMENTS=stripe needs STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET. PAYMENTS=fake (the default
 * when no Stripe key is set) uses the built-in fake checkout and is refused in production.
 */
export function loadPaymentProvider(cfg: Config, env: Record<string, string | undefined> = process.env): PaymentProvider {
  const mode = env.PAYMENTS ?? (env.STRIPE_SECRET_KEY ? 'stripe' : 'fake');
  if (mode === 'stripe') {
    const key = env.STRIPE_SECRET_KEY, secret = env.STRIPE_WEBHOOK_SECRET;
    if (!key || !secret) throw new Error('PAYMENTS=stripe needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET');
    return new StripeProvider(key, secret);
  }
  if (mode !== 'fake') throw new Error(`PAYMENTS must be 'stripe' or 'fake', got '${mode}'`);
  if (env.NODE_ENV === 'production') throw new Error('The fake payment provider cannot run in production');
  return new FakeStripeProvider(cfg.webOrigin);
}
