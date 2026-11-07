/**
 * Invite codes look like `K7QF-M2XP-9HTR-WC4D` (16 chars from a 32-char alphabet = 80 bits).
 * Users may type them in any case, with or without dashes; normalise before hashing.
 */
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1

export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatInviteCode(normalized: string): string {
  return normalized.match(/.{1,4}/g)?.join('-') ?? normalized;
}

export function isWellFormedInviteCode(input: string): boolean {
  const n = normalizeInviteCode(input);
  return n.length === 16 && [...n].every((c) => INVITE_ALPHABET.includes(c));
}
