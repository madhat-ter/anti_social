/** 3–20 chars, starts with a letter, letters/digits/underscore. Case-insensitively unique. */
export const HANDLE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;

export const RESERVED_HANDLES = new Set([
  'admin', 'ops', 'root', 'system', 'support', 'api', 'www', 'settings', 'join', 'login', 'recover',
]);

export function validateHandle(handle: string): string | null {
  if (!HANDLE_PATTERN.test(handle)) return 'Handle must be 3–20 characters: letters, digits, underscore, starting with a letter.';
  if (RESERVED_HANDLES.has(handle.toLowerCase())) return 'That handle is reserved.';
  return null;
}

export const DISPLAY_NAME_MAX = 50;
