/**
 * The phone app's way to the API (RFC §10.32). The same endpoints the website uses, over HTTPS to
 * tryanti.social. The app has no cookie: on sign-in it sends `x-client: mobile`, the API answers
 * with `sessionToken`, and every request after that carries it as `Authorization: Bearer …`
 * (apps/api/src/plugins/auth.ts). The token sits in the phone's keychain (expo-secure-store).
 *
 * The types and the error words are the website's own (apps/web/src/lib/api.ts), imported, never
 * copied, so the two clients can't drift.
 */
import * as SecureStore from 'expo-secure-store';
import { ApiError, errorMessage } from '@web/lib/api';
import type {
  Me, Post, Page, FeedVisit, Thread, MemberSummary, NotificationPage, Gender, UserState, Image,
  CollabPageItem, Collab, EventDetail, MyCollab, AnEvent, Portfolio, Pick, CollabSummary, InviteInfo, MonologueKind,
} from '@web/lib/api';

export * from '@web/lib/api';
export { ApiError, errorMessage };

/** where the site lives; a local API for development goes in .env as EXPO_PUBLIC_SITE_URL */
export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL ?? 'https://tryanti.social').replace(/\/+$/, '');
const API_URL = `${SITE_URL}/api`;
const TOKEN_KEY = 'anti_session';

let token: string | null = null;
let onSignedOut: (() => void) | null = null;

export async function loadToken(): Promise<string | null> {
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token;
}
export function currentToken() { return token; }
async function saveToken(t: string | null) {
  token = t;
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}
/** the session layer listens, so a 401 anywhere sends the member back to sign-in */
export function setSignedOutHandler(fn: (() => void) | null) { onSignedOut = fn; }

/** media (photos, recordings) live behind sign-in: absolute URL plus the header to fetch it */
export function mediaSource(url: string): { uri: string; headers?: Record<string, string> } {
  const uri = url.startsWith('/api/') ? `${SITE_URL}${url}` : url.startsWith('/') ? `${API_URL}${url}` : url;
  return token && uri.startsWith(SITE_URL) ? { uri, headers: { Authorization: `Bearer ${token}` } } : { uri };
}

type FileLike = { uri: string; name: string; type: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const headers: Record<string, string> = { 'x-client': 'mobile', accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      credentials: 'omit',
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server.');
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error ?? 'unknown', data?.detail);
    if (res.status === 401 && token && !path.startsWith('/auth/')) { await saveToken(null); onSignedOut?.(); }
    throw err;
  }
  return data as T;
}

const get = <T,>(p: string) => call<T>('GET', p);
const post = <T,>(p: string, b: unknown = {}) => call<T>('POST', p, b);

function qs(params: Record<string, string | number | null | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}
const enc = encodeURIComponent;

/** sign-in answers carry the token only for `x-client: mobile`; keep it */
async function withSession<T extends { sessionToken?: string }>(p: Promise<T>): Promise<T> {
  const r = await p;
  if (r.sessionToken) await saveToken(r.sessionToken);
  return r;
}

export const api = {
  // ─── account (RFC §10.13: handle + 6-digit PIN) ───────────────────────────
  pinLogin: (b: { handle: string; pin: string }) =>
    withSession(post<{ state: UserState; sessionToken?: string }>('/auth/pin/login', b)),
  join: (b: { code: string; handle: string; displayName: string; pin: string }) =>
    withSession(post<{ state: UserState; recoveryCode: string; sessionToken?: string }>('/auth/join', b)),
  pinReset: (b: { handle: string; code: string; pin: string }) =>
    withSession(post<{ state: UserState; recoveryCode: string | null; sessionToken?: string }>('/auth/pin/reset', b)),
  logout: async () => {
    try { await post<{ ok: true }>('/auth/logout', {}); } finally { await saveToken(null); }
  },
  /** the session is gone on the server already (account closed): forget it here too */
  forget: () => saveToken(null),
  checkInvite: (code: string) => post<{ valid: boolean; wouldWaitlist: boolean }>('/invites/check', { code }),
  seatRequestsOpen: () => get<{ open: boolean }>('/public/seat-requests'),
  askForSeat: (b: { name: string; contact: string; note: string; website: string }) => post<{ ok: true }>('/public/seat-requests', b),

  me: () => get<Me>('/me'),
  updateMe: (b: { displayName?: string; bio?: string; gender?: Gender; birthdayPublic?: boolean; theme?: 'light' | 'dark'; feedOrder?: 'mixed' | 'newest' }) =>
    call<Me>('PATCH', '/me', b),
  setupState: () => get<{ about: string; gender: Gender | null; birthday: string | null; done: boolean; phone: string; email: string }>('/me/setup'),
  setup: (b: { about: string; gender: Gender; birthday: string; confirmUnderage?: boolean; phone?: string; email?: string }) =>
    call<Me | { closed: true }>('PUT', '/me/setup', b),
  setPin: (pin: string, currentPin?: string) => call<{ ok: true }>('PUT', '/me/pin', currentPin ? { pin, currentPin } : { pin }),
  deleteMe: () => call<{ ok: true }>('DELETE', '/me'),
  rejoin: () => post<{ ok: true }>('/me/waitlist/rejoin', {}),
  invites: () => get<InviteInfo[]>('/me/invites'),
  createInvite: () => post<{ code: string; expiresAt: string }>('/me/invites', {}),

  // ─── the feed (RFC §10.11, §10.23) and posts ──────────────────────────────
  feed: (cursor?: string | null, limit = 20, v: { visit?: boolean; since?: string; seed?: number; until?: string } = {}) =>
    get<Page<Post> & { visit?: FeedVisit }>(`/feed${qs({ cursor, limit, visit: v.visit ? 1 : undefined, since: v.since, seed: v.seed, until: v.until })}`),
  caughtUp: (through: string, visitId?: number | null) =>
    post<{ seenThrough: string | null }>('/feed/caught-up', visitId == null ? { through } : { through, visitId }),
  createPost: (b: {
    body: string; parentId?: string; imageIds?: string[]; collabId?: string; eventId?: string;
    /** RFC §10.22: post an uploaded recording as a monologue */
    monologue?: { audioId: string; title: string; kind: MonologueKind; mine: true };
  }) => post<Post>('/posts', b),
  thread: (id: string) => get<Thread>(`/posts/${enc(id)}`),
  editPost: (id: string, body: string, mono?: { title: string; kind: MonologueKind }) =>
    call<Post>('PATCH', `/posts/${enc(id)}`, mono ? { body, ...mono } : { body }),
  deletePost: (id: string) => call<{ ok: true }>('DELETE', `/posts/${enc(id)}`),
  like: (id: string) => post<{ likeCount: number | null; likedByMe: boolean }>(`/posts/${enc(id)}/like`, {}),
  unlike: (id: string) => call<{ likeCount: number | null; likedByMe: boolean }>('DELETE', `/posts/${enc(id)}/like`),
  flagPost: (id: string, reason?: string) => post<{ flagged: true }>(`/posts/${enc(id)}/flag`, reason ? { reason } : {}),
  opsRemovePost: (id: string) => post<{ removed: true }>(`/ops/posts/${enc(id)}/remove`, {}),
  upload: (file: FileLike) => {
    const fd = new FormData();
    fd.append('file', file as unknown as Blob);
    return call<Image>('POST', '/uploads', fd);
  },
  monologues: (cursor?: string | null, limit = 20, o: { kind?: MonologueKind | null; visit?: boolean; since?: string } = {}) =>
    get<Page<Post> & { visit?: FeedVisit }>(`/monologues${qs({ cursor, limit, kind: o.kind ?? undefined, visit: o.visit ? 1 : undefined, since: o.since })}`),
  monologuesCaughtUp: (through: string) => post<{ ok: true }>('/monologues/caught-up', { through }),
  memberMonologues: (handle: string) => get<Page<Post>>(`/members/${enc(handle)}/monologues`),
  /** a recording from the phone (m4a), before it is posted */
  uploadAudio: (file: FileLike, durationMs: number, peaks: number[]) => {
    const fd = new FormData();
    fd.append('file', file as unknown as Blob);
    fd.append('durationMs', String(durationMs));
    fd.append('peaks', JSON.stringify(peaks));
    fd.append('source', 'recorded');
    return call<{ id: string; url: string; durationMs: number; peaks: number[] }>('POST', '/monologues/audio', fd);
  },

  // ─── people ───────────────────────────────────────────────────────────────
  seats: () => get<{ cap: number; used: number }>('/seats'),
  members: (cursor?: string | null, limit = 30) => get<Page<MemberSummary>>(`/members${qs({ cursor, limit })}`),
  search: (q: string) => get<{ members: MemberSummary[]; posts: Post[] }>(`/search${qs({ q })}`),
  mentionMembers: (q: string) => get<{ items: { handle: string; displayName: string; gender: Gender | null }[] }>(`/members/mention${qs({ q })}`),
  member: (handle: string) => get<MemberSummary>(`/members/${enc(handle)}`),
  memberPosts: (handle: string, cursor?: string | null, limit = 20) => get<Page<Post>>(`/members/${enc(handle)}/posts${qs({ cursor, limit })}`),
  portfolio: (handle: string) => get<Portfolio>(`/members/${enc(handle)}/portfolio`),
  memberPicks: (handle: string) => get<{ items: Pick[] }>(`/members/${enc(handle)}/suggestions`),
  memberCollabs: (handle: string) => get<{ items: CollabSummary[] }>(`/members/${enc(handle)}/collabs`),
  memberEvents: (handle: string) => get<{ upcoming: AnEvent[]; past: AnEvent[] }>(`/members/${enc(handle)}/events`),
  consultWaiting: () => get<{ waiting: number }>('/consultations/waiting'),

  // ─── notifications (RFC §10.20: the bell) ─────────────────────────────────
  notifications: (cursor?: string | null, limit = 30) => get<NotificationPage>(`/notifications${qs({ cursor, limit })}`),
  unreadCount: () => get<{ unreadCount: number }>('/notifications/unread-count'),
  markRead: (ids?: string[]) => post<{ ok: true; unreadCount: number }>('/notifications/read', ids ? { ids } : {}),

  // ─── Collab (RFC §10.21) ──────────────────────────────────────────────────
  collabPage: (p: { kind?: 'all' | 'event' | 'activity' | 'project'; cursor?: string | null; limit?: number } = {}) =>
    get<Page<CollabPageItem>>(`/collab${qs({ kind: !p.kind || p.kind === 'all' ? undefined : p.kind, cursor: p.cursor, limit: p.limit })}`),
  myCollab: () => get<MyCollab>('/me/collab'),
  events: (scope: 'upcoming' | 'past', cursor?: string | null, limit = 20) => get<Page<AnEvent>>(`/events${qs({ scope, cursor, limit })}`),
  collab: (id: string) => get<Collab>(`/collabs/${enc(id)}`),
  joinCollab: (id: string, note?: string) => post<{ joined?: true; requested?: true }>(`/collabs/${enc(id)}/join`, note ? { note } : {}),
  withdrawCollabRequest: (id: string) => call<{ ok: true }>('DELETE', `/collabs/${enc(id)}/request`),
  leaveCollab: (id: string) => post<{ ok: true }>(`/collabs/${enc(id)}/leave`, {}),
  answerCollabInvite: (id: string, accept: boolean) => post<{ joined?: true; ok?: true }>(`/collabs/${enc(id)}/invite/${accept ? 'accept' : 'decline'}`, {}),
  collabUpdates: (id: string, cursor?: string | null) => get<Page<Post>>(`/collabs/${enc(id)}/updates${qs({ cursor, limit: 20 })}`),
  event: (id: string) => get<EventDetail>(`/events/${enc(id)}`),
  rsvp: (id: string) => post<AnEvent>(`/events/${enc(id)}/rsvp`, {}),
  leaveEvent: (id: string) => call<AnEvent>('DELETE', `/events/${enc(id)}/rsvp`),
  askToCome: (id: string, note?: string) => post<AnEvent>(`/events/${enc(id)}/request`, note ? { note } : {}),
  withdrawEventRequest: (id: string) => call<AnEvent>('DELETE', `/events/${enc(id)}/request`),
  declineEventInvite: (id: string) => post<AnEvent>(`/events/${enc(id)}/invite/decline`, {}),
  eventUpdates: (id: string, cursor?: string | null) => get<Page<Post>>(`/events/${enc(id)}/updates${qs({ cursor, limit: 20 })}`),
};
