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
  canReport: boolean;
}
export type SuggestionKind = 'movie' | 'book' | 'place' | 'food';
/** A member's pick: a movie, book, place or food they suggest. */
export interface Pick {
  id: string;
  kind: SuggestionKind;
  title: string;
  note: string | null;
  createdAt: string;
  author: { handle: string; displayName: string } | null;
  mine: boolean;
}

/** One line of experience or education. `to` null = still there. */
export interface PfEntry { title: string; place: string; from: number; to: number | null; line: string }
export interface PfLink { label: string; url: string }
/** The CV fields a member edits on their own portfolio. */
export interface PortfolioFields {
  headline: string; location: string; openToWork: boolean; about: string;
  skills: string[]; tools: string[]; experience: PfEntry[]; education: PfEntry[]; links: PfLink[];
}
export interface Portfolio extends PortfolioFields {
  handle: string;
  /** nothing filled in yet: the page shows the plain profile */
  empty: boolean;
  updatedAt: string | null;
  mine: boolean;
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
  event: { id: string; title: string } | null;
}
export interface Page<T> { items: T[]; nextCursor: string | null }
export type RsvpStatus = 'going' | 'waitlisted' | 'cancelled';
export interface EventPerson { handle: string; displayName: string; state: UserState; attended: boolean }
export interface AnEvent {
  id: string; title: string; description: string; startsAt: string; endsAt: string | null;
  location: string | null; locationHidden: boolean; locationRsvpOnly: boolean; capacity: number | null;
  goingCount: number; waitlistCount: number; attendedCount: number;
  priceNote: string | null; externalPaymentUrl: string | null; cancelledAt: string | null;
  host: { handle: string; displayName: string; state: UserState } | null; isHost: boolean;
  my: { status: RsvpStatus; waitlistPosition: number | null; attended: boolean } | null;
  started: boolean; rsvpOpen: boolean; canEdit: boolean; canConfirmAttendance: boolean;
}
export interface EventDetail extends AnEvent { going: EventPerson[]; waitlist: EventPerson[] | null }
export interface EventInput {
  title: string; description: string; startsAt: string; endsAt: string | null; location: string;
  locationRsvpOnly: boolean; capacity: number | null; priceNote: string | null; externalPaymentUrl: string | null;
}
export type ProductKey = 'stay_fee_90d' | 'reinstatement';
export interface Price { productKey: ProductKey; name: string; amountMinor: number; currency: string }
export interface PaymentRecord {
  id: string; productKey: ProductKey; amountMinor: number; currency: string;
  status: 'paid' | 'refund_pending' | 'refunded'; refundReason: string | null;
  createdAt: string; paidAt: string | null; refundedAt: string | null;
}
export interface FakeCheckout {
  sessionId: string; productKey: ProductKey; productName: string; amountMinor: number; currency: string;
  status: 'pending' | 'paid' | 'expired' | 'refund_pending' | 'refunded'; expiresAt: string;
  successUrl: string; cancelUrl: string;
}

export function formatMoney(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}
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
  flagPost: (id: string, reason?: string) => post<{ flagged: true }>(`/posts/${encodeURIComponent(id)}/flag`, reason ? { reason } : {}),
  unlike: (id: string) => call<{ likeCount: number; likedByMe: boolean }>('DELETE', `/posts/${encodeURIComponent(id)}/like`),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return call<Image>('POST', '/uploads', fd);
  },
  search: (q: string) => get<{ members: MemberSummary[]; posts: Post[] }>(`/search${qs({ q })}`),
  members: (cursor?: string | null, limit = 30) => get<Page<MemberSummary>>(`/members${qs({ cursor, limit })}`),
  member: (handle: string) => get<MemberSummary>(`/members/${encodeURIComponent(handle)}`),
  randomPick: (exclude?: string | null) => get<{ item: Pick | null }>(`/suggestions/random${qs({ exclude })}`),
  suggest: (b: { kind: SuggestionKind; title: string; note?: string | null }) => post<Pick>('/suggestions', b),
  deletePick: (id: string) => call<{ ok: true }>('DELETE', `/suggestions/${encodeURIComponent(id)}`),
  memberPicks: (handle: string) => get<{ items: Pick[] }>(`/members/${encodeURIComponent(handle)}/suggestions`),
  portfolio: (handle: string) => get<Portfolio>(`/members/${encodeURIComponent(handle)}/portfolio`),
  updatePortfolio: (b: Partial<PortfolioFields>) => call<Portfolio>('PATCH', '/me/portfolio', b),
  memberPosts: (handle: string, cursor?: string | null, limit = 20) =>
    get<Page<Post>>(`/members/${encodeURIComponent(handle)}/posts${qs({ cursor, limit })}`),
  notifications: (cursor?: string | null, limit = 30) => get<NotificationPage>(`/notifications${qs({ cursor, limit })}`),
  unreadCount: () => get<{ unreadCount: number }>('/notifications/unread-count'),
  markRead: (ids?: string[]) => post<{ ok: true; unreadCount: number }>('/notifications/read', ids ? { ids } : {}),

  events: (scope: 'upcoming' | 'past', cursor?: string | null, limit = 20) => get<Page<AnEvent>>(`/events${qs({ scope, cursor, limit })}`),
  event: (id: string) => get<EventDetail>(`/events/${encodeURIComponent(id)}`),
  createEvent: (b: EventInput) => post<AnEvent>('/events', b),
  updateEvent: (id: string, b: Partial<EventInput>) => call<AnEvent>('PATCH', `/events/${encodeURIComponent(id)}`, b),
  cancelEvent: (id: string) => call<AnEvent>('DELETE', `/events/${encodeURIComponent(id)}`),
  rsvp: (id: string) => post<AnEvent>(`/events/${encodeURIComponent(id)}/rsvp`, {}),
  leaveEvent: (id: string) => call<AnEvent>('DELETE', `/events/${encodeURIComponent(id)}/rsvp`),
  confirmAttendance: (id: string, handles: string[]) => post<AnEvent>(`/events/${encodeURIComponent(id)}/attendance`, { handles }),

  pushConfig: () => get<{ enabled: boolean; publicKey: string | null }>('/push/config'),
  pushSubscribe: (b: { endpoint: string; keys: { p256dh: string; auth: string } }) => post<{ ok: true }>('/push/subscriptions', b),
  pushUnsubscribe: (endpoint: string) => call<{ ok: true }>('DELETE', '/push/subscriptions', { endpoint }),

  pricing: () => get<Price[]>('/pricing'),
  checkout: (productKey: ProductKey) => post<{ url: string }>('/payments/checkout', { productKey }),
  myPayments: () => get<PaymentRecord[]>('/me/payments'),
  fakeCheckout: (session: string) => get<FakeCheckout>(`/dev/fake-checkout/${encodeURIComponent(session)}`),
  fakeCheckoutAction: (session: string, action: 'pay' | 'expire') =>
    post<{ outcome: string }>(`/dev/fake-checkout/${encodeURIComponent(session)}/${action}`, {}),
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
  title_invalid: 'Give it a name, up to 80 characters.',
  note_invalid: 'Keep the note under 140 characters.',
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
  product_unavailable: 'That is not available to buy right now.',
  no_open_offer: 'There is no seat being held for you any more.',
  stay_fee_not_applicable: 'The stay fee is only for members with a seat.',
  checkout_closed: 'This checkout is no longer open. Start a new one.',
  payment_not_found: 'That checkout was not found.',
  event_started: 'This event has already started.',
  event_cancelled: 'This event was cancelled.',
  host_rsvp: 'You are hosting this event.',
  not_host: 'Only the host can do that.',
  own_post: 'You cannot report your own post.',
  capacity_below_going: 'More people are already going than that capacity allows.',
  attendance_closed: 'Attendance can be confirmed from the start time until 14 days after.',
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
