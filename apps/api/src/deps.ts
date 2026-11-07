import type { Db } from '@anti/db';
import type { Config } from './config';
import type { Storage } from './lib/storage';

export type Deps = { db: Db; cfg: Config; storage: Storage };
