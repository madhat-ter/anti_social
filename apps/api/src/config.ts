import { FakeStripeProvider, StripeProvider, type PaymentProvider } from './lib/payments';

export type Config = {
  rpId: string;
  rpName: string;
  webOrigin: string;
  cookieSecure: boolean;
  /** Read the client IP from the proxy header (Fly-Client-IP / X-Forwarded-For). Only behind a trusted proxy. */
  trustProxy?: boolean;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  const cfg: Config = {
    rpId: need('RP_ID'),
    rpName: env.RP_NAME ?? 'Anti',
    webOrigin: need('WEB_ORIGIN'),
    cookieSecure: env.COOKIE_SECURE !== 'false',
    trustProxy: env.TRUST_PROXY === 'true',
  };
  if (env.NODE_ENV === 'production') assertProductionSafe(cfg);
  return cfg;
}

/** Refuses to boot a production API with development settings. */
export function assertProductionSafe(cfg: Config) {
  const problems: string[] = [];
  if (!cfg.cookieSecure) problems.push('COOKIE_SECURE must not be false');
  if (!cfg.webOrigin.startsWith('https://')) problems.push('WEB_ORIGIN must be https://');
  if (cfg.rpId === 'localhost') problems.push('RP_ID must be the production domain');
  else if (!new URL(cfg.webOrigin).hostname.endsWith(cfg.rpId)) problems.push('RP_ID must be WEB_ORIGIN\'s domain (or a parent of it)');
  if (problems.length) throw new Error(`Unsafe production config: ${problems.join('; ')}`);
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
