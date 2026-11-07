export type UserState = 'waitlisted' | 'active' | 'flagged_lurker' | 'archived' | 'banned' | 'deleted';

export interface Me {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  state: UserState;
  invitedBy: { handle: string } | null;
  activatedAt: string | null;
  lastSeenAt: string | null;
  lurkerExemptUntil: string | null;
  waitlist: { position: number; offeredUntil: string | null } | null;
  lurker: { flaggedAt: string; graceEndsAt: string } | null;
}

export interface PasskeyInfo { id: string; deviceLabel: string | null; createdAt: string; lastUsedAt: string | null }
export interface InviteInfo {
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  redeemedBy: { handle: string } | null;
  status: 'open' | 'redeemed' | 'expired' | 'revoked';
}

export interface Challenge<O = unknown> { challengeId: string; options: O }

export class ApiError extends Error {
  constructor(public status: number, public error: string, public detail?: string) {
    super(detail ?? error);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server.');
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'unknown', data?.detail);
  return data as T;
}

const get = <T,>(p: string) => call<T>('GET', p);
const post = <T,>(p: string, b: unknown = {}) => call<T>('POST', p, b);

export const api = {
  me: () => get<Me>('/me'),
  updateMe: (b: { displayName?: string; bio?: string }) => call<Me>('PATCH', '/me', b),
  deleteMe: () => call<{ ok: true }>('DELETE', '/me'),
  checkInvite: (code: string) => post<{ valid: boolean; wouldWaitlist: boolean }>('/invites/check', { code }),
  registerOptions: (b: { code: string; handle: string; displayName: string }) => post<Challenge>('/auth/register/options', b),
  registerVerify: (b: { challengeId: string; response: unknown }) =>
    post<{ state: UserState; recoveryCode: string }>('/auth/register/verify', b),
  loginOptions: () => post<Challenge>('/auth/login/options', {}),
  loginVerify: (b: { challengeId: string; response: unknown }) => post<{ state: UserState }>('/auth/login/verify', b),
  recoverOptions: (b: { handle: string; recoveryCode: string }) => post<Challenge>('/auth/recover/options', b),
  recoverVerify: (b: { challengeId: string; response: unknown }) => post<{ recoveryCode: string }>('/auth/recover/verify', b),
  logout: () => post<{ ok: true }>('/auth/logout', {}),
  passkeys: () => get<PasskeyInfo[]>('/me/passkeys'),
  passkeyOptions: () => post<Challenge>('/me/passkeys/options', {}),
  passkeyVerify: (b: { challengeId: string; response: unknown; deviceLabel?: string }) => post<{ id: string }>('/me/passkeys/verify', b),
  deletePasskey: (id: string) => call<{ ok: true }>('DELETE', `/me/passkeys/${encodeURIComponent(id)}`),
  invites: () => get<InviteInfo[]>('/me/invites'),
  createInvite: () => post<{ code: string; expiresAt: string }>('/me/invites', {}),
  rejoin: () => post<{ ok: true }>('/me/waitlist/rejoin', {}),
};

const MESSAGES: Record<string, string> = {
  network: 'Could not reach the server. Check your connection and try again.',
  unauthenticated: 'You are signed out. Please sign in again.',
  no_seat: 'You need a seat to do that.',
  bad_origin: 'Request blocked. Reload the page and try again.',
  invite_invalid: 'That invite code is not valid, or has already been used.',
  handle_invalid: 'That handle is not allowed.',
  handle_taken: 'That handle is taken.',
  passkey_invalid: 'That passkey was not recognised.',
  account_unavailable: 'This account is unavailable.',
  recovery_failed: 'Handle or recovery code is incorrect.',
  last_passkey: 'You cannot remove your last passkey. Add another first.',
  invite_limit: 'You have reached your invite limit.',
  invite_penalty: 'You cannot create invites right now.',
  invite_not_allowed_state: 'Your account cannot create invites right now.',
  rejoin_not_applicable: 'Rejoining the queue does not apply to your account.',
  challenge_invalid: 'That attempt expired. Please start again.',
  registration_failed: 'Passkey registration could not be verified. Please try again.',
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return MESSAGES[e.error] ?? e.detail ?? `Something went wrong (${e.error}).`;
  if (e instanceof Error) {
    if (e.name === 'NotAllowedError' || e.name === 'AbortError') return 'Passkey prompt was cancelled. Try again when ready.';
    if (e.name === 'InvalidStateError') return 'This device already has a passkey for this account.';
    return e.message;
  }
  return 'Something went wrong.';
}
