/**
 * RFC §10.22: the small shared pieces behind the cassettes. One tape plays at a time, the screen
 * timer counts listening as time on the site (even with the screen off), and a recording's length
 * and waveform are measured here, in the browser, before it is sent.
 */
import { MONOLOGUE } from '@anti/shared';

const PLAY_EVENT = 'anti:tape-play';
let playingId: string | null = null;
/** the tape last played (paused or not): Space goes back to it */
let lastId: string | null = null;

/** A tape started: every other one stops. */
export function claimPlayback(id: string) {
  playingId = id;
  lastId = id;
  window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: id }));
}
export function releasePlayback(id: string) {
  if (playingId === id) playingId = null;
}

/** What the keyboard can do to a tape on the page. */
export type TapeControl = {
  toggle: () => void;
  seekBy: (ms: number) => void;
  /** one step slower (-1) or faster (1) through 1×, 1.5×, 2× */
  speed: (dir: 1 | -1) => void;
  el: () => HTMLElement | null;
};
const tapes = new Map<string, TapeControl>();
export function registerTape(id: string, c: TapeControl) {
  tapes.set(id, c);
  return () => { if (tapes.get(id) === c) tapes.delete(id); };
}

const onScreen = (el: HTMLElement | null) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.bottom > 40 && r.top < window.innerHeight - 40 && r.width > 0;
};

/**
 * The tape a key means: the one playing; else the one last played, if it is still on screen; else
 * the one in the post that has focus (J / K); else the first one on screen. Null: no tape here.
 */
function target(): TapeControl | null {
  if (playingId && tapes.has(playingId)) return tapes.get(playingId)!;
  const last = lastId ? tapes.get(lastId) : undefined;
  if (last && onScreen(last.el())) return last;
  const post = (document.activeElement as HTMLElement | null)?.closest?.('article.post');
  if (post) for (const c of tapes.values()) if (post.contains(c.el())) return c;
  let best: TapeControl | null = null;
  let top = Infinity;
  for (const c of tapes.values()) {
    const el = c.el();
    if (!onScreen(el)) continue;
    const t = el!.getBoundingClientRect().top;
    if (t < top) { top = t; best = c; }
  }
  return best;
}

/** Things that take Space themselves: buttons, links, fields, the waveform slider. */
const OWNS_KEYS = 'button, a[href], input, textarea, select, summary, [role=slider], [contenteditable=""], [contenteditable=true]';

/**
 * RFC §10.22, the keyboard on a computer (YouTube's and Spotify's habits): Space plays or pauses,
 * ← → jump 5 seconds, Shift + > / < go faster or slower. Arrows and speed only once a tape has been
 * played on this page, so they never steal the keys from anything else. True when it acted.
 */
export function tapeKey(e: KeyboardEvent): boolean {
  const focus = document.activeElement as HTMLElement | null;
  const owned = !!focus && focus !== document.body && focus.matches(OWNS_KEYS);
  if (e.key === ' ' || e.code === 'Space') {
    if (owned) return false; // a focused button (the cassette itself too) or field handles its own Space
    const t = target();
    if (!t) return false;
    e.preventDefault(); // not a page scroll
    if (!e.repeat) t.toggle();
    return true;
  }
  const active = (playingId && tapes.get(playingId)) || (lastId && tapes.get(lastId)) || null;
  if (!active || owned) return false;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    active.seekBy(e.key === 'ArrowRight' ? 5000 : -5000);
    return true;
  }
  if (e.key === '>' || e.key === '<') {
    e.preventDefault();
    active.speed(e.key === '>' ? 1 : -1);
    return true;
  }
  return false;
}
/** for the screen timer (RFC §10.10): listening counts even when the tab is in the back */
export const tapePlaying = () => playingId !== null;
export function onOtherPlay(id: string, stop: () => void) {
  const h = (e: Event) => { if ((e as CustomEvent<string>).detail !== id) stop(); };
  window.addEventListener(PLAY_EVENT, h);
  return () => window.removeEventListener(PLAY_EVENT, h);
}

/** "4:12" */
export const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The first recording format this browser can make: WebM on most, MP4 on older iPhones. */
export function recorderType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

/**
 * Length and waveform of a recording, from the decoded sound itself (a WebM straight from a
 * recorder does not know its own length). Bars are the loudest moment in each slice, scaled so
 * the loudest bar is 100.
 */
export async function measure(blob: Blob): Promise<{ durationMs: number; peaks: number[] }> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new Ctx();
  try {
    const buf = await ac.decodeAudioData(await blob.arrayBuffer());
    const data = buf.getChannelData(0);
    const n = MONOLOGUE.peaks;
    const step = Math.max(1, Math.floor(data.length / n));
    const raw: number[] = [];
    for (let i = 0; i < n; i++) {
      let max = 0;
      const end = Math.min(data.length, (i + 1) * step);
      for (let j = i * step; j < end; j += 16) { const v = Math.abs(data[j]!); if (v > max) max = v; }
      raw.push(max);
    }
    const top = Math.max(...raw, 0.0001);
    // a square root lifts the quiet parts, so speech does not read as a flat line
    return { durationMs: Math.round(buf.duration * 1000), peaks: raw.map((v) => Math.round(Math.sqrt(v / top) * 100)) };
  } finally {
    void ac.close();
  }
}
