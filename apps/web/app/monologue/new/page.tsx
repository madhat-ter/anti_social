'use client';
/**
 * RFC §10.22: recording a monologue. Title and kind first, then one big Record button; the tape
 * winds as you speak and stops by itself at five minutes. Listen back, re-record as often as you
 * like, or upload a file instead (a song made elsewhere). Once posted, the sound can't be changed.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { MONOLOGUE, MONOLOGUE_KINDS, MONOLOGUE_KIND_LABEL, type MonologueKind } from '@anti/shared';
import { api, errorMessage, POST_MAX } from '@/lib/api';
import { useTitle } from '@/lib/hooks';
import { clock, measure, recorderType } from '@/lib/tape';
import { SeatedShell } from '@/components/Shell';
import { Cassette, TapePlayer } from '@/components/Tape';
import { useMentions } from '@/components/Mentions';
import { ErrorNote } from '@/components/ui';

export default function NewMonologuePage() {
  useTitle('Record a monologue');
  return <SeatedShell>{() => <Recorder />}</SeatedShell>;
}

type Take = { blob: Blob; url: string; durationMs: number; peaks: number[]; source: 'recorded' | 'uploaded' };
const MAX_MS = MONOLOGUE.maxSeconds * 1000;
const EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/x-m4a': 'm4a' };
const nameFor = (b: Blob) => `monologue.${EXT[b.type.split(';')[0]!] ?? 'webm'}`;

function micMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The microphone is blocked for this site. Allow it in your browser (the icon by the address), then press Record again.';
  }
  if (name === 'NotFoundError') return 'No microphone was found. Plug one in, or upload a file instead.';
  return 'The microphone could not start. Try again, or upload a file instead.';
}

function Recorder() {
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<MonologueKind | null>(null);
  const [note, setNote] = useState('');
  const [mine, setMine] = useState(false);
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'measuring' | 'review'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const takeRef = useRef<Take | null>(null);
  takeRef.current = take;
  const men = useMentions(note, setNote, `${id}-mentions`);

  function stopTracks() {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }
  // leaving the page stops the microphone and lets go of the recording
  useEffect(() => () => {
    if (rec.current && rec.current.state !== 'inactive') { rec.current.onstop = null; rec.current.stop(); }
    stopTracks();
    if (takeRef.current) URL.revokeObjectURL(takeRef.current.url);
  }, []);

  function keepTake(t: Take | null) {
    setTake((old) => { if (old && old.url !== t?.url) URL.revokeObjectURL(old.url); return t; });
  }

  async function start() {
    setErr(null);
    const type = recorderType();
    if (type === undefined || !navigator.mediaDevices?.getUserMedia) {
      setErr('This browser cannot record here. Upload a file instead.');
      return;
    }
    keepTake(null);
    setState('starting');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      setState('idle');
      setErr(micMessage(e));
      return;
    }
    const r = new MediaRecorder(stream.current, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 64_000 });
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = () => {
      const spent = Math.min(MAX_MS, performance.now() - startedAt.current);
      stopTracks();
      void finish(new Blob(chunks, { type: r.mimeType || type || 'audio/webm' }), spent);
    };
    rec.current = r;
    r.start(250);
    startedAt.current = performance.now();
    setElapsed(0);
    setState('recording');
    timer.current = setInterval(() => {
      const ms = performance.now() - startedAt.current;
      setElapsed(Math.min(MAX_MS, ms));
      // the tape runs out at five minutes, like a real one
      if (ms >= MAX_MS && r.state === 'recording') r.stop();
    }, 200);
  }

  function stop() {
    if (rec.current && rec.current.state === 'recording') { setState('measuring'); rec.current.stop(); }
  }

  async function finish(blob: Blob, spentMs: number) {
    if (blob.size === 0) { setState('idle'); setErr('Nothing was recorded. Try again.'); return; }
    let m: { durationMs: number; peaks: number[] };
    try { m = await measure(blob); } catch { m = { durationMs: Math.round(spentMs), peaks: Array(MONOLOGUE.peaks).fill(30) }; }
    // a recorder's own count is the truth when decoding comes up short
    const durationMs = Math.min(MAX_MS, Math.max(m.durationMs, Math.round(spentMs) - 400));
    if (durationMs < MONOLOGUE.minSeconds * 1000) { setState('idle'); setErr('That was too short. Press Record and say something.'); return; }
    keepTake({ blob, url: URL.createObjectURL(blob), durationMs, peaks: m.peaks, source: 'recorded' });
    setState('review');
  }

  async function pickFile(f: File | undefined) {
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    setErr(null);
    if (f.size > MONOLOGUE.maxBytes) { setErr(`That file is larger than ${MONOLOGUE.maxBytes / 1024 / 1024} MB.`); return; }
    setState('measuring');
    try {
      const m = await measure(f);
      if (m.durationMs > MAX_MS + 500) {
        setState(take ? 'review' : 'idle');
        setErr(`That file is ${clock(m.durationMs)}. A monologue is at most ${clock(MAX_MS)}.`);
        return;
      }
      keepTake({ blob: f, url: URL.createObjectURL(f), durationMs: Math.min(MAX_MS, m.durationMs), peaks: m.peaks, source: 'uploaded' });
      setState('review');
    } catch {
      setState(take ? 'review' : 'idle');
      setErr('That file could not be read as audio. Use an MP3, M4A, OGG or WebM file.');
    }
  }

  const ready = !!take && state === 'review' && !!title.trim() && !!kind && mine && note.length <= POST_MAX && !busy;
  const missing = !take ? 'Record something first.' : !title.trim() ? 'Give it a title.' : !kind ? 'Choose a kind.' : !mine ? 'Tick the box to say it is yours to share.' : null;

  async function post() {
    if (!ready || !take || !kind) return;
    setBusy(true); setErr(null);
    try {
      const a = await api.uploadAudio(take.blob, take.source === 'uploaded' && take.blob instanceof File ? take.blob.name : nameFor(take.blob), take.durationMs, take.peaks, take.source);
      await api.createPost({ body: note.trim(), monologue: { audioId: a.id, title: title.trim(), kind, mine: true } });
      router.push('/monologue');
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  }

  const recording = state === 'recording';
  return (
    <>
      <p><Link href="/monologue">Back to Monologue</Link></p>
      <h1>Record a monologue</h1>
      <p className="muted">
        {clock(MAX_MS)} at most. Listen back before you post: once it is posted, the sound can&rsquo;t be changed, only deleted.
      </p>
      <form className="win mono-new" onSubmit={(e) => { e.preventDefault(); void post(); }}>
        <div className="win-bar" aria-hidden="true">
          <span className="win-close" />
          <span className="win-title">new_monologue.tape</span>
        </div>
        <div className="win-body stack">
          <label>Title
            <input value={title} maxLength={MONOLOGUE.titleMax} onChange={(e) => setTitle(e.target.value)} placeholder="What is it called?" />
          </label>
          <div className="stack mono-kind">
            <span className="label-like" id={`${id}-kind`}>Kind</span>
            <div className="row chips composer-label" role="radiogroup" aria-labelledby={`${id}-kind`}>
              {MONOLOGUE_KINDS.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
                  {MONOLOGUE_KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>

          <div className="mono-deck">
            {take && state === 'review' ? (
              <TapePlayer id="draft" src={take.url} title={title.trim() || 'Untitled'} kind={kind ?? 'thought'} durationMs={take.durationMs} peaks={take.peaks} />
            ) : (
              <Cassette
                big title={title.trim()} kind={kind} length={clock(elapsed)} rec={recording}
                progress={elapsed / MAX_MS} spinning={recording}
              />
            )}
            <div className="row mono-rec-bar">
              {recording ? (
                <button type="button" className="btn primary mono-rec" onClick={stop}>
                  <span className="mono-stop" aria-hidden="true" /> Stop
                </button>
              ) : take && state === 'review' ? (
                <button type="button" className="btn mono-rec" onClick={() => void start()}>
                  <span className="mono-dot" aria-hidden="true" /> Re-record
                </button>
              ) : (
                <button type="button" className="btn primary mono-rec" onClick={() => void start()} disabled={state === 'starting' || state === 'measuring'}>
                  <span className="mono-dot" aria-hidden="true" /> {state === 'measuring' ? 'One moment…' : 'Record'}
                </button>
              )}
              <span className="meta" role="timer" aria-live="off">
                {recording ? `${clock(elapsed)} / ${clock(MAX_MS)}` : take ? `${clock(take.durationMs)} recorded` : `up to ${clock(MAX_MS)}`}
              </span>
            </div>
            {!recording && (
              <p className="small mono-upload">
                <input ref={fileRef} id={`${id}-file`} type="file" accept="audio/*,.mp3,.m4a,.ogg,.webm" className="sr-only"
                  onChange={(e) => void pickFile(e.target.files?.[0])} />
                or <label htmlFor={`${id}-file`} className="link-btn inline-label">upload a file</label>{' '}
                <span className="muted">(MP3, M4A, OGG or WebM, up to {MONOLOGUE.maxBytes / 1024 / 1024} MB)</span>
              </p>
            )}
          </div>

          <label htmlFor={`${id}-note`} className="label-row">A note <span className="muted small">(optional)</span></label>
          <div className="composer-text">
            <textarea
              id={`${id}-note`} value={note} rows={3} placeholder="Where you recorded it, what it is about..."
              onChange={(e) => { setNote(e.target.value); men.track(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
              {...men.boxProps}
              onKeyDown={(e) => { men.onKeyDown(e); }}
            />
            {men.list}
          </div>
          <label className="check">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            This is mine to share: my own words, or my own song.
          </label>
          <ErrorNote message={err} />
          <div className="row">
            <button type="submit" className="btn primary" disabled={!ready} title={missing ?? undefined}>
              {busy ? 'Posting...' : 'Post monologue'}
            </button>
            {missing && !busy && <span className="muted small">{missing}</span>}
          </div>
        </div>
      </form>
    </>
  );
}
