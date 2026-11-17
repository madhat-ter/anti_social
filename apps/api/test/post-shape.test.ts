import { describe, expect, test } from 'bun:test';
import { FEED, postShape } from '@anti/shared';

/** RFC §10.15: a post's shape in a list, so a photo, a status and a story never look alike. */
describe('postShape', () => {
  test('any image makes it a photo post, with or without words', () => {
    expect(postShape('', 1)).toBe('photo');
    expect(postShape('Sunset from the ridge.', 3)).toBe('photo');
    expect(postShape('x'.repeat(1200), 2)).toBe('photo');
  });

  test('a monologue is a tape, whatever its note says (RFC §10.22)', () => {
    expect(postShape('', 0, true)).toBe('tape');
    expect(postShape('x'.repeat(1200), 0, true)).toBe('tape');
  });

  test('a few words with no image is a short note', () => {
    expect(postShape('Good morning.', 0)).toBe('short');
    expect(postShape('x'.repeat(FEED.shortMaxChars), 0)).toBe('short');
    expect(postShape(`  ${'x'.repeat(FEED.shortMaxChars)}  \n`, 0)).toBe('short'); // edges trimmed
  });

  test('past the length, or on too many lines, it is a text post', () => {
    expect(postShape('x'.repeat(FEED.shortMaxChars + 1), 0)).toBe('text');
    expect(postShape('a\nb\nc', 0)).toBe('short');
    expect(postShape('a\nb\nc\nd', 0)).toBe('text');
  });
});
