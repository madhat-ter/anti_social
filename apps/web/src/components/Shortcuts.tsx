'use client';
/**
 * Keyboard shortcuts for wide screens (owner's call, 2026-11-09): N writes a post, / searches,
 * J and K step through posts, Enter opens the one in focus, Esc leaves a text box, ? lists them.
 * RFC §10.22 adds the monologue keys (lib/tape.ts): Space plays or pauses, ← → jump 5 s, < > speed.
 * Keys do nothing while you type, with Ctrl/Cmd/Alt held, or while a dialog is open (dialogs have
 * their own keys). Rendered under the menu as a small "? Keyboard shortcuts" line, which also
 * opens the list; hidden on phones and touch screens.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useReadOnly } from './Visitor';
import { tapeKey } from '@/lib/tape';

const KEYS: [string, string][] = [
  ['N', 'Write a post'],
  ['/', 'Search (or the search box on this page)'],
  ['J', 'Next post'],
  ['K', 'Previous post'],
  ['Enter', 'Open the post in focus'],
  ['Space', 'Play or pause a monologue: the one playing, else the one on screen'],
  ['← →', 'Back or forward 5 seconds in it'],
  ['< >', 'Slower or faster: 1×, 1.5×, 2× (Shift + comma or period)'],
  ['Esc', 'Leave a text box, close a window'],
  ['?', 'This list'],
];

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};
/** Next keeps pages already seen in the document, hidden: only what is on screen counts. */
const onScreen = (el: HTMLElement) => (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null);

/**
 * Focuses `selector` on page `path` as soon as both are there (after a navigation), for up to three
 * seconds. Waiting for the address keeps it off the page being left, which stays on screen a moment.
 */
function focusWhenThere(selector: string, path: string) {
  const until = Date.now() + 3000;
  const tick = () => {
    const el = window.location.pathname === path ? [...document.querySelectorAll<HTMLElement>(selector)].find(onScreen) : undefined;
    if (el && !(el as HTMLInputElement).disabled) { el.focus(); el.scrollIntoView({ block: 'center' }); return; }
    if (Date.now() < until) requestAnimationFrame(tick);
  };
  tick();
}

/** J / K: from the post in focus, or else from the one at the top of the screen. */
function step(dir: 1 | -1) {
  const posts = [...document.querySelectorAll<HTMLElement>('.posts article.post')].filter(onScreen);
  if (!posts.length) return;
  const at = posts.indexOf(document.activeElement as HTMLElement);
  let target: HTMLElement | undefined;
  if (at >= 0) target = posts[at + dir];
  else {
    const line = parseFloat(getComputedStyle(posts[0]!).scrollMarginTop) || 0;
    target = dir === 1 ? posts.find((p) => p.getBoundingClientRect().top > line + 4)
      : [...posts].reverse().find((p) => p.getBoundingClientRect().top < line - 4);
  }
  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start' });
}

export function Shortcuts() {
  const router = useRouter();
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (e.key === 'Escape') { if (typing(e.target)) (e.target as HTMLElement).blur(); return; }
      if (typing(e.target) || document.querySelector('dialog[open]')) return;
      if (tapeKey(e)) return;
      const k = e.key;
      if (k === '?') { e.preventDefault(); setOpen(true); }
      else if (k === 'n' || k === 'N') {
        if (readOnly) return;
        e.preventDefault();
        // the address now, not the last render's (right after a navigation they differ)
        if (window.location.pathname !== '/') router.push('/#compose');
        focusWhenThere('#compose textarea', '/');
      } else if (k === '/') {
        e.preventDefault();
        // a page with its own search box (Members, Admin, Search): that one; elsewhere the Search page
        const here = [...document.querySelectorAll<HTMLElement>('.shell-main input[type=search]')].find(onScreen);
        if (here) { here.focus(); return; }
        router.push('/search');
        focusWhenThere('.shell-main input[type=search]', '/search');
      } else if (k === 'j' || k === 'J') { e.preventDefault(); step(1); }
      else if (k === 'k' || k === 'K') { e.preventDefault(); step(-1); }
      else if (k === 'Enter') {
        const a = document.activeElement as HTMLElement | null;
        if (a?.matches('.posts article.post')) {
          const link = a.querySelector<HTMLAnchorElement>('.post-head a.time');
          if (link) { e.preventDefault(); link.click(); }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly, router]);

  return (
    <>
      <button type="button" className="link-btn kbd-hint" onClick={() => setOpen(true)}>
        <kbd>?</kbd> Keyboard shortcuts
      </button>
      <dialog ref={ref} className="dlg" aria-labelledby={`${id}-t`}
        onCancel={(e) => { e.preventDefault(); setOpen(false); }} onClick={(e) => { if (e.target === ref.current) setOpen(false); }}>
        <div className="win">
          <div className="win-bar">
            <button type="button" className="win-close" onClick={() => setOpen(false)} aria-label="Close" />
            <span className="win-title" id={`${id}-t`}>Keyboard shortcuts</span>
          </div>
          <div className="win-body stack">
            <dl className="kbd-list">
              {KEYS.filter(([k]) => !(readOnly && k === 'N')).map(([k, what]) => (
                <div key={k}><dt><kbd>{k}</kbd></dt><dd>{what}</dd></div>
              ))}
            </dl>
            <p className="meta">They do nothing while you are typing in a box. Your keyboard&rsquo;s own play/pause key works on a monologue too.</p>
            <div className="row dlg-actions"><button type="button" className="btn default" onClick={() => setOpen(false)}>Close</button></div>
          </div>
        </div>
      </dialog>
    </>
  );
}
