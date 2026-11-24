/**
 * Waiting for a seat (apps/web/src/components/Lifecycle.tsx): your place in line, or why your seat
 * was released and how to rejoin. The screen checks every minute; when a seat opens it turns into
 * the feed by itself. Paying to reinstate happens on the website.
 */
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { RULES } from '@anti/shared';
import { api, errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { openSite } from '@/lib/links';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { Wordmark } from '@/components/TopBar';
import { Screen } from '@/components/Screen';
import { Btn, ErrorNote, LinkText, Row, Text, Win } from '@/components/ui';

const ARCHIVE_REASON: Record<string, string> = {
  inactive: `You had not signed in for ${RULES.inactivity_days} days, so your seat went to the next person in line.`,
  lurker_grace_expired: `You did not post during the ${RULES.lurker_grace_days}-day grace period, so your seat went to the next person in line.`,
  waitlist_decay: `You had not signed in for ${RULES.waitlist_decay_days} days, so you were removed from the waitlist.`,
};

export default function StatusScreen() {
  const { me, refreshMe, signOut } = useSession();
  const { c } = useTheme();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => void refreshMe(), 60_000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void refreshMe(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [refreshMe]);

  if (!me) return null;
  const w = me.waitlist;
  const total = w ? Math.max(w.total, w.position) : 0;
  const pct = w ? Math.round(((total - w.position + 1) / (total + 1)) * 100) : 10;

  let card;
  if (me.state === 'waitlisted') {
    card = (
      <Win title="waiting_for_a_seat">
        {w ? <Text><Text v="poster" style={{ fontSize: 44 }}>#{w.position}</Text> <Text v="meta">of {total} in line</Text></Text>
          : <Text muted>Your place in the line is being updated.</Text>}
        <View style={{ height: 16, borderWidth: 2, borderColor: c.ink, padding: 2 }} accessibilityLabel={w ? `Number ${w.position} of ${total} in line` : 'Waiting'}>
          <View style={{ height: '100%', width: `${pct}%`, backgroundColor: c.ink }} />
        </View>
        <Text>All hundred seats are taken. When one opens you get it automatically, and this screen turns into your feed.</Text>
        <Text v="meta">Returning members are seated ahead of new invitees, so your number can go up as well as down. Sign in at least once every {RULES.waitlist_decay_days} days to keep your place.</Text>
      </Win>
    );
  } else if (w?.offeredUntil) {
    card = (
      <Win title="seat_held_for_you" accent>
        <Text v="h2">A seat is being held for you</Text>
        <Text>Pay the reinstatement fee before {fmtDate(w.offeredUntil)} to take your seat back. If you don't, it goes to the next person in line and you can rejoin the queue.</Text>
        <Row><Btn kind="primary" label="Pay on the website" onPress={() => void openSite('/')} /></Row>
      </Win>
    );
  } else {
    const wasMember = me.archived?.wasMember ?? true;
    card = (
      <Win title={wasMember ? 'seat_released' : 'left_the_line'}>
        <Text v="h2">{wasMember ? 'Your seat was released' : 'You left the waitlist'}</Text>
        <Text>{ARCHIVE_REASON[me.archived?.reason ?? ''] ?? ''} Your handle, profile and posts are kept.</Text>
        {w ? (
          <>
            <Text><Text v="poster" style={{ fontSize: 44 }}>#{w.position}</Text> <Text v="meta">of {Math.max(w.total, w.position)} in the queue</Text></Text>
            <Text v="meta">{w.priority === 'reinstating'
              ? `Returning members are ahead of new invitees. When a seat opens it is held for you for ${RULES.reinstate_offer_hours} hours while you pay the reinstatement fee.`
              : 'When a seat opens you will be seated automatically.'}</Text>
          </>
        ) : (
          <>
            <Text v="meta">{wasMember
              ? `Rejoining the queue is free and puts you ahead of new invitees. When a seat opens it is held for you for ${RULES.reinstate_offer_hours} hours, and you pay the reinstatement fee to take it.`
              : 'Rejoining is free. You will be seated automatically when a seat opens.'}</Text>
            <Row><Btn kind="primary" label="Rejoin the queue" busy={busy} onPress={async () => {
              setBusy(true); setErr(null);
              try { await api.rejoin(); await refreshMe(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
            }} /></Row>
          </>
        )}
        <ErrorNote message={err} />
      </Win>
    );
  }

  return (
    <Screen top onRefresh={() => void refreshMe()}>
      <Wordmark size={40} />
      <Text v="meta">Signed in as @{me.handle}</Text>
      {card}
      <Row><LinkText small label="Sign out" onPress={() => void signOut()} /></Row>
    </Screen>
  );
}
