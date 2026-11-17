import { describe, expect, test } from 'bun:test';
import { foldBusy, type Foldable } from '@anti/shared';

/** RFC §10.11: the fold is a display rule; it never reorders or drops a post. */
const day = (iso: string) => iso.slice(0, 10);
let n = 0;
const post = (handle: string | null, createdAt: string, extra: Partial<Foldable> = {}): Foldable => ({
  id: `p${++n}`, createdAt, author: handle ? { handle } : null, ...extra,
});
const ids = (xs: ReturnType<typeof foldBusy>) =>
  xs.flatMap((x) => (x.kind === 'post' ? [x.post.id] : x.posts.map((p) => p.id)));

describe('foldBusy', () => {
  test('five posts by one author in a day: two open, one fold of three, in place', () => {
    const mina = ['10', '09', '08', '07', '06'].map((h) => post('mina', `2026-11-09T${h}:00:00.000Z`));
    const other = post('ravi', '2026-11-09T07:30:00.000Z');
    const list = [mina[0]!, mina[1]!, mina[2]!, mina[3]!, other, mina[4]!];
    const out = foldBusy(list, 'vee', day, 2);
    expect(out.map((x) => (x.kind === 'post' ? x.post.id : `fold:${x.posts.length}`))).toEqual([
      mina[0]!.id, mina[1]!.id, 'fold:3', other.id,
    ]);
    // nothing is dropped; the fold holds mina's extra posts newest first, opened where it stands
    expect(ids(out)).toEqual([mina[0]!.id, mina[1]!.id, mina[2]!.id, mina[3]!.id, mina[4]!.id, other.id]);
    expect(ids(out).length).toBe(list.length);
    expect(new Set(ids(out))).toEqual(new Set(list.map((p) => p.id)));
  });

  test('the viewer, newcomers, first posts and deleted authors are never folded', () => {
    const t = (h: string) => `2026-11-09T${h}:00:00.000Z`;
    const mine = ['10', '09', '08'].map((h) => post('vee', t(h)));
    const fresh = ['10', '09', '08'].map((h) => post('newbie', t(h), { author: { handle: 'newbie', isNew: true } }));
    const ghosts = ['10', '09', '08'].map((h) => post(null, t(h)));
    const out = foldBusy([...mine, ...fresh, ...ghosts], 'vee', day, 2);
    expect(out.every((x) => x.kind === 'post')).toBe(true);
    const first = [post('mina', t('10')), post('mina', t('09')), post('mina', t('08'), { firstPost: true })];
    expect(foldBusy(first, 'vee', day, 2).every((x) => x.kind === 'post')).toBe(true);
  });

  test('a day boundary splits the count', () => {
    const list = [
      post('mina', '2026-11-10T01:00:00.000Z'), post('mina', '2026-11-10T00:30:00.000Z'),
      post('mina', '2026-11-09T23:00:00.000Z'), post('mina', '2026-11-09T22:00:00.000Z'),
    ];
    expect(foldBusy(list, null, day, 2).every((x) => x.kind === 'post')).toBe(true);
    const more = [...list, post('mina', '2026-11-09T21:00:00.000Z')];
    const out = foldBusy(more, null, day, 2);
    expect(out.filter((x) => x.kind === 'fold').length).toBe(1);
    expect(ids(out)).toEqual(more.map((p) => p.id));
  });
});
