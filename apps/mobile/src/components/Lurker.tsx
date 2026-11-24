/** The "seat at risk" window on the feed (apps/web/src/components/Lifecycle.tsx LurkerBanner). */
import { View } from 'react-native';
import { RULES } from '@anti/shared';
import { fmtDate } from '@/lib/format';
import { useMe } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { AlertIcon } from './Icons';
import { Text, Win } from './ui';

export function Lurker() {
  const me = useMe();
  const { c } = useTheme();
  if (me.state !== 'flagged_lurker') return null;
  const l = me.lurker;
  const required = l?.required ?? RULES.lurker_min_contributions;
  const done = Math.min(l?.contributions ?? 0, required);
  const met = done >= required;
  return (
    <Win title="seat_at_risk" accent>
      <View style={{ flexDirection: 'row', gap: 12 }} accessibilityLiveRegion="polite">
        <AlertIcon />
        <Text style={{ flex: 1 }}>
          {met
            ? <><Text v="bold">That will do.</Text> You have posted enough. Your seat is cleared at the next hourly check.</>
            : <><Text v="bold">You have been reading without posting.</Text> Post or reply {required} times{l ? ` before ${fmtDate(l.graceEndsAt)}` : ''} to keep your seat. Likes, replies to yourself and portfolio edits do not count.</>}
        </Text>
      </View>
      <View accessibilityLabel={`${done} of ${required} posts or replies`} style={{ gap: 4 }}>
        <Text v="ui">Will to post</Text>
        <View style={{ height: 16, borderWidth: 2, borderColor: c.ink, padding: 2 }}>
          <View style={{ height: '100%', width: `${(done / required) * 100}%`, backgroundColor: c.ink }} />
        </View>
      </View>
    </Win>
  );
}
