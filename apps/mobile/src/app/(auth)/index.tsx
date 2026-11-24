/**
 * The welcome, for someone not signed in (the website's Landing, RFC §10.25 and §10.29). The
 * four lines are the owner's words, unchanged; the window says there is a seat here; then asking
 * for one, the hundred faces and the three rules. No help line, no jokes.
 */
import { memo, useEffect, useState } from 'react';
import { View } from 'react-native';
import Svg, { G } from 'react-native-svg';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { SEAT_REQUEST } from '@anti/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { FONT, useTheme } from '@/lib/theme';
import { cachedFace } from '@/components/Avatar';
import { HelloIcon } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Btn, ErrorNote, Field, Row, Text, Win } from '@/components/ui';

const SEATS = Array.from({ length: 100 }, (_, i) => `seat-${i + 1}`);

/**
 * The hundred faces as ONE drawing (10 × 10), not a hundred: a hundred separate pictures made the
 * welcome slow to appear. They are drawn a frame after the screen, so the words and buttons come
 * first.
 */
const CELL = 68; // a 64-unit face and a 4-unit gap
const Seats = memo(function Seats() {
  const { c } = useTheme();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <View style={{ width: '100%', aspectRatio: 1 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {ready && (
        <Svg viewBox={`0 0 ${CELL * 10 - 4} ${CELL * 10 - 4}`} width="100%" height="100%" color={c.ink}>
          {SEATS.map((s, i) => (
            // half women, half men, scattered the same way the website's seats fill
            <G key={s} transform={`translate(${(i % 10) * CELL} ${Math.floor(i / 10) * CELL})`}>
              {cachedFace(s, ((i * 37) % 100) % 2 ? 'woman' : 'man', c.paper)}
            </G>
          ))}
        </Svg>
      )}
    </View>
  );
});

function SeatAsk() {
  const open = useQuery({ queryKey: ['seat-requests-open'], queryFn: () => api.seatRequestsOpen() });
  const [form, setForm] = useState(false);
  const [sent, setSent] = useState(false);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = name.trim().length > 0 && contact.trim().length >= SEAT_REQUEST.contactMin;

  if (open.data && !open.data.open) {
    return <Text>No invite? Ask someone who is already inside: every member can invite two people at a time, and they choose.</Text>;
  }
  if (sent) {
    return (
      <Text accessibilityLiveRegion="polite">
        <Text v="bold">Sent.</Text> A person will read it. There are only a hundred seats, so it can take a while; when one is free, one of us will write to you.
      </Text>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      {form ? (
        <Win title="Ask for a seat" onClose={() => setForm(false)}>
          <Text v="small" muted>No account needed. Only the admins see what you write here. A person reads every request; there are only a hundred seats, so it can take a while.</Text>
          <Field label="Your name" value={name} onChangeText={setName} maxLength={SEAT_REQUEST.nameMax} placeholder="What should we call you?" autoComplete="given-name" />
          <Field label="How can we reach you?" value={contact} onChangeText={setContact} maxLength={SEAT_REQUEST.contactMax} placeholder="A phone number, an email or an Instagram name" autoCapitalize="none" />
          <Field label="Anything you want to say (you can leave this empty)" value={note} onChangeText={setNote} maxLength={SEAT_REQUEST.noteMax} multiline numberOfLines={3} inputStyle={{ minHeight: 90 }} />
          <ErrorNote message={err} />
          <Row style={{ justifyContent: 'flex-end' }}>
            <Btn label="Not now" onPress={() => setForm(false)} />
            <Btn
              kind="default" label={busy ? 'Sending…' : 'Send'} busy={busy} disabled={!ready}
              onPress={async () => {
                setBusy(true); setErr(null);
                try { await api.askForSeat({ name, contact, note, website: '' }); setSent(true); setForm(false); }
                catch (x) { setErr(x instanceof ApiError && x.status === 429 && x.detail ? x.detail : errorMessage(x)); }
                finally { setBusy(false); }
              }}
            />
          </Row>
        </Win>
      ) : (
        <Row wrap>
          <Text style={{ flexShrink: 1 }}>No invite, and no one inside to ask?</Text>
          <Btn label="Ask for a seat" onPress={() => setForm(true)} />
        </Row>
      )}
      <Text>Know someone inside? Every member can invite two people at a time, and they choose.</Text>
    </View>
  );
}

const RULES: [string, string][] = [
  ['In the open', 'No private messages. Everything is said where everyone can see, so no one can corner you.'],
  ['No algorithm', 'Nothing here is built to keep you scrolling. One feed, likes never move a post, and you will reach the end.'],
  ['Small on purpose', 'A hundred seats, so people know your name. Away for 30 days and your seat passes to someone waiting; you can ask for it back.'],
];

export default function Welcome() {
  const { c } = useTheme();
  return (
    <Screen top style={{ gap: 22 }}>
      {/* ANTI, solid; SOCIAL, outlined; the red stop */}
      <View accessible accessibilityRole="header" accessibilityLabel="Anti social.">
        <Text style={{ fontFamily: FONT.poster, fontSize: 92, lineHeight: 84, textTransform: 'uppercase' }}>Anti</Text>
        <Text style={{ fontFamily: FONT.poster, fontSize: 92, lineHeight: 84, textTransform: 'uppercase', color: c.paper, textShadowColor: c.ink, textShadowRadius: 1.5, textShadowOffset: { width: 0, height: 0 } }}>
          Social<Text style={{ color: c.signal, fontFamily: FONT.poster, fontSize: 92 }}>.</Text>
        </Text>
      </View>

      {/* RFC §10.25: four lines, the owner's words */}
      <View style={{ gap: 6 }}>
        <Text v="big">You may feel there&rsquo;s no one for you.</Text>
        <Text v="big">We won&rsquo;t pretend: no one is coming to fix everything.</Text>
        <Text v="big">But you&rsquo;re not the only one feeling this.</Text>
        <Text v="big">We have each other. Some days, that&rsquo;s enough to stay.</Text>
      </View>

      <Win title="Welcome">
        <Row style={{ alignItems: 'flex-start' }} gap={14}>
          <HelloIcon />
          <View style={{ flex: 1, gap: 14 }}>
            <Text>There&rsquo;s a seat here for you.</Text>
            <Row wrap style={{ justifyContent: 'flex-end' }}>
              <Btn label="Sign in" onPress={() => router.push('/login')} />
              <Btn kind="default" label="I have an invite" onPress={() => router.push('/join')} />
            </Row>
          </View>
        </Row>
      </Win>

      <SeatAsk />

      <View style={{ gap: 10 }}>
        <Seats />
        <Text v="small" muted style={{ textAlign: 'center' }}>Every face is a person. The room is small on purpose, so you get noticed.</Text>
      </View>

      <View style={{ gap: 14 }}>
        {RULES.map(([b, s]) => (
          <View key={b} style={{ borderLeftWidth: 4, borderColor: c.signal, paddingLeft: 12, gap: 2 }}>
            <Text v="bold">{b}</Text>
            <Text>{s}</Text>
          </View>
        ))}
      </View>
      {/* "What is anti?" and "Questions" were taken off on the owner's word (2026-11-24, RFC §10.29) */}
    </Screen>
  );
}
