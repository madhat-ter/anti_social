/**
 * RFC §10.14: light or dark. Light for everyone until they choose Dark in Settings; the device's
 * own dark mode is ignored on purpose. The choice lives on the account (so it follows the member to
 * every device) and is copied into a cookie, so the server can paint the first frame dark and a
 * dark page never flashes white. Signed-out pages and visitors are always light.
 */
import type { Me } from './api';

export type Theme = 'light' | 'dark';
export const THEME_COOKIE = 'anti_theme';

/** Puts a theme on the page, and remembers it in the cookie the server reads before painting. */
export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') root.dataset.theme = 'dark'; else delete root.dataset.theme;
  const secure = location.protocol === 'https:' ? '; secure' : '';
  document.cookie = theme === 'dark'
    ? `${THEME_COOKIE}=dark; path=/; max-age=31536000; samesite=lax${secure}`
    : `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
}

/**
 * Follows who is signed in: a member's own choice; nobody (or a visitor) gets light on screen,
 * but the cookie is left alone so the member's next sign-in on this device opens dark straight away.
 */
export function syncTheme(me: Me | null) {
  if (typeof document === 'undefined') return;
  if (me && !me.visitor) applyTheme(me.theme === 'dark' ? 'dark' : 'light');
  else delete document.documentElement.dataset.theme;
}
