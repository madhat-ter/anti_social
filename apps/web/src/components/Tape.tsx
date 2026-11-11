'use client';
/**
 * RFC §10.22: a monologue is drawn as a cassette. Bold ink outlines and a label strip (the kind
 * sits in the SIDE box, the title on the label line, the length in the corner). While it plays the
 * reels turn and the tape winds from the left reel to the right one, so the cassette is its own
 * progress bar; tap the cassette to play or pause, and the thin waveform under it is for jumping
 * around. One tape plays at a time.
 * Every colour is a CSS variable, so dark mode draws it in white on black.
 */
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { MONOLOGUE_KIND_LABEL, type MonologueKind } from '@anti/shared';
import { api, type Post } from '@/lib/api';
import { claimPlayback, clock, onOtherPlay, releasePlayback } from '@/lib/tape';

const HUB = 15;
const PACK = 40;
/** tape pack radius for the share of tape on that reel (the area, not the radius, is shared) */
const pack = (share: number) => Math.sqrt(HUB * HUB + (PACK * PACK - HUB * HUB) * Math.max(0, Math.min(1, share)));

function Screw({ x, y }: { x: number; y: number }) {
  return (
    <g className="t-screw">
      <circle cx={x} cy={y} r={5} />
      <path d={`M${x - 3} ${y}h6M${x} ${y - 3}v6`} />
    </g>
  );
}

function Reel({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g>
      <circle className="t-pack" cx={cx} cy={cy} r={r} />
      {r > HUB + 6 && <circle className="t-groove" cx={cx} cy={cy} r={HUB + (r - HUB) * 0.55} />}
      <g className="t-hub" style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <circle className="t-hub-ring" cx={cx} cy={cy} r={HUB} />
        <circle className="t-hub-in" cx={cx} cy={cy} r={7} />
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <rect key={a} className="t-tooth" x={cx - 1.6} y={cy - 10.5} width={3.2} height={3.6} transform={`rotate(${a} ${cx} ${cy})`} />
        ))}
        {/* the red notch: you can see the reel turn */}
        <rect className="t-notch" x={cx - 3} y={cy - HUB + 1.5} width={6} height={3.5} />
      </g>
    </g>
  );
}

/** The cassette drawing with its label. `progress` 0..1 is how much tape has wound onto the right reel. */
export function Cassette({ title, kind, length, progress, spinning, rec, big, glyph }: {
  title: string; kind: MonologueKind | null; length: string; progress: number; spinning: boolean;
  /** recording: a red dot on the label */
  rec?: boolean;
  big?: boolean;
  /** a playable tape that is paused shows a play mark in its window */
  glyph?: boolean;
}) {
  const rL = pack(1 - progress);
  const rR = pack(progress);
  const L = { x: 112, y: 110 };
  const R = { x: 208, y: 110 };
  return (
    <span className={`tape${spinning ? ' spinning' : ''}${big ? ' big' : ''}`}>
      <svg viewBox="0 0 320 200" aria-hidden="true" className="tape-svg">
        <rect className="t-body" x={3} y={3} width={314} height={194} rx={12} />
        <rect className="t-rim" x={12} y={12} width={296} height={176} rx={7} />
        <Screw x={24} y={24} /><Screw x={296} y={24} /><Screw x={24} y={176} /><Screw x={296} y={176} />
        <rect className="t-label" x={34} y={20} width={252} height={46} rx={3} />
        <Reel cx={L.x} cy={L.y} r={rL} />
        <Reel cx={R.x} cy={R.y} r={rR} />
        <rect className="t-window" x={74} y={76} width={172} height={68} rx={7} />
        <circle className="t-guide" cx={56} cy={164} r={6} /><circle className="t-guide-in" cx={56} cy={164} r={2} />
        <circle className="t-guide" cx={264} cy={164} r={6} /><circle className="t-guide-in" cx={264} cy={164} r={2} />
        <path className="t-head" d="M90 197 L103 154 L217 154 L230 197" />
        <circle className="t-hole" cx={128} cy={176} r={6} />
        <circle className="t-hole" cx={192} cy={176} r={6} />
        <rect className="t-slot" x={146} y={168} width={8} height={8} />
        <rect className="t-slot" x={166} y={168} width={8} height={8} />
        <path className="t-tape" d={`M${L.x - rL * 0.7} ${L.y + rL * 0.7} L50 168 L270 168 L${R.x + rR * 0.7} ${R.y + rR * 0.7}`} />
        {glyph && (
          <g className="t-glyph">
            <circle cx={160} cy={110} r={17} />
            <path d="M154 100 L169 110 L154 120 Z" />
          </g>
        )}
      </svg>
      <span className="tape-label">
        <span className="tape-side">{kind ? MONOLOGUE_KIND_LABEL[kind] : 'Side A'}</span>
        <span className={`tape-title${title ? '' : ' empty'}`} dir="auto">{title || 'Untitled'}</span>
        <span className="tape-len">{rec && <span className="tape-rec" aria-hidden="true" />}{length}</span>
      </span>
    </span>
  );
}

/** The waveform strip: played bars in ink, the rest grey. A slider for the keyboard (arrows: 5 s). */
export function Wave({ peaks, progress, durationMs, onSeek, label }: {
  peaks: number[]; progress: number; durationMs: number; onSeek?: (share: number) => void; label: string;
}) {
  const played = Math.round(progress * peaks.length);
  const seek = (e: MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const box = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const step = 5000 / Math.max(1, durationMs);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onSeek(Math.min(1, progress + step)); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onSeek(Math.max(0, progress - step)); }
    if (e.key === 'Home') { e.preventDefault(); onSeek(0); }
  };
  return (
    <div
      className="tape-wave" onClick={seek} onKeyDown={key}
      role={onSeek ? 'slider' : 'img'} tabIndex={onSeek ? 0 : undefined} aria-label={label}
      aria-valuemin={onSeek ? 0 : undefined} aria-valuemax={onSeek ? Math.round(durationMs / 1000) : undefined}
      aria-valuenow={onSeek ? Math.round((progress * durationMs) / 1000) : undefined}
      aria-valuetext={onSeek ? `${clock(progress * durationMs)} of ${clock(durationMs)}` : undefined}
    >
      {peaks.map((v, i) => (
        <span key={i} className={i < played ? 'on' : undefined} style={{ height: `${Math.max(8, v)}%` }} />
      ))}
    </div>
  );
}

/**
 * A playable cassette. `id` keeps one tape playing at a time across the page; `who` names the
 * speaker for the phone's lock screen. Listening never needs a sign of life from the visitor:
 * a visitor (RFC §10.8) can play it too.
 */
export function TapePlayer({ id, src, title, kind, durationMs, peaks, who }: {
  id: string; src: string; title: string; kind: MonologueKind; durationMs: number; peaks: number[]; who?: string;
}) {
  const uid = useId();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [fast, setFast] = useState(false);
  const [failed, setFailed] = useState(false);
  const total = Math.max(1, durationMs);
  const progress = Math.min(1, at / total);

  useEffect(() => onOtherPlay(id, () => audio.current?.pause()), [id]);
  // leaving the page (or the lock screen of RFC §10.10 taking over) stops the sound
  useEffect(() => () => { audio.current?.pause(); releasePlayback(id); }, [id]);

  async function toggle() {
    const a = audio.current;
    if (!a) return;
    if (!a.paused) { a.pause(); return; }
    setFailed(false);
    a.playbackRate = fast ? 1.5 : 1;
    claimPlayback(id);
    try {
      await a.play();
      if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
        navigator.mediaSession.metadata = new MediaMetadata({ title, artist: who ?? 'anti', album: MONOLOGUE_KIND_LABEL[kind] });
      }
    } catch {
      releasePlayback(id);
      setFailed(true);
    }
  }

  function seek(share: number) {
    const a = audio.current;
    if (!a) return;
    const ms = share * total;
    try { a.currentTime = ms / 1000; } catch { /* not loaded yet: it starts from here when it does */ }
    setAt(ms);
  }

  function speed() {
    const next = !fast;
    setFast(next);
    if (audio.current) audio.current.playbackRate = next ? 1.5 : 1;
  }

  return (
    <div className="tape-player">
      {/* RFC §10.22: the cassette is the player: tap it to play or pause */}
      <button type="button" className="tape-hit" onClick={() => void toggle()} aria-label={`${playing ? 'Pause' : 'Play'} ${title}`} aria-describedby={`${uid}-t`}>
        <Cassette title={title} kind={kind} length={clock(durationMs)} progress={progress} spinning={playing} glyph={!playing} />
      </button>
      <div className="tape-controls">
        <div className="tape-track">
          <Wave peaks={peaks} progress={progress} durationMs={total} onSeek={seek} label={`Position in ${title}`} />
          <span className="tape-time meta" id={`${uid}-t`}>{clock(at)} / {clock(durationMs)}</span>
        </div>
        <button type="button" className="tape-speed" onClick={speed} aria-pressed={fast} aria-label={fast ? 'Speed 1.5 times, press for normal' : 'Normal speed, press for 1.5 times'}>
          {fast ? '1.5×' : '1×'}
        </button>
      </div>
      {failed && <p className="error small" role="alert">This recording would not play here. Try again, or on another browser.</p>}
      <audio
        ref={audio} src={src} preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => { setPlaying(false); releasePlayback(id); }}
        onEnded={() => { setPlaying(false); releasePlayback(id); setAt(total); }}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime * 1000)}
        onError={() => { if (audio.current?.currentSrc) { setFailed(true); setPlaying(false); releasePlayback(id); } }}
      />
    </div>
  );
}

/** A tape's edge, as it sits on a shelf: kind, title, length. */
function Spine({ post }: { post: Post }) {
  const m = post.monologue!;
  return (
    <Link href={`/p/${post.id}`} className="spine">
      <span className="spine-side">{MONOLOGUE_KIND_LABEL[m.kind]}</span>
      <span className="spine-title" dir="auto">{m.title}</span>
      <span className="spine-len">{clock(m.durationMs)}</span>
    </Link>
  );
}

const SHELF_FIRST = 5;

/** RFC §10.22: a profile's shelf of tapes, newest on top. Nothing at all until they have posted one. */
export function MonologueShelf({ handle }: { handle: string }) {
  const [items, setItems] = useState<Post[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let alive = true;
    setItems(null); setAll(false);
    api.memberMonologues(handle).then((r) => { if (alive) setItems(r.items.filter((p) => p.monologue)); }, () => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [handle]);
  if (!items || items.length === 0) return null;
  const shown = all ? items : items.slice(0, SHELF_FIRST);
  return (
    <section className="shelf" aria-label="Monologues">
      <h2 className="section-h">Monologues</h2>
      <ul className="shelf-list">
        {shown.map((p) => <li key={p.id}><Spine post={p} /></li>)}
      </ul>
      {items.length > SHELF_FIRST && (
        <button type="button" className="link-btn" onClick={() => setAll((a) => !a)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}
