import type { Db } from '@anti/db';
import type { Config } from './config';
import type { PaymentProvider } from './lib/payments';
import type { Storage } from './lib/storage';
import type { PushSender } from './lib/push';

/** `push` defaults to disabled (no VAPID keys). */
export type Deps = { db: Db; cfg: Config; storage: Storage; payments: PaymentProvider; push?: PushSender };
