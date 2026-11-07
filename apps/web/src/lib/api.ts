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
  waitlist: { position: number; total: number; priority: 'reinstating' | 'new'; offeredUntil: string | null } | null;
  lurker: { flaggedAt: string; graceEndsAt: string; contributions: number; required: number } | null;
  archived: { reason: 'inactive' | 'lurker_grace_expired' | 'waitlist_decay' | string; wasMember: boolean } | null;
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

export type Author = { handle: string; displayName: string; state: UserState } | null;
export interface Image { id: string; url: string; width: number; height: number }
export interface Post {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  author: Author;
  parentId: string | null;
  rootId: string | null;
  replyCount: number;
  likeCount: number;
  likedByMe: boolean;
  images: Image[];
  canEdit: boolean;
  canDelete: boolean;
}
export interface MemberSummary {
  handle: string;
  displayName: string;
  bio: string;
  state: UserState;
  invitedBy: { handle: string } | null;
  activatedAt: string | null;
  postCount: number;
}
export interface Notification {
  id: string;
  kind: 'reply' | 'like' | string;
  createdAt: string;
  readAt: string | null;
  actor: { handle: string; displayName: string } | null;
  post: { id: string; rootId: string | null; snippet: string } | null;
}
export interface Page<T> { items: T[]; nextCursor: string | null }
export type NotificationPage = Page<Notification> & { unreadCount: number };
export interface Thread { root: Post; replies: Post[]; focusId: string | null }

/** Local copies of the shared limits (to move to @anti/shared). */
import { POST_MAX_CHARS, POST_MAX_IMAGES, IMAGE_MAX_BYTES as SHARED_IMAGE_MAX_BYTES, EDIT_WINDOW_MINUTES } from '@anti/shared';
export const POST_MAX = POST_MAX_CHARS;
export const IMAGES_MAX = POST_MAX_IMAGES;
export const IMAGE_MAX_BYTES = SHARED_IMAGE_MAX_BYTES;
export const EDIT_WINDOW_MS = EDIT_WINDOW_MINUTES * 60 * 1000;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined || isForm ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
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

  feed: (cursor?: string | null, limit = 20) => get<Page<Post>>(`/feed${qs({ cursor, limit })}`),
  createPost: (b: { body: string; parentId?: string; imageIds?: string[] }) => post<Post>('/posts', b),
  thread: (id: string) => get<Thread>(`/posts/${encodeURIComponent(id)}`),
  editPost: (id: string, body: string) => call<Post>('PATCH', `/posts/${encodeURIComponent(id)}`, { body }),
  deletePost: (id: string) => call<{ ok: true }>('DELETE', `/posts/${encodeURIComponent(id)}`),
  like: (id: string) => post<{ likeCount: number; likedByMe: boolean }>(`/posts/${encodeURIComponent(id)}/like`, {}),
  unlike: (id: string) => call<{ likeCount: number; likedByMe: boolean }>('DELETE', `/posts/${encodeURIComponent(id)}/like`),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return call<Image>('POST', '/uploads', fd);
  },
  search: (q: string) => get<{ members: MemberSummary[]; posts: Post[] }>(`/search${qs({ q })}`),
  members: (cursor?: string | null, limit = 30) => get<Page<MemberSummary>>(`/members${qs({ cursor, limit })}`),
  member: (handle: string) => get<MemberSummary>(`/members/${encodeURIComponent(handle)}`),
  memberPosts: (handle: string, cursor?: string | null, limit = 20) =>
    get<Page<Post>>(`/members/${encodeURIComponent(handle)}/posts${qs({ cursor, limit })}`),
  notifications: (cursor?: string | null, limit = 30) => get<NotificationPage>(`/notifications${qs({ cursor, limit })}`),
  unreadCount: () => get<{ unreadCount: number }>('/notifications/unread-count'),
  markRead: (ids?: string[]) => post<{ ok: true; unreadCount: number }>('/notifications/read', ids ? { ids } : {}),
};

function qs(params: Record<string, string | number | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

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
  cursor_invalid: 'Could not load more. Refresh the page.',
  registration_failed: 'Passkey registration could not be verified. Please try again.',
  body_invalid: 'A post must be 1 to 500 characters.',
  parent_not_found: 'The post you are replying to no longer exists.',
  image_invalid: 'One of the images could not be used. Remove it and try again.',
  rate_limited: 'You are doing that too fast. Wait a moment and try again.',
  not_author: 'Only the author can do that.',
  edit_window_closed: 'The edit window for this post has closed.',
  image_too_large: 'That image is larger than 5 MB.',
  image_unsupported: 'That image type is not supported.',
  query_invalid: 'Enter a longer search.',
  not_found: 'Not found.',
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
