/**
 * Recording a monologue (RFC §10.22, apps/web/app/monologue/new/page.tsx): title and kind, one big
 * Record button, five minutes at most; then the take plays back on the cassette, a note may go
 * under it, and a tick says it is yours to share. The sound can't be edited after: record again.
 * The waveform comes from the microphone's level while recording (96 bars, 0..100).
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState,
} from 'expo-audio';
import { MONOLOGUE, MONOLOGUE_KINDS, MONOLOGUE_KIND_LABEL, type MonologueKind } from '@anti/shared';
import { api, errorMessage, POST_MAX } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { Screen } from '@/components/Screen';
import { TapeCard } from '@/components/Tape';
import { Btn, Chip, ErrorNote, Field, Row, Text, Win } from '@/components/ui';

const MAX_MS = MONOLOGUE.maxSeconds * 1000;
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** the level samples squeezed into MONOLOGUE.peaks bars, 0..100 (dB -60..0 mapped to 0..100) */
function toPeaks(levels: number[]): number[] {
  const n = MONOLOGUE.peaks;
  if (levels.length === 0) return Array(n).fill(30);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i / n) * levels.length);
    const to = Math.max(from + 1, Math.floor(((i + 1) / n) * levels.length));
    let peak = -160;
    for (let j = from; j < to && j < levels.length; j++) peak = Math.max(peak, levels[j]!);
    out.push(Math.round(Math.max(0, Math.min(100, ((peak + 60) / 60) * 100))));
  }
  return out;
}

type Take = { uri: string; durationMs: number; peaks: number[] };

export default function RecordScreen() {
  const { c } = useTheme();
  const qc = useQueryClient();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const rs = useAudioRecorderState(recorder, 100);
  const levels = useRef<number[]>([]);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<MonologueKind | null>(null);
  const [note, setNote] = useState('');
  const [mine, setMine] = useState(false);
  const [take, setTake] = useState<Take | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // the level, sampled while recording
  useEffect(() => {
    if (rs.isRecording && typeof rs.metering === 'number') levels.current.push(rs.metering);
  }, [rs.isRecording, rs.metering, rs.durationMillis]);
  // five minutes is the end of the tape
  useEffect(() => {
    if (rs.isRecording && rs.durationMillis >= MAX_MS) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rs.isRecording, rs.durationMillis]);

  async function start() {
    setErr(null);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) { setErr('anti needs the microphone to record. Allow it in your phone’s settings, then try again.'); return; }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      levels.current = [];
      setTake(null);
      await recorder.prepareToRecordAsync();
      recorder.record();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) { setErr(errorMessage(e)); }
  }

  async function stop() {
    const durationMs = Math.min(MAX_MS, rs.durationMillis);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch (e) { setErr(errorMessage(e)); return; }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const uri = recorder.uri;
    if (!uri) { setErr('The recording did not save. Try again.'); return; }
    if (durationMs < MONOLOGUE.minSeconds * 1000) { setErr('That recording is too short.'); return; }
    setTake({ uri, durationMs, peaks: toPeaks(levels.current) });
  }

  const ready = !!take && !rs.isRecording && !!title.trim() && !!kind && mine && note.length <= POST_MAX && !busy;
  const missing = !take ? 'Record something first.' : !title.trim() ? 'Give it a title.' : !kind ? 'Choose a kind.' : !mine ? 'Tick the box to say it is yours to share.' : null;

  async function post() {
    if (!ready || !take || !kind) return;
    setBusy(true); setErr(null);
    try {
      const a = await api.uploadAudio({ uri: take.uri, name: 'monologue.m4a', type: 'audio/mp4' }, take.durationMs, take.peaks);
      await api.createPost({ body: note.trim(), monologue: { audioId: a.id, title: title.trim(), kind, mine: true } });
      await Promise.all([qc.invalidateQueries({ queryKey: ['feed'] }), qc.invalidateQueries({ queryKey: ['monologues'] })]);
      router.back();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const recording = rs.isRecording;
  return (
    <Screen>
      <Win title="new_monologue.tape">
        <Field label="Title" value={title} maxLength={MONOLOGUE.titleMax} onChangeText={setTitle} placeholder="What is it called?" />
        <View style={{ gap: 6 }}>
          <Text v="ui">Kind</Text>
          <Row gap={8}>{MONOLOGUE_KINDS.map((k) => <Chip key={k} label={MONOLOGUE_KIND_LABEL[k]} on={kind === k} onPress={() => setKind(k)} />)}</Row>
        </View>

        {take && !recording ? (
          <View style={{ gap: 10 }}>
            <TapeCard id="draft" mono={{ title: title.trim() || 'Untitled', kind: kind ?? 'thought', durationMs: take.durationMs, peaks: take.peaks, url: take.uri, source: 'recorded' }} />
            <Btn label="Record again" onPress={() => void start()} />
          </View>
        ) : (
          <View style={{ alignItems: 'center', gap: 12, paddingVertical: 12 }}>
            <Pressable
              onPress={() => void (recording ? stop() : start())}
              accessibilityRole="button" accessibilityLabel={recording ? 'Stop recording' : 'Record'}
              style={({ pressed }) => ({
                width: 120, height: 120, borderRadius: 60, borderWidth: 3, borderColor: c.ink,
                alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.panel : c.paper,
              })}
            >
              {recording
                ? <View style={{ width: 40, height: 40, backgroundColor: c.ink }} />
                : <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.signal }} />}
            </Pressable>
            <Text v="ui" style={{ fontSize: 22, lineHeight: 26 }} accessibilityLiveRegion="polite">
              {recording ? `${clock(rs.durationMillis)} / ${clock(MAX_MS)}` : 'Tap to record'}
            </Text>
            {recording && <Text v="meta">Tap again to stop. It stops by itself at five minutes.</Text>}
          </View>
        )}

        <Field label="A note (optional)" value={note} onChangeText={setNote} multiline inputStyle={{ minHeight: 80 }} />
        <Pressable onPress={() => setMine((m) => !m)} accessibilityRole="checkbox" accessibilityState={{ checked: mine }}
          style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <View style={{ width: 22, height: 22, borderWidth: 2, borderColor: c.ink, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
            {mine && <View style={{ width: 12, height: 12, backgroundColor: c.ink }} />}
          </View>
          <Text style={{ flex: 1 }}>This is mine to share: my own words, or my own song.</Text>
        </Pressable>
        <ErrorNote message={err} />
        <Row>
          <Text v="meta" style={{ flex: 1 }}>{missing ?? ''}</Text>
          <Btn kind="primary" label={busy ? 'Posting...' : 'Post'} disabled={!ready} onPress={() => void post()} />
        </Row>
      </Win>
    </Screen>
  );
}
