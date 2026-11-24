/**
 * RFC §10.22: a monologue is a cassette, and the cassette is the whole player. The label holds the
 * kind, the title, the time left in the corner and the waveform under the title (tap it to jump);
 * the play sign sits in the bottom part; tapping anywhere on the cassette plays or pauses; a
 * sticker steps the speed 1× → 1.5× → 2×. One tape plays at a time: a single player for the whole
 * app (TapeProvider), as apps/web/src/lib/tape.ts does on the site. Drawn after Tape.tsx's Cassette.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { MONOLOGUE_KIND_LABEL } from '@anti/shared';
import { mediaSource, type Monologue } from '@/lib/api';
import { FONT, useTheme } from '@/lib/theme';
import { Text } from './ui';

const SPEEDS = [1, 1.5, 2] as const;
type Speed = (typeof SPEEDS)[number];

interface TapeCtl {
  /** which post's tape is loaded, and how it's going */
  id: string | null; playing: boolean; position: number; speed: Speed;
  toggle: (id: string, url: string) => void;
  seek: (id: string, url: string, seconds: number) => void;
  nextSpeed: () => void;
}
const Ctx = createContext<TapeCtl | null>(null);

export function TapeProvider({ children }: { children: ReactNode }) {
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [id, setId] = useState<string | null>(null);
  const [speed, setSpeed] = useState<Speed>(1);

  useEffect(() => { void setAudioModeAsync({ playsInSilentMode: true }); }, []);
  useEffect(() => {
    if (status.didJustFinish) { player.pause(); void player.seekTo(0); }
  }, [status.didJustFinish, player]);

  const load = useCallback((nid: string, url: string) => {
    if (nid === id) return false;
    player.replace(mediaSource(url));
    player.setPlaybackRate(speed);
    setId(nid);
    return true;
  }, [id, player, speed]);

  const toggle = useCallback((nid: string, url: string) => {
    load(nid, url);
    if (nid === id && status.playing) player.pause(); else player.play();
  }, [id, load, player, status.playing]);

  const seek = useCallback((nid: string, url: string, seconds: number) => {
    const fresh = load(nid, url);
    void player.seekTo(seconds);
    if (fresh) player.play();
  }, [load, player]);

  const nextSpeed = useCallback(() => {
    setSpeed((s) => {
      const n = SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]!;
      player.setPlaybackRate(n);
      return n;
    });
  }, [player]);

  const value = useMemo<TapeCtl>(() => ({
    id, playing: status.playing, position: status.currentTime, speed, toggle, seek, nextSpeed,
  }), [id, status.playing, status.currentTime, speed, toggle, seek, nextSpeed]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const HUB = 14;
const PACK = 36;
const pack = (share: number) => Math.sqrt(HUB * HUB + (PACK * PACK - HUB * HUB) * Math.max(0, Math.min(1, share)));
const H = 222;

function Reel({ cx, cy, r, angle, ink, paper, signal }: { cx: number; cy: number; r: number; angle: number; ink: string; paper: string; signal: string }) {
  return (
    <G>
      <Circle cx={cx} cy={cy} r={r} fill={ink} />
      {r > HUB + 6 && <Circle cx={cx} cy={cy} r={HUB + (r - HUB) * 0.55} fill="none" stroke={paper} strokeOpacity={0.35} strokeWidth={1} />}
      <G rotation={angle} origin={`${cx}, ${cy}`}>
        <Circle cx={cx} cy={cy} r={HUB} fill={paper} stroke={ink} strokeWidth={2.5} />
        {[0, 120, 240].map((a) => (
          <Rect key={a} x={cx - 1.8} y={cy - HUB + 1} width={3.6} height={HUB - 5} fill={ink} rotation={a} origin={`${cx}, ${cy}`} />
        ))}
        <Circle cx={cx} cy={cy} r={4.5} fill={ink} />
        <Rect x={cx + HUB - 5} y={cy - 2.5} width={4} height={5} fill={signal} />
      </G>
    </G>
  );
}

/** The cassette, playing `post`'s recording. */
export function TapeCard({ id, mono, who }: { id: string; mono: Monologue; who?: string }) {
  const ctl = useContext(Ctx);
  const { c } = useTheme();
  const [waveW, setWaveW] = useState(0);
  const mine = ctl?.id === id;
  const playing = !!ctl && mine && ctl.playing;
  const posMs = mine && ctl ? ctl.position * 1000 : 0;
  const progress = mono.durationMs > 0 ? Math.min(1, posMs / mono.durationMs) : 0;
  const left = mono.durationMs - posMs;
  // the hubs turn while it plays: one turn every 2 s of tape
  const angle = playing || posMs > 0 ? (posMs / 2000) * 360 : 0;
  const rL = pack(1 - progress);
  const rR = pack(progress);
  const played = Math.round(progress * mono.peaks.length);

  const toggle = () => { if (!ctl) return; void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); ctl.toggle(id, mono.url); };
  const onWave = (e: GestureResponderEvent) => {
    if (!ctl || waveW <= 0) return;
    const share = Math.max(0, Math.min(1, e.nativeEvent.locationX / waveW));
    ctl.seek(id, mono.url, (share * mono.durationMs) / 1000);
  };

  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={`${playing ? 'Pause' : 'Play'} ${mono.title}, a ${MONOLOGUE_KIND_LABEL[mono.kind]}${who ? ` by ${who}` : ''}, ${clock(mono.durationMs)}`}
      style={{ width: '100%', aspectRatio: 320 / H }}
    >
      <Svg viewBox={`0 0 320 ${H}`} width="100%" height="100%">
        <Rect x={3} y={3} width={314} height={H - 6} rx={12} fill={c.paper} stroke={c.ink} strokeWidth={3} />
        <Rect x={12} y={12} width={296} height={H - 24} rx={7} fill="none" stroke={c.ink} strokeWidth={1.5} />
        {[[24, 24], [296, 24], [24, H - 24], [296, H - 24]].map(([x, y]) => (
          <G key={`${x}-${y}`}>
            <Circle cx={x} cy={y} r={5} fill={c.paper} stroke={c.ink} strokeWidth={1.5} />
            <Path d={`M${x! - 3} ${y}h6M${x} ${y! - 3}v6`} stroke={c.ink} strokeWidth={1.5} />
          </G>
        ))}
        <Rect x={34} y={18} width={252} height={66} rx={3} fill={c.paper} stroke={c.ink} strokeWidth={2} />
        <Rect x={74} y={96} width={172} height={64} rx={7} fill={c.panel} stroke={c.ink} strokeWidth={2} />
        <Reel cx={112} cy={128} r={rL} angle={angle} ink={c.ink} paper={c.paper} signal={c.signal} />
        <Reel cx={208} cy={128} r={rR} angle={angle} ink={c.ink} paper={c.paper} signal={c.signal} />
        <Path d={`M90 ${H - 3} L103 172 L217 172 L230 ${H - 3}`} fill="none" stroke={c.ink} strokeWidth={2} />
        <Circle cx={124} cy={198} r={6} fill={c.ink} />
        <Circle cx={196} cy={198} r={6} fill={c.ink} />
        {playing
          ? <><Rect x={150} y={188} width={7} height={20} fill={c.signal} /><Rect x={163} y={188} width={7} height={20} fill={c.signal} /></>
          : <Path d="M152 188 L172 198 L152 208 Z" fill={c.ink} />}
        <Path d={`M${112 - rL * 0.7} ${128 + rL * 0.7} L50 186 L270 186 L${208 + rR * 0.7} ${128 + rR * 0.7}`} fill="none" stroke={c.ink} strokeWidth={1.5} />
      </Svg>

      {/* the label: kind box, title, time left, waveform (positions follow the drawing: 34..286 × 18..84 of 320 × 222) */}
      <View style={{ position: 'absolute', left: `${(38 / 320) * 100}%`, right: `${(38 / 320) * 100}%`, top: `${(21 / H) * 100}%`, height: `${(60 / H) * 100}%`, justifyContent: 'space-between' }} pointerEvents="box-none">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} pointerEvents="none">
          <View style={{ backgroundColor: c.ink, paddingHorizontal: 4 }}>
            <Text v="ui" style={{ color: c.paper, fontSize: 11, lineHeight: 15 }}>{MONOLOGUE_KIND_LABEL[mono.kind]}</Text>
          </View>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT.textBold, fontSize: 14, lineHeight: 18 }}>{mono.title || 'Untitled'}</Text>
          <Text v="ui" style={{ fontSize: 12, lineHeight: 15 }}>{clock(left)}</Text>
        </View>
        <Pressable
          onPress={onWave} onLayout={(e: LayoutChangeEvent) => setWaveW(e.nativeEvent.layout.width)}
          accessibilityRole="adjustable" accessibilityLabel="Jump in the recording"
          style={{ height: '45%', flexDirection: 'row', alignItems: 'center', gap: 1 }}
        >
          {mono.peaks.map((v, i) => (
            <View key={i} pointerEvents="none" style={{ flex: 1, height: `${Math.max(10, v)}%`, backgroundColor: i < played ? c.ink : c.gray, opacity: i < played ? 1 : 0.5 }} />
          ))}
        </Pressable>
      </View>

      {/* the speed sticker */}
      <Pressable
        onPress={() => ctl?.nextSpeed()} hitSlop={8}
        accessibilityRole="button" accessibilityLabel={`Speed ${ctl?.speed ?? 1}×`}
        style={{ position: 'absolute', right: '3%', bottom: '6%', backgroundColor: c.signal, paddingHorizontal: 5, paddingVertical: 1, transform: [{ rotate: '-6deg' }] }}
      >
        <Text v="ui" style={{ color: c.signalInk, fontSize: 12, lineHeight: 15 }}>{ctl?.speed ?? 1}×</Text>
      </Pressable>
    </Pressable>
  );
}
