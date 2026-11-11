/**
 * RFC §10.22: the small shared pieces behind the cassettes. One tape plays at a time, the screen
 * timer counts listening as time on the site (even with the screen off), and a recording's length
 * and waveform are measured here, in the browser, before it is sent.
 */
import { MONOLOGUE } from '@anti/shared';

const PLAY_EVENT = 'anti:tape-play';
let playingId: string | null = null;

/** A tape started: every other one stops. */
export function claimPlayback(id: string) {
  playingId = id;
  window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: id }));
}
export function releasePlayback(id: string) {
  if (playingId === id) playingId = null;
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
