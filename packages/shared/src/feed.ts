import { FEED } from './rules';

/** The bits of a post the fold looks at (the API's and the app's Post both fit). */
export type Foldable = {
  id: string;
  createdAt: string;
  author: { handle: string; isNew?: boolean } | null;
  firstPost?: boolean;
};

/**
 * RFC §10.15, a post's shape in a list, so a photo, a quick status and a story never look alike:
 * 'photo' (any image: the picture runs the card's full width, the text under it as a caption),
 * 'short' (a few words, set large as a note) or 'text' (everything else, folded past
 * `FEED.clampLines` lines). Pure, so the app and the tests agree.
 */
export type PostShape = 'tape' | 'photo' | 'short' | 'text';
/** `tape`: the post is a monologue (RFC §10.22): the cassette leads, the words are its note. */
export function postShape(body: string, imageCount: number, tape = false): PostShape {
  if (tape) return 'tape';
  if (imageCount > 0) return 'photo';
  const t = body.trim();
  if (t.length <= FEED.shortMaxChars && t.split('\n').length <= FEED.shortMaxLines) return 'short';
  return 'text';
}

/** The bits of a post the mix looks at. */
export type Mixable = { id: string; createdAt: string; author: { handle: string } | null };

/**
 * A number in (0, 1) from a seed and a post id. The same pair always gives the same number, so a
 * visit's mix is the same on every page and every reload (FNV-1a, then murmur3's finaliser).
 */
export function mixRand(seed: number, id: string): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) + 0.5) / 4294967296;
}

const newestFirst = (a: Mixable, b: Mixable) => {
  const d = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  return d !== 0 ? d : b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
};

/**
 * RFC §10.23, the mix: what is new since your last visit, in an order that is fair rather than
 * strictly by time. Only time and who posted go in: likes, replies and clicks never do.
 *
 * 1. The newest post stays first.
 * 2. The rest draw lots, and newer posts hold better tickets: a post's weight halves every
 *    `halfLifeHours` of age (counted from the newest post, so the order does not drift with the
 *    clock). The draw is Efraimidis and Spirakis's weighted sampling (2006): key = -ln(u) / weight,
 *    smallest first, with u from `mixRand(seed, id)`.
 * 3. Then the same person is spread out (the way Spotify spreads one artist through a shuffle):
 *    each next place takes the best-drawn post whose author is not among the last `gap` placed,
 *    narrowing the gap only when nobody else is left. Never twice in a row while anyone else
 *    still has a post waiting.
 *
 * Pure and seeded, so the server, the tests and a reload agree.
 */
export function mixFeed<P extends Mixable>(
  posts: readonly P[], seed: number,
  { halfLifeHours = FEED.mixHalfLifeHours, gap = FEED.mixGap }: { halfLifeHours?: number; gap?: number } = {},
): P[] {
  const byTime = [...posts].sort(newestFirst);
  if (byTime.length <= 2) return byTime;
  const [top, ...rest] = byTime as [P, ...P[]];
  const t0 = Date.parse(top.createdAt);
  const drawn = rest
    .map((p) => {
      const ageHours = Math.max(0, t0 - Date.parse(p.createdAt)) / 3_600_000;
      const weight = 2 ** (-ageHours / halfLifeHours);
      return { p, key: -Math.log(mixRand(seed, p.id)) / weight };
    })
    .sort((a, b) => a.key - b.key || newestFirst(a.p, b.p))
    .map((x) => x.p);

  // a deleted author has no handle: each of their posts counts as its own person
  const who = (p: P) => p.author?.handle ?? `~${p.id}`;
  const out: P[] = [top];
  const left = drawn;
  const remaining = new Map<string, number>();
  for (const p of left) remaining.set(who(p), (remaining.get(who(p)) ?? 0) + 1);
  while (left.length) {
    let pick = 0;
    for (let g = gap; g >= 1; g--) {
      const recent = new Set(out.slice(-g).map(who));
      const i = left.findIndex((p) => !recent.has(who(p)));
      if (i < 0) continue;
      pick = i;
      // someone with so many posts left that they would end up bunched at the bottom goes now
      // (n posts g apart need (n-1)(g+1)+1 places); the most pressed first, best-drawn post first
      let worst = 0;
      for (const [h, n] of remaining) {
        if (recent.has(h) || (n - 1) * (g + 1) + 1 < left.length || n <= worst) continue;
        const j = left.findIndex((p) => who(p) === h);
        if (j >= 0) { pick = j; worst = n; }
      }
      break;
    }
    const [next] = left.splice(pick, 1);
    remaining.set(who(next!), remaining.get(who(next!))! - 1);
    out.push(next!);
  }
  return out;
}

export type FeedItem<P> =
  | { kind: 'post'; post: P }
  /** "3 more from Mina today": one author's extra posts that day, in feed order */
  | { kind: 'fold'; key: string; handle: string; posts: P[] };

/**
 * RFC §10.11, the fold: on any one day, an author's first `after` posts in the list stay open and
 * the rest collapse into one row, placed where the first of them would have been. Order never
 * changes and nothing is dropped: opening the row shows those posts right there.
 *
 * Never folded: your own posts, members in their first three weeks (`author.isNew`), anyone's
 * first post, and deleted authors. `dayKey` turns a time into the viewer's local day, the same
 * boundary the day headers draw. Pure, so the server, the app and the tests agree.
 */
export function foldBusy<P extends Foldable>(
  posts: readonly P[], viewer: string | null, dayKey: (iso: string) => string, after: number = FEED.foldAfter,
): FeedItem<P>[] {
  const seen = new Map<string, number>();
  const folds = new Map<string, Extract<FeedItem<P>, { kind: 'fold' }>>();
  const out: FeedItem<P>[] = [];
  for (const post of posts) {
    const a = post.author;
    if (!a || a.handle === viewer || a.isNew || post.firstPost) {
      out.push({ kind: 'post', post });
      continue;
    }
    const key = `${a.handle}|${dayKey(post.createdAt)}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n <= after) {
      out.push({ kind: 'post', post });
      continue;
    }
    const fold = folds.get(key);
    if (fold) fold.posts.push(post);
    else {
      const row = { kind: 'fold' as const, key, handle: a.handle, posts: [post] };
      folds.set(key, row);
      out.push(row);
    }
  }
  return out;
}
