'use client';
/**
 * RFC §10.22: a monologue is drawn as a cassette, and the cassette is the whole player (owner,
 * 2026-11-11). The label holds the kind (the SIDE box), the title, the time left in the corner
 * (it counts down while it plays) and, under the title, the waveform: tap it to jump. The play
 * sign sits in the bottom part, where a real tape's head opening is; tapping anywhere on the
 * cassette plays or pauses. While it plays the two reels turn and the tape winds from the left reel
 * to the right one. A small sticker in the corner steps the speed 1× → 1.5× → 2×.
 * One tape plays at a time. Every colour is a CSS variable, so dark mode is white on black.
 */
import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { MONOLOGUE_KIND_LABEL, type MonologueKind } from '@anti/shared';
import { api, type Post } from '@/lib/api';
import { claimPlayback, clock, onOtherPlay, releasePlayback } from '@/lib/tape';

const HUB = 14;
const PACK = 36;
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
      {/* the hub turns while it plays: three spokes and a red notch make the turning easy to see */}
      <g className="t-hub" style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <circle className="t-hub-ring" cx={cx} cy={cy} r={HUB} />
        {[0, 120, 240].map((a) => (
          <rect key={a} className="t-spoke" x={cx - 1.8} y={cy - HUB + 1} width={3.6} height={HUB - 5} transform={`rotate(${a} ${cx} ${cy})`} />
        ))}
        <circle className="t-hub-in" cx={cx} cy={cy} r={4.5} />
        <rect className="t-notch" x={cx + HUB - 5} y={cy - 2.5} width={4} height={5} />
      </g>
    </g>
  );
}

/** viewBox height: the label is tall enough for a title and the waveform under it */
const H = 222;

/**
 * The cassette drawing. `progress` 0..1 is how much tape has wound onto the right reel. `sign`
 * draws the play (or pause) sign in the bottom part; `wave` and `extra` are the player's own
 * controls, laid on top of the drawing.
 */
export function Cassette({ title, kind, length, progress, spinning, rec, big, sign, wave, extra }: {
  title: string; kind: MonologueKind | null; length: string; progress: number; spinning: boolean;
  /** recording: a red dot on the label */
  rec?: boolean;
  big?: boolean;
  sign?: 'play' | 'pause';
  wave?: ReactNode;
  extra?: ReactNode;
}) {
  const rL = pack(1 - progress);
  const rR = pack(progress);
  const L = { x: 112, y: 128 };
  const R = { x: 208, y: 128 };
  return (
    <div className={`tape${spinning ? ' spinning' : ''}${big ? ' big' : ''}${sign ? ' playable' : ''}`}>
      <svg viewBox={`0 0 320 ${H}`} aria-hidden="true" className="tape-svg">
        <rect className="t-body" x={3} y={3} width={314} height={H - 6} rx={12} />
        <rect className="t-rim" x={12} y={12} width={296} height={H - 24} rx={7} />
        <Screw x={24} y={24} /><Screw x={296} y={24} /><Screw x={24} y={H - 24} /><Screw x={296} y={H - 24} />
        <rect className="t-label" x={34} y={18} width={252} height={66} rx={3} />
        <Reel cx={L.x} cy={L.y} r={rL} />
        <Reel cx={R.x} cy={R.y} r={rR} />
        <rect className="t-window" x={74} y={96} width={172} height={64} rx={7} />
        <circle className="t-guide" cx={56} cy={184} r={6} /><circle className="t-guide-in" cx={56} cy={184} r={2} />
        <circle className="t-guide" cx={264} cy={184} r={6} /><circle className="t-guide-in" cx={264} cy={184} r={2} />
        <path className="t-head" d={`M90 ${H - 3} L103 172 L217 172 L230 ${H - 3}`} />
        <circle className="t-hole" cx={124} cy={198} r={6} />
        <circle className="t-hole" cx={196} cy={198} r={6} />
        {/* the play sign lives where a real tape's head opening is (between the two holes) */}
        {sign === 'play' && <path className="t-sign" d="M152 188 L172 198 L152 208 Z" />}
        {sign === 'pause' && <><rect className="t-sign" x={150} y={188} width={7} height={20} /><rect className="t-sign" x={163} y={188} width={7} height={20} /></>}
        {!sign && <><rect className="t-slot" x={146} y={192} width={10} height={10} /><rect className="t-slot" x={164} y={192} width={10} height={10} /></>}
        <path className="t-tape" d={`M${L.x - rL * 0.7} ${L.y + rL * 0.7} L50 186 L270 186 L${R.x + rR * 0.7} ${R.y + rR * 0.7}`} />
      </svg>
      {extra}
      <div className="tape-label">
        <span className="tape-side">{kind ? MONOLOGUE_KIND_LABEL[kind] : 'Side A'}</span>
        <span className={`tape-title${title ? '' : ' empty'}`} dir="auto">{title || 'Untitled'}</span>
        <span className="tape-len">{rec && <span className="tape-rec" aria-hidden="true" />}{length}</span>
        <span className="tape-wave-slot">{wave}</span>
      </div>
    </div>
  );
}

/** The waveform: played bars in ink, the rest grey. A slider for the keyboard (arrows: 5 s). */
export function Wave({ peaks, progress, durationMs, onSeek, label }: {
  peaks: number[]; progress: number; durationMs: number; onSeek?: (share: number) => void; label: string;
}) {
  const played = Math.round(progress * peaks.length);
  const seek = (e: MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    e.stopPropagation(); // a jump, not a play/pause
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
        <span key={i} className={i < played ? 'on' : undefined} style={{ height: `${Math.max(10, v)}%` }} />
      ))}
    </div>
  );
}

const SPEEDS = [1, 1.5, 2] as const;
const speedLabel = (s: number) => `${s}×`;

/**
 * A playable cassette. `id` keeps one tape playing at a time across the page; `who` names the
 * speaker for the phone's lock screen. A visitor (RFC §10.8) can play it too.
 */
export function TapePlayer({ id, src, title, kind, durationMs, peaks, who, big }: {
  id: string; src: string; title: string; kind: MonologueKind; durationMs: number; peaks: number[]; who?: string; big?: boolean;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [failed, setFailed] = useState(false);
  const total = Math.max(1, durationMs);
  const progress = Math.min(1, at / total);
  const left = Math.max(0, total - at);

  useEffect(() => onOtherPlay(id, () => audio.current?.pause()), [id]);
  // leaving the page (or the lock screen of RFC §10.10 taking over) stops the sound
  useEffect(() => () => { audio.current?.pause(); releasePlayback(id); }, [id]);

  async function toggle() {
    const a = audio.current;
    if (!a) return;
    if (!a.paused) { a.pause(); return; }
    setFailed(false);
    a.playbackRate = speed;
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

  function nextSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  }

  return (
    <div className="tape-player">
      <Cassette
        big={big} title={title} kind={kind} length={clock(left)} progress={progress} spinning={playing}
        sign={playing ? 'pause' : 'play'}
        wave={<Wave peaks={peaks} progress={progress} durationMs={total} onSeek={seek} label={`Position in ${title}`} />}
        extra={<>
          {/* RFC §10.22: the cassette is the player: tap anywhere on it to play or pause */}
          <button type="button" className="tape-hit" onClick={() => void toggle()}
            aria-label={`${playing ? 'Pause' : 'Play'} ${title}, ${clock(left)} left`} />
          <button type="button" className="tape-speed" onClick={nextSpeed}
            aria-label={`Speed ${speedLabel(speed)}, press for ${speedLabel(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!)}`}>
            {speedLabel(speed)}
          </button>
        </>}
      />
      {failed && <p className="error small" role="alert">This recording would not play here. Try again, or on another browser.</p>}
      <audio
        ref={audio} src={src} preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => { setPlaying(false); releasePlayback(id); }}
        onEnded={() => { setPlaying(false); releasePlayback(id); setAt(0); }}
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
