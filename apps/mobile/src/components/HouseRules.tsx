import { View } from 'react-native';
import { RULES } from '@anti/shared';
import { Dot, Text } from './ui';

/** The three rules that decide whether you keep your seat (apps/web/src/components/Welcome.tsx). */
export function HouseRules() {
  const rules: [string, string][] = [
    ['Show up.', `Sign in at least once every ${RULES.inactivity_days} days, or your seat goes to the next person in line.`],
    ['Say something.', 'Post or reply now and then. Members who only read get a warning, then lose their seat.'],
    ['Talk in public, meet in person.', 'There are no messages. Reply where everyone can see, or host an event.'],
  ];
  return (
    <View style={{ gap: 10 }}>
      {rules.map(([b, s]) => (
        <View key={b} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <View style={{ paddingTop: 7 }}><Dot size={11} /></View>
          <Text style={{ flex: 1 }}><Text v="bold">{b}</Text> {s}</Text>
        </View>
      ))}
    </View>
  );
}
