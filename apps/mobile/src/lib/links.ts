/**
 * Where a website address goes in the app (RFC §10.32). The app has its own screens for the
 * everyday rooms (feed, threads, profiles, Collab, Monologue, Members, the bell, Settings); the
 * rest (the File, Pet Corner, consultations, portfolios, admin, making a collab or event) opens
 * the website in the phone's browser, which asks for the handle and PIN once.
 */
import { router, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { SITE_URL } from './api';

/** the app screen for a site path, or null when only the website has it */
export function appRoute(path: string): Href | null {
  const [p] = path.split(/[?#]/);
  const clean = (p ?? '/').replace(/\/+$/, '') || '/';
  let m: RegExpMatchArray | null;
  if (clean === '/') return '/';
  if (clean === '/collab') return '/collab';
  if (clean === '/monologue') return '/monologue';
  if (clean === '/members' || clean === '/search') return '/members';
  if (clean === '/notifications') return '/notifications';
  if (clean === '/settings') return '/settings';
  if ((m = clean.match(/^\/p\/([^/]+)$/))) return { pathname: '/p/[id]', params: { id: m[1]!, focus: path.split('#')[1] ?? '' } };
  if ((m = clean.match(/^\/u\/([^/]+)$/))) return { pathname: '/u/[handle]', params: { handle: decodeURIComponent(m[1]!) } };
  if ((m = clean.match(/^\/collab\/event\/([^/]+)$/))) return { pathname: '/collab/event/[id]', params: { id: m[1]! } };
  if ((m = clean.match(/^\/collab\/([^/]+)$/)) && m[1] !== 'new') return { pathname: '/collab/[id]', params: { id: m[1]! } };
  return null;
}

/** open a page of the website in the phone's browser */
export async function openSite(path: string) {
  await WebBrowser.openBrowserAsync(`${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  });
}

/** follow a site path: in the app when it has the screen, else on the website */
export function go(path: string) {
  const r = appRoute(path);
  if (r) router.push(r);
  else void openSite(path);
}
