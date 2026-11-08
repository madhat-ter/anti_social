import { api, type Interest } from './api';

/** The interest list (RFC §10.5), fetched once per page load and shared. */
let cache: Promise<Interest[]> | null = null;
export function interestsCached(fresh = false): Promise<Interest[]> {
  if (!cache || fresh) cache = api.interests().then((r) => r.items).catch((e) => { cache = null; throw e; });
  return cache;
}