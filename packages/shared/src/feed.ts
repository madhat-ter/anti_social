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
export type PostShape = 'photo' | 'short' | 'text';
export function postShape(body: string, imageCount: number): PostShape {
  if (imageCount > 0) return 'photo';
  const t = body.trim();
  if (t.length <= FEED.shortMaxChars && t.split('\n').length <= FEED.shortMaxLines) return 'short';
  return 'text';
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
