import type { Gender } from '@anti/shared';
export type { Gender };

export type UserState = 'waitlisted' | 'active' | 'flagged_lurker' | 'archived' | 'banned' | 'deleted';

export interface Me {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  state: UserState;
  /** 'ops' = moderator: sees the Admin page */
  role: 'member' | 'ops';
  invitedBy: { handle: string } | null;
  activatedAt: string | null;
  lastSeenAt: string | null;
  lurkerExemptUntil: string | null;
  waitlist: { position: number; total: number; priority: 'reinstating' | 'new'; offeredUntil: string | null } | null;
  lurker: { flaggedAt: string; graceEndsAt: string; contributions: number; required: number } | null;
  archived: { reason: 'inactive' | 'lurker_grace_expired' | 'waitlist_decay' | string; wasMember: boolean } | null;
  /** setup (About you, gender, birthday) not done yet: the app shows only /setup */
  setupNeeded: boolean;
  /** shapes the drawn face only; null until setup */
  gender: Gender | null;
  /** YYYY-MM-DD, your own; members can't change it */
  birthday: string | null;
  /** show the "birthday today" tag on your day */
  birthdayPublic: boolean;
  /** interest tags (slugs) */
  interests: string[];
  /** RFC §10.7: contact details are asked for (the server has a key) */
  contactEnabled: boolean;
  /** your own contact details: only you and admins ever see them */
  contact: { phone: string | null; email: string | null; updatedAt: string | null } | null;
  /** when an admin verified you (the badge shows by your name) */
  verifiedAt: string | null;
  /** RFC §10.13: false for members who joined with a passkey and have not chosen a PIN yet */
  pinSet?: boolean;
  /** RFC §10.14: light unless they chose dark in Settings (the device's own setting is ignored) */
  theme?: 'light' | 'dark';
  /** RFC §10.8: set when "you" are a visitor on an admin's pass: an hour of reading, nothing else */
  visitor?: { expiresAt: string };
}

/** RFC §10.10: a member's half hour on the site. */
export interface ScreenState {
  /** the admins' switch; off by default, and nothing shows while off */
  enabled: boolean;
  usedSeconds: number;
  limitSeconds: number;
  restSeconds: number;
  /** ISO; while in the future the member is locked out */
  lockedUntil: string | null;
  /** ISO; identifies the current half hour */
  windowStartedAt: string | null;
  /** an admin: the timer shows and counts on, the lock never comes */
  exempt: boolean;
}

/** RFC §10.8: one visitor pass as the admin panel lists it (the code is shown once, at creation). */
export interface VisitorPassInfo {
  id: string; label: string;
  status: 'unopened' | 'active' | 'ended' | 'expired' | 'revoked';
  createdAt: string; codeExpiresAt: string; openedAt: string | null; expiresAt: string | null; revokedAt: string | null;
  createdByHandle: string | null;
}

/** One reported post or project in the moderation queue. */
export interface FlagItem {
  kind: 'post' | 'project' | 'collab' | 'consult_offer' | 'consultation';
  /** consult_offer: whose offer */
  offerHandle?: string;
  /** consultation: the request (author = the consultant, requester = who asked) */
  consultationId?: string;
  requester?: string | null;
  postId?: string;
  collabId?: string;
  projectId?: string;
  body: string;
  author: string | null;
  hidden: boolean;
  flags: number;
  reasons: string[];
  firstFlaggedAt: string;
}

/** One person in the admin's member list (everyone except deleted accounts). */
export interface AdminMember {
  handle: string; displayName: string; state: UserState; role: 'member' | 'ops'; gender: Gender | null;
  joinedAt: string; activatedAt: string | null; lastSeenAt: string | null;
  invitedBy: string | null; postCount: number;
  /** whole years (admins only) */
  age: number | null;
  /** consultations: never set up, on, paused, or switched off by an admin */
  consulting: 'none' | 'on' | 'paused' | 'off';
  /** RFC §10.7 */
  verified: { at: string; by: string | null } | null;
  hasContact: boolean;
  contactChangedSinceVerified: boolean;
}
/** A member's contact details as an admin opens them (the opening is logged). */
export interface AdminContact {
  handle: string; phone: string | null; email: string | null; updatedAt: string | null;
  openedBy: { handle: string | null; at: string }[];
}
/** The room's settings an admin can change, plus seats in use. */
export interface AdminSettings { seatCap: number; invitesPerMember: number; inviteExpiryDays: number; screenTime: boolean; seatsUsed: number }

/** "Finish your profile": each item ticks itself from what you have done. */
export type ChecklistItem = 'headline' | 'skills' | 'project' | 'post' | 'pick' | 'interests';
/** One tag from the shared interest list (RFC §10.5). */
export interface Interest { slug: string; label: string }
export interface ChecklistState { items: Record<ChecklistItem, boolean>; dismissed: boolean }

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

/** `role` 'ops' = an admin (shown with the OG mark by the name, RFC §10.7). */
/** Month and day only, and only when they show it; never the year (RFC §10.3). */
export interface Birthday { month: number; day: number }
/** `isNew`: in their first three weeks; the feed says "new here" and never folds their posts */
export type Author = { handle: string; displayName: string; state: UserState; role?: 'member' | 'ops'; gender?: Gender | null; birthday?: Birthday | null; verified?: boolean; isNew?: boolean } | null;
export interface Image { id: string; url: string; width: number; height: number }
export interface Post {
  /** an update in a collab's thread / on an event's page (RFC §10.5) */
  collab?: { id: string; title: string } | null;
  event?: { id: string; title: string } | null;
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  author: Author;
  parentId: string | null;
  rootId: string | null;
  replyCount: number;
  /** only on your own posts; null on everyone else's (likes are never a public score) */
  likeCount: number | null;
  likedByMe: boolean;
  /** the author's first feed post: the reply button reads "Say hello" */
  firstPost?: boolean;
  /** replies only: the post at the top of the thread (RFC §10.12, "Replied to Mina's post: …") */
  replyTo?: { rootId: string; author: { handle: string; displayName: string } | null; snippet: string } | null;
  images: Image[];
  /** RFC §10.16: @handles in the body that belong to a seated member (lowercased) */
  mentions?: string[];
  canEdit: boolean;
  canDelete: boolean;
  canReport: boolean;
  /** you are an admin and this is someone else's post: you can remove it */
  canModerate: boolean;
  /** hidden after reports: only admins reviewing it ever see such a post */
  hidden?: boolean;
}
export type SuggestionKind = 'movie' | 'book' | 'place' | 'food';
/** RFC §10.17: a pet is a content identity owned by one member; not an account. */
export type PetSpecies = 'dog' | 'cat' | 'bird';
export type PetLabel = 'everyday' | 'advice' | 'health' | 'help';
export interface Pet {
  id: string;
  name: string;
  species: PetSpecies;
  avatar: { variant: number; url: string | null };
  owner: { handle: string; displayName: string };
}
export interface PetPost {
  id: string;
  body: string;
  createdAt: string;
  label: PetLabel;
  images: Image[];
  /** only the owner sees the count, like posts */
  likeCount: number | null;
  likedByMe: boolean;
  replyCount: number;
  pet: Pet;
  canDelete: boolean;
  canReport: boolean;
}
/** A member's pick: a movie, book, place or food they suggest. */
export interface Pick {
  id: string;
  kind: SuggestionKind;
  title: string;
  note: string | null;
  createdAt: string;
  author: CollabPerson | null;
  mine: boolean;
  /** "Tried it" votes: good / not for me */
  up: number; down: number; remarkCount: number;
  myVote: 1 | -1 | null; myRemark: string | null;
  latestRemark: PickRemark | null;
}
/** One person who tried a pick: their vote and, maybe, a remark. */
export interface PickRemark extends CollabPerson { vote: 1 | -1; remark: string | null; at: string }

/** One line of experience or education. `to` null = still there. */
export interface PfEntry { title: string; place: string; from: number; to: number | null; line: string }
export interface PfLink { label: string; url: string }
export type PfFont = 'archivo' | 'mono' | 'hand';
export type PfBackground = 'paper' | 'ink';
export type PfAccent = 'red' | 'blue' | 'green' | 'yellow' | 'violet' | 'orange';
/** The look of a portfolio (and its project pages): a fixed set of choices. */
export interface PfStyle { font: PfFont; bg: PfBackground; accent: PfAccent }
/** The CV fields a member edits on their own portfolio, plus the look. */
export interface PortfolioFields extends PfStyle {
  headline: string; location: string; openToWork: boolean; about: string;
  skills: string[]; tools: string[]; experience: PfEntry[]; education: PfEntry[]; links: PfLink[];
}
export interface Portfolio extends PortfolioFields {
  handle: string;
  /** the strip across the top, if one was uploaded */
  cover: { url: string; width: number; height: number } | null;
  /** nothing filled in yet: the page shows the plain profile */
  empty: boolean;
  updatedAt: string | null;
  mine: boolean;
}
/** `coverId`: a fresh upload's id to use as the cover, null to remove it, omitted to keep it. */
export type PortfolioInput = Partial<PortfolioFields> & { coverId?: string | null };

/** How an image sits on a project page: full width, or beside a text panel on the left or right. */
export type ProjectLayout = 'full' | 'left' | 'right';
export interface ProjectImage {
  id: string; url: string; width: number; height: number;
  layout: ProjectLayout; heading: string; text: string; caption: string;
}
export interface ProjectFields {
  title: string; summary: string; body: string; year: number | null; role: string;
  tools: string[]; team: string; duration: string; draft: boolean;
}
export interface Project extends ProjectFields {
  id: string; handle: string; images: ProjectImage[]; mine: boolean;
  /** hidden after reports: only the owner still sees it, until a moderator decides */
  hidden: boolean;
  canReport: boolean;
  /** you are an admin and this is someone else's project: you can remove it */
  canModerate: boolean;
  createdAt: string; updatedAt: string;
}
/** One line of the contents list. `hidden` is only ever true for the owner. */
export interface ProjectSummary {
  id: string; title: string; year: number | null; role: string; draft: boolean; hidden: boolean;
  cover: { url: string; width: number; height: number } | null;
}
export interface ProjectImageInput { id: string; layout: ProjectLayout; heading: string; text: string; caption: string }
export type ProjectInput = Partial<ProjectFields> & { images?: ProjectImageInput[] };

export interface MemberSummary {
  handle: string;
  displayName: string;
  bio: string;
  state: UserState;
  /** 'ops' = an admin */
  role: 'member' | 'ops';
  /** an admin checked them (RFC §10.7) */
  verified?: boolean;
  /** shapes the drawn face */
  gender: Gender | null;
  /** for the "birthday today" tag; null when hidden */
  birthday: Birthday | null;
  /** interest tags (slugs) */
  interests: string[];
  invitedBy: { handle: string } | null;
  activatedAt: string | null;
  postCount: number;
  /** RFC §10.17: the pets shown on this profile (GET /members/:handle) */
  pets?: Pet[];
  /** from the portfolio: shown under the name in lists */
  headline: string;
  openToWork: boolean;
  /** takes consultations (never true for viewers under 18) */
  consults: boolean;
}
export interface Notification {
  id: string;
  kind: 'reply' | 'like' | string;
  createdAt: string;
  readAt: string | null;
  actor: { handle: string; displayName: string; gender?: Gender | null } | null;
  post: { id: string; rootId: string | null; snippet: string } | null;
  event: { id: string; title: string } | null;
  /** handle_changed: your new handle */
  newHandle?: string | null;
  /** project_removed: the project's title */
  projectTitle?: string | null;
  /** pick_remark / remark_removed: the pick's title */
  pickTitle?: string | null;
  /** checklist_reminder: how far along "Finish your profile" is */
  checklist?: { done: number; total: number } | null;
  /** collab_*: the collab */
  collab?: { id: string; title: string } | null;
  /** collab_removed: its title */
  collabTitle?: string | null;
  /** collab_finished: your draft project */
  draftId?: string | null;
  /** consult_*: the request (pricing on consult_accepted; what it was waiting for on consult_expired; `topic` only on notifications from before 2026-11-09) */
  consultation?: { id: string; topic?: string; pricing: string | null; was: string | null } | null;
}
export interface Page<T> { items: T[]; nextCursor: string | null }
/** RFC §10.11: one visit to the feed. Posts newer than `since` are new; the feed stops at that line. */
export interface FeedVisit {
  since: string;
  /** the line is a week back: nothing was ever caught up to (or it was long ago) */
  capped: boolean;
  newPosts: number;
  /** null for visitors, and after a reload (the browser kept the first one) */
  visitId: number | null;
  /** older posts that two or more people replied to since the line; a row at the newest reply */
  threads: FeedThreadRow[];
  /** public events announced since the line; a row at the moment they were made */
  events: FeedEventRow[];
  /** shown on the end card: one you are going to first, else the soonest you can see */
  nextEvent: { id: string; title: string; startsAt: string; going: number; imGoing: boolean } | null;
}
export type FeedPerson = { handle: string; displayName: string; gender: Gender | null } | null;
export interface FeedThreadRow { rootId: string; at: string; repliers: number; postedAt: string; author: FeedPerson }
export interface FeedEventRow { id: string; at: string; title: string; startsAt: string; going: number; joinMode: 'open' | 'approve'; host: FeedPerson }
export type RsvpStatus = 'going' | 'waitlisted' | 'cancelled';
export interface EventPerson { handle: string; displayName: string; state: UserState; attended: boolean; gender?: Gender | null; admin?: boolean; verified?: boolean }
export interface AnEvent {
  id: string; title: string; description: string; startsAt: string; endsAt: string | null;
  location: string | null; locationHidden: boolean; locationRsvpOnly: boolean; capacity: number | null;
  goingCount: number; waitlistCount: number; attendedCount: number;
  priceNote: string | null; externalPaymentUrl: string | null; cancelledAt: string | null;
  host: (CollabPerson & { state: UserState }) | null; isHost: boolean;
  my: { status: RsvpStatus; waitlistPosition: number | null; attended: boolean } | null;
  started: boolean; rsvpOpen: boolean; canEdit: boolean; canConfirmAttendance: boolean;
  collab: { id: string; title: string } | null; audience: 'anyone' | 'team'; canPostUpdate: boolean;
  requirements: string; joinMode: 'open' | 'approve'; interests: string[];
  request: 'pending' | 'declined' | null; invited: boolean;
}
export interface EventDetail extends AnEvent {
  going: EventPerson[]; waitlist: EventPerson[] | null;
  /** host only */
  requests: (CollabPerson & { note: string | null; at: string })[] | null;
  invites: CollabPerson[] | null;
}
export interface EventInput {
  title: string; description: string; startsAt: string; endsAt: string | null; location: string;
  locationRsvpOnly: boolean; capacity: number | null; priceNote: string | null; externalPaymentUrl: string | null;
  collabId?: string; audience?: 'anyone' | 'team';
  requirements?: string; joinMode?: 'open' | 'approve'; interests?: string[];
}
export interface AdminInterest {
  slug: string; label: string; addedBy: string | null; addedAt: string;
  uses: { members: number; collabs: number; events: number };
}
export type CollabStatus = 'recruiting' | 'closed' | 'finished';
export type CollabRole = 'host' | 'cohost' | 'member';
/** Anyone the API names: the OG mark (`admin`) and the verified badge go right after the name (RFC §10.7). */
export interface CollabPerson { handle: string; displayName: string; gender?: Gender | null; admin?: boolean; verified?: boolean }
export interface CollabSummary {
  id: string; title: string; status: CollabStatus; joinMode: 'open' | 'approve';
  interests: string[]; roles: string[]; teamCount: number; teamMax: number;
  host: CollabPerson | null; cover: { url: string; width: number; height: number } | null;
  match: number; my: { role: CollabRole | null; request: 'pending' | 'declined' | null; invited: boolean };
  createdAt: string;
}
export interface Collab extends CollabSummary {
  description: string; requirements: string; priceNote: string | null; paymentUrl: string | null;
  team: (CollabPerson & { role: CollabRole; joinedAt: string })[];
  canManage: boolean;
  requests: (CollabPerson & { note: string | null; at: string })[] | null;
  invites: CollabPerson[] | null;
  meetups: { id: string; title: string; startsAt: string; audience: 'anyone' | 'team'; goingCount: number; past: boolean }[];
  hidden: boolean; canReport: boolean; canModerate: boolean;
}
export interface CollabInput {
  title: string; description: string; requirements: string; roles: string[]; teamMax: number;
  joinMode: 'open' | 'approve'; priceNote: string | null; paymentUrl: string | null; interests: string[];
  coverId?: string | null; status?: CollabStatus;
}
export interface CollabSuggestion extends CollabPerson { shared: string[]; match: number }

// ─── Consultations (RFC §10.6) ──────────────────────────────────────────────
export type ConsultPricing = 'free' | 'paid';
export type ConsultStatus = 'pending' | 'accepted' | 'revealed' | 'done' | 'declined' | 'expired' | 'closed';
export interface ThanksNote extends CollabPerson { text: string; at: string; hidden: boolean }
/** What a member (18+) sees on someone's portfolio. Never the contact or the payment link. */
export interface ConsultOffer {
  handle: string; description: string; minutes: number;
  pricing: ConsultPricing; priceNote: string | null; sessionsDone: number;
  thanks: ThanksNote[]; thanksCount: number;
  mine: boolean; canBook: boolean; canReport: boolean;
  active: boolean; blocked: boolean; hidden: boolean;
}
export interface MyConsultOffer {
  active: boolean; description: string; minutes: number;
  pricing: ConsultPricing; priceNote: string | null; paymentUrl: string | null; contact: string;
  blocked: boolean; hidden: boolean; allowed: boolean; exists: boolean;
}
export type ConsultOfferInput = Partial<Omit<MyConsultOffer, 'blocked' | 'hidden' | 'allowed' | 'exists'>>;
export interface Consultation {
  id: string; role: 'consultant' | 'requester';
  consultant: CollabPerson; requester: CollabPerson;
  need: string; when: string; minutes: number;
  status: ConsultStatus; pricing: ConsultPricing | null; priceNote: string | null; paymentUrl: string | null;
  contacts: { consultant: string; requester: string } | null; contactsUntil: string | null; expiresAt: string | null;
  createdAt: string; decidedAt: string | null; revealedAt: string | null; doneAt: string | null; closedAt: string | null;
  closedByMe: boolean;
  thanks: { text: string; at: string; hidden: boolean } | null;
  can: { accept: boolean; decline: boolean; agree: boolean; close: boolean; hideContacts: boolean; done: boolean; thank: boolean; hideThanks: boolean; report: boolean };
  reported: boolean;
}
export interface ConsultRequestInput { need: string; when: string; contact: string }
/** Admins: who consulted whom and when. Never the contacts or what was asked. */
export interface OpsConsultation {
  id: string; consultant: CollabPerson; requester: CollabPerson; status: ConsultStatus;
  pricing: ConsultPricing | null; createdAt: string; reported: boolean;
}
/** Admins, on a reported request only: all of it. */
export interface OpsConsultationDetail {
  id: string; consultant: CollabPerson; requester: CollabPerson; need: string; when: string;
  status: ConsultStatus; pricing: ConsultPricing | null; priceNote: string | null; paymentUrl: string | null;
  contacts: { consultant: string | null; requester: string | null };
  createdAt: string; revealedAt: string | null; doneAt: string | null; closedAt: string | null; thanks: string | null;
  reports: { handle: string; reason: string | null; at: string; open: boolean }[];
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
  if (!res.ok) {
    // a visitor's hour is up (RFC §10.8): whatever page they were on, show them the ended page
    if (res.status === 401 && data?.error === 'visitor_expired' && typeof window !== 'undefined' && !window.location.pathname.startsWith('/visit/')) {
      window.location.assign('/visit/ended');
    }
    // a member's half hour is spent (RFC §10.10): the timer finds out and shows the lock
    if (res.status === 403 && data?.error === 'rest_time' && typeof window !== 'undefined') window.dispatchEvent(new Event('anti:rest'));
    throw new ApiError(res.status, data?.error ?? 'unknown', data?.detail);
  }
  return data as T;
}

const get = <T,>(p: string) => call<T>('GET', p);
const post = <T,>(p: string, b: unknown = {}) => call<T>('POST', p, b);

export const api = {
  me: () => get<Me>('/me'),
  updateMe: (b: { displayName?: string; bio?: string; gender?: Gender; birthdayPublic?: boolean; theme?: 'light' | 'dark' }) => call<Me>('PATCH', '/me', b),
  checklist: () => get<ChecklistState>('/me/checklist'),
  interests: () => get<{ items: Interest[] }>('/interests'),
  setInterests: (interests: string[]) => call<{ interests: string[] }>('PUT', '/me/interests', { interests }),
  addInterest: (label: string) => post<Interest & { added: boolean }>('/interests', { label }),
  opsAddInterest: (label: string) => post<Interest>('/ops/interests', { label }),
  opsInterests: () => get<{ items: AdminInterest[] }>('/ops/interests'),
  opsRemoveInterest: (slug: string) => call<{ removed: true }>('DELETE', `/ops/interests/${encodeURIComponent(slug)}`),
  dismissChecklist: () => post<{ dismissed: true }>('/me/checklist/dismiss', {}),
  setupState: () => get<{ about: string; gender: Gender | null; birthday: string | null; done: boolean; phone: string; email: string }>('/me/setup'),
  setContact: (b: { phone: string; email: string }) => call<Me>('PUT', '/me/contact', b),
  opsVerify: (handle: string, on: boolean) => post<{ handle: string; verified: boolean }>(`/ops/users/${encodeURIComponent(handle)}/verify`, { on }),
  opsContact: (handle: string) => get<AdminContact>(`/ops/users/${encodeURIComponent(handle)}/contact`),
  setup: (b: { about: string; gender: Gender; birthday: string; confirmUnderage?: boolean; phone?: string; email?: string }) =>
    call<Me | { closed: true }>('PUT', '/me/setup', b),
  deleteMe: () => call<{ ok: true }>('DELETE', '/me'),
  checkInvite: (code: string) => post<{ valid: boolean; wouldWaitlist: boolean }>('/invites/check', { code }),
  /** RFC §10.8: enter a visitor code; the hour starts and the cookie is set */
  visit: (code: string) => post<{ expiresAt: string }>('/visit', { code }),
  leaveVisit: () => post<{ ok: true }>('/visit/leave', {}),
  /** RFC §10.10: the member's half hour, and the heartbeat that spends it */
  screenTime: () => get<ScreenState>('/me/screen-time'),
  screenBeat: (seconds: number) => post<ScreenState>('/me/screen-time/beat', { seconds }),
  opsVisitorPasses: () => get<{ items: VisitorPassInfo[]; active: number }>('/ops/visitor-passes'),
  opsCreateVisitorPass: (label: string) => post<VisitorPassInfo & { code: string }>('/ops/visitor-passes', { label }),
  opsRevokeVisitorPass: (id: string) => post<VisitorPassInfo>(`/ops/visitor-passes/${encodeURIComponent(id)}/revoke`, {}),
  // RFC §10.13: joining and signing in with a handle and a 6-digit PIN
  join: (b: { code: string; handle: string; displayName: string; pin: string }) =>
    post<{ state: UserState; recoveryCode: string }>('/auth/join', b),
  pinLogin: (b: { handle: string; pin: string }) => post<{ state: UserState }>('/auth/pin/login', b),
  /** `code`: the recovery code, or an admin's one-hour reset code */
  pinReset: (b: { handle: string; code: string; pin: string }) =>
    post<{ state: UserState; recoveryCode: string | null }>('/auth/pin/reset', b),
  setPin: (pin: string, currentPin?: string) => call<{ ok: true }>('PUT', '/me/pin', currentPin ? { pin, currentPin } : { pin }),
  opsPinReset: (handle: string) => post<{ code: string; expiresAt: string }>(`/ops/users/${encodeURIComponent(handle)}/pin-reset`, {}),
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

  /** `visit`: start a visit (first page only); `since`: resume one after a reload (RFC §10.11) */
  feed: (cursor?: string | null, limit = 20, v: { visit?: boolean; since?: string } = {}) =>
    get<Page<Post> & { visit?: FeedVisit }>(`/feed${qs({ cursor, limit, visit: v.visit ? 1 : undefined, since: v.since })}`),
  caughtUp: (through: string, visitId?: number | null) =>
    post<{ seenThrough: string | null }>('/feed/caught-up', visitId == null ? { through } : { through, visitId }),
  createPost: (b: { body: string; parentId?: string; imageIds?: string[]; collabId?: string; eventId?: string; petId?: string; petLabel?: PetLabel }) => post<Post>('/posts', b),
  thread: (id: string) => get<Thread>(`/posts/${encodeURIComponent(id)}`),
  editPost: (id: string, body: string) => call<Post>('PATCH', `/posts/${encodeURIComponent(id)}`, { body }),
  deletePost: (id: string) => call<{ ok: true }>('DELETE', `/posts/${encodeURIComponent(id)}`),
  like: (id: string) => post<{ likeCount: number | null; likedByMe: boolean }>(`/posts/${encodeURIComponent(id)}/like`, {}),
  flagPost: (id: string, reason?: string) => post<{ flagged: true }>(`/posts/${encodeURIComponent(id)}/flag`, reason ? { reason } : {}),
  unlike: (id: string) => call<{ likeCount: number | null; likedByMe: boolean }>('DELETE', `/posts/${encodeURIComponent(id)}/like`),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return call<Image>('POST', '/uploads', fd);
  },
  search: (q: string) => get<{ members: MemberSummary[]; posts: Post[] }>(`/search${qs({ q })}`),
  members: (cursor?: string | null, limit = 30) => get<Page<MemberSummary>>(`/members${qs({ cursor, limit })}`),
  /** RFC §10.16: the @ list in the composer (up to 8 seated members) */
  mentionMembers: (q: string) => get<{ items: { handle: string; displayName: string; gender: Gender | null }[] }>(`/members/mention${qs({ q })}`),
  member: (handle: string) => get<MemberSummary>(`/members/${encodeURIComponent(handle)}`),
  /** RFC §10.17: Pet Corner — the newest pet posts; a pet's page; your own pets */
  pets: (cursor?: string | null, limit = 20) => get<Page<PetPost>>(`/pets${qs({ cursor, limit })}`),
  myPets: () => get<{ items: Pet[] }>('/pets/mine'),
  pet: (id: string) => get<{ pet: Pet; posts: PetPost[] }>(`/pets/${encodeURIComponent(id)}`),
  createPet: (b: { name: string; species: PetSpecies; avatarVariant?: number; avatarId?: string }) => post<Pet>('/pets', b),
  updatePet: (id: string, b: { name?: string; species?: PetSpecies; avatarVariant?: number; avatarId?: string; removeAvatar?: boolean }) =>
    call<Pet>('PATCH', `/pets/${encodeURIComponent(id)}`, b),
  deletePet: (id: string) => call<{ ok: true; posts: number }>('DELETE', `/pets/${encodeURIComponent(id)}`),
  randomPick: (exclude: string[] = []) => get<{ item: Pick | null }>(`/suggestions/random${qs({ exclude: exclude.join(',') })}`),
  votePick: (id: string, vote: 1 | -1, remark?: string | null) =>
    call<Pick>('PUT', `/suggestions/${encodeURIComponent(id)}/vote`, remark === undefined ? { vote } : { vote, remark }),
  unvotePick: (id: string) => call<Pick>('DELETE', `/suggestions/${encodeURIComponent(id)}/vote`),
  pickRemarks: (id: string) => get<{ pick: Pick; items: PickRemark[]; canModerate: boolean }>(`/suggestions/${encodeURIComponent(id)}/remarks`),
  opsRemoveRemark: (id: string, handle: string) =>
    call<{ removed: true }>('DELETE', `/ops/suggestions/${encodeURIComponent(id)}/remarks/${encodeURIComponent(handle)}`),
  suggest: (b: { kind: SuggestionKind; title: string; note?: string | null }) => post<Pick>('/suggestions', b),
  deletePick: (id: string) => call<{ ok: true }>('DELETE', `/suggestions/${encodeURIComponent(id)}`),
  /** RFC §10.4: admins see every pick and can remove any of them */
  opsPicks: () => get<{ items: Pick[] }>('/ops/suggestions'),
  opsRemovePick: (id: string) => call<{ ok: true }>('DELETE', `/ops/suggestions/${encodeURIComponent(id)}`),
  memberPicks: (handle: string) => get<{ items: Pick[] }>(`/members/${encodeURIComponent(handle)}/suggestions`),
  portfolio: (handle: string) => get<Portfolio>(`/members/${encodeURIComponent(handle)}/portfolio`),
  updatePortfolio: (b: PortfolioInput) => call<Portfolio>('PATCH', '/me/portfolio', b),
  projects: (handle: string) => get<{ items: ProjectSummary[]; style: PfStyle }>(`/members/${encodeURIComponent(handle)}/projects`),
  project: (handle: string, id: string) => get<Project>(`/members/${encodeURIComponent(handle)}/projects/${encodeURIComponent(id)}`),
  createProject: (b: ProjectInput) => post<Project>('/me/projects', b),
  updateProject: (id: string, b: ProjectInput) => call<Project>('PATCH', `/me/projects/${encodeURIComponent(id)}`, b),
  deleteProject: (id: string) => call<{ ok: true }>('DELETE', `/me/projects/${encodeURIComponent(id)}`),
  orderProjects: (ids: string[]) => post<{ ok: true }>('/me/projects/order', { ids }),
  flagProject: (id: string, reason?: string) => post<{ flagged: true }>(`/projects/${encodeURIComponent(id)}/flag`, reason ? { reason } : {}),
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
  askToCome: (id: string, note?: string) => post<AnEvent>(`/events/${encodeURIComponent(id)}/request`, note ? { note } : {}),
  withdrawEventRequest: (id: string) => call<AnEvent>('DELETE', `/events/${encodeURIComponent(id)}/request`),
  decideEventRequest: (id: string, handle: string, accept: boolean) =>
    post<EventDetail>(`/events/${encodeURIComponent(id)}/requests/${encodeURIComponent(handle)}/${accept ? 'accept' : 'decline'}`, {}),
  eventSuggestions: (id: string) => get<{ items: CollabSuggestion[] }>(`/events/${encodeURIComponent(id)}/suggestions`),
  inviteToEvent: (id: string, handle: string) => post<EventDetail>(`/events/${encodeURIComponent(id)}/invites`, { handle }),
  declineEventInvite: (id: string) => post<AnEvent>(`/events/${encodeURIComponent(id)}/invite/decline`, {}),
  confirmAttendance: (id: string, handles: string[]) => post<AnEvent>(`/events/${encodeURIComponent(id)}/attendance`, { handles }),

  collabs: (tab: 'for-you' | 'all', interest?: string | null) => get<{ items: CollabSummary[] }>(`/collabs${qs({ tab, interest })}`),
  collab: (id: string) => get<Collab>(`/collabs/${encodeURIComponent(id)}`),
  createCollab: (b: CollabInput) => post<Collab>('/collabs', b),
  updateCollab: (id: string, b: Partial<CollabInput>) => call<Collab>('PATCH', `/collabs/${encodeURIComponent(id)}`, b),
  deleteCollab: (id: string) => call<{ ok: true }>('DELETE', `/collabs/${encodeURIComponent(id)}`),
  joinCollab: (id: string, note?: string) => post<{ joined?: true; requested?: true }>(`/collabs/${encodeURIComponent(id)}/join`, note ? { note } : {}),
  withdrawCollabRequest: (id: string) => call<{ ok: true }>('DELETE', `/collabs/${encodeURIComponent(id)}/request`),
  decideCollabRequest: (id: string, handle: string, accept: boolean) =>
    post<Collab>(`/collabs/${encodeURIComponent(id)}/requests/${encodeURIComponent(handle)}/${accept ? 'accept' : 'decline'}`, {}),
  collabSuggestions: (id: string) => get<{ items: CollabSuggestion[] }>(`/collabs/${encodeURIComponent(id)}/suggestions`),
  inviteToCollab: (id: string, handle: string) => post<Collab>(`/collabs/${encodeURIComponent(id)}/invites`, { handle }),
  answerCollabInvite: (id: string, accept: boolean) => post<{ joined?: true; ok?: true }>(`/collabs/${encodeURIComponent(id)}/invite/${accept ? 'accept' : 'decline'}`, {}),
  leaveCollab: (id: string) => post<{ ok: true }>(`/collabs/${encodeURIComponent(id)}/leave`, {}),
  setCollabRole: (id: string, handle: string, role: 'cohost' | 'member') =>
    post<Collab>(`/collabs/${encodeURIComponent(id)}/members/${encodeURIComponent(handle)}/role`, { role }),
  removeFromCollab: (id: string, handle: string) => call<Collab>('DELETE', `/collabs/${encodeURIComponent(id)}/members/${encodeURIComponent(handle)}`),
  collabUpdates: (id: string, cursor?: string | null, limit = 20) => get<Page<Post>>(`/collabs/${encodeURIComponent(id)}/updates${qs({ cursor, limit })}`),
  eventUpdates: (id: string, cursor?: string | null, limit = 20) => get<Page<Post>>(`/events/${encodeURIComponent(id)}/updates${qs({ cursor, limit })}`),
  memberCollabs: (handle: string) => get<{ items: CollabSummary[] }>(`/members/${encodeURIComponent(handle)}/collabs`),

  myConsultOffer: () => get<MyConsultOffer>('/me/consult-offer'),
  saveConsultOffer: (b: ConsultOfferInput) => call<MyConsultOffer>('PUT', '/me/consult-offer', b),
  consultOffer: (handle: string) => get<{ offer: ConsultOffer | null }>(`/members/${encodeURIComponent(handle)}/consult-offer`),
  consultThanks: (handle: string) => get<{ items: ThanksNote[] }>(`/members/${encodeURIComponent(handle)}/consult-thanks`),
  flagConsultOffer: (handle: string, reason?: string) => post<{ flagged: true }>(`/members/${encodeURIComponent(handle)}/consult-offer/flag`, reason ? { reason } : {}),
  requestConsultation: (handle: string, b: ConsultRequestInput) => post<Consultation>(`/members/${encodeURIComponent(handle)}/consultations`, b),
  consultations: (box: 'received' | 'sent') => get<{ items: Consultation[]; waiting: number }>(`/consultations${qs({ box })}`),
  consultWaiting: () => get<{ waiting: number }>('/consultations/waiting'),
  consultation: (id: string) => get<Consultation>(`/consultations/${encodeURIComponent(id)}`),
  acceptConsultation: (id: string, b: { pricing: ConsultPricing; priceNote?: string | null; paymentUrl?: string | null }) =>
    post<Consultation>(`/consultations/${encodeURIComponent(id)}/accept`, b),
  declineConsultation: (id: string) => post<Consultation>(`/consultations/${encodeURIComponent(id)}/decline`, {}),
  agreeConsultation: (id: string) => post<Consultation>(`/consultations/${encodeURIComponent(id)}/agree`, {}),
  closeConsultation: (id: string) => post<Consultation>(`/consultations/${encodeURIComponent(id)}/close`, {}),
  doneConsultation: (id: string) => post<Consultation>(`/consultations/${encodeURIComponent(id)}/done`, {}),
  thankConsultation: (id: string, text: string | null) => call<Consultation>('PUT', `/consultations/${encodeURIComponent(id)}/thanks`, { text }),
  hideConsultThanks: (id: string, hidden: boolean) => post<Consultation>(`/consultations/${encodeURIComponent(id)}/thanks/hidden`, { hidden }),
  flagConsultation: (id: string, reason?: string) => post<{ flagged: true }>(`/consultations/${encodeURIComponent(id)}/flag`, reason ? { reason } : {}),
  opsConsultations: () => get<OpsConsultation[]>('/ops/consultations'),
  opsConsultation: (id: string) => get<OpsConsultationDetail>(`/ops/consultations/${encodeURIComponent(id)}`),
  opsResolveConsultation: (id: string, resolution: 'restored' | 'removed') =>
    post<{ resolution: string }>(`/ops/consultations/${encodeURIComponent(id)}/resolve`, { resolution }),
  opsResolveConsultOffer: (handle: string, resolution: 'restored' | 'removed') =>
    post<{ resolution: string }>(`/ops/consult-offers/${encodeURIComponent(handle)}/resolve`, { resolution }),
  opsSetConsulting: (handle: string, on: boolean) => post<{ switchedOn?: true; switchedOff?: true }>(`/ops/users/${encodeURIComponent(handle)}/consulting`, { on }),

  pushConfig: () => get<{ enabled: boolean; publicKey: string | null }>('/push/config'),
  pushSubscribe: (b: { endpoint: string; keys: { p256dh: string; auth: string } }) => post<{ ok: true }>('/push/subscriptions', b),
  pushUnsubscribe: (endpoint: string) => call<{ ok: true }>('DELETE', '/push/subscriptions', { endpoint }),

  opsFlags: () => get<FlagItem[]>('/ops/flags'),
  opsResolvePost: (id: string, resolution: 'restored' | 'removed') =>
    post<{ resolution: string }>(`/ops/flags/${encodeURIComponent(id)}/resolve`, { resolution }),
  opsResolveCollab: (id: string, resolution: 'restored' | 'removed') =>
    post<{ resolution: string }>(`/ops/collabs/${encodeURIComponent(id)}/resolve`, { resolution }),
  opsRemoveCollab: (id: string) => post<{ removed: true }>(`/ops/collabs/${encodeURIComponent(id)}/remove`, {}),
  flagCollab: (id: string, reason?: string) => post<{ flagged: true }>(`/collabs/${encodeURIComponent(id)}/flag`, reason ? { reason } : {}),
  opsResolveProject: (id: string, resolution: 'restored' | 'removed') =>
    post<{ resolution: string }>(`/ops/projects/${encodeURIComponent(id)}/resolve`, { resolution }),
  opsBan: (handle: string) => post<{ banned: string }>(`/ops/users/${encodeURIComponent(handle)}/ban`, {}),
  opsUnban: (handle: string) => post<{ handle: string; state: UserState }>(`/ops/users/${encodeURIComponent(handle)}/unban`, {}),
  opsSetRole: (handle: string, role: 'ops' | 'member') =>
    post<{ handle: string; role: string }>(`/ops/users/${encodeURIComponent(handle)}/role`, { role }),
  opsRename: (handle: string, next: string) =>
    post<{ from: string; handle: string }>(`/ops/users/${encodeURIComponent(handle)}/handle`, { handle: next }),
  opsMembers: () => get<AdminMember[]>('/ops/members'),
  opsSetBirthday: (handle: string, birthday: string, confirmUnderage = false) =>
    post<{ handle: string; age: number; closed: boolean }>(`/ops/users/${encodeURIComponent(handle)}/birthday`, { birthday, confirmUnderage }),
  opsRemovePost: (id: string) => post<{ removed: true }>(`/ops/posts/${encodeURIComponent(id)}/remove`, {}),
  opsRemoveProject: (id: string) => post<{ removed: true }>(`/ops/projects/${encodeURIComponent(id)}/remove`, {}),
  opsSettings: () => get<AdminSettings>('/ops/settings'),
  opsUpdateSettings: (b: Partial<Omit<AdminSettings, 'seatsUsed' | 'screenTime'>> & { screenTime?: 0 | 1 }) => call<AdminSettings>('PATCH', '/ops/settings', b),
  opsInvites: (count: number) => post<{ code: string; expiresAt: string }[]>('/ops/invites', { count }),
  seats: () => get<{ cap: number; used: number }>('/seats'),

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
  setup_required: 'Finish setting up your profile first.',
  bad_origin: 'Request blocked. Reload the page and try again.',
  invite_invalid: 'That invite code is not valid, or has already been used.',
  handle_invalid: 'Handles are 3–20 letters, digits or underscores, start with a letter, and a few words (like admin) are reserved.',
  handle_taken: 'That handle is taken.',
  passkey_invalid: 'That passkey was not recognised.',
  account_unavailable: 'This account is unavailable.',
  recovery_failed: 'Handle or recovery code is incorrect.',
  last_passkey: 'Choose a PIN first: this passkey is your only way in.',
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
  project_limit: 'A portfolio holds up to 12 projects. Remove one to add another.',
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
  own_project: 'You cannot report your own project.',
  own_pick: 'You cannot vote on your own pick.',
  no_open_flags: 'Those reports were already handled. Refresh the list.',
  cannot_ban_ops: 'That member is an admin. Remove their admin role first.',
  already_gone: 'That member is already banned or deleted.',
  not_banned: 'That member is not banned.',
  last_admin: 'The site needs at least one admin. Make someone else admin first.',
  not_seated: 'Only members with a seat can be admins.',
  capacity_below_going: 'More people are already going than that capacity allows.',
  attendance_closed: 'Attendance can be confirmed from the start time until 14 days after.',
  consult_age: 'Consultations are for members 18 and over.',
  consult_blocked: 'An admin switched your consulting off. You can still finish the sessions already agreed.',
  consult_open_limit: 'You already have 3 open requests with them. Finish or close one first.',
  own_offer: 'That is your own offer.',
  not_consultant: 'Only the person asked can do that.',
  not_requester: 'Only the person who asked can do that.',
  visitor_readonly: 'Visitors can only watch.',
  visitor_expired: 'Your hour is up.',
  rest_time: 'That is your half hour. Come back in an hour.',
  visitor_pass_invalid: 'That visitor code is not valid, or has expired.',
  visitor_pass_used: 'This pass has already been used.',
  already_member: 'You are already a member. No pass needed.',
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
