/**
 * Marks by a name (RFC §10.7), as apps/web/src/components/Marks.tsx draws them: the OG mark for
 * admins and the verified seal; plus the small tags that sit after a name.
 */
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { isBirthdayOn, localToday } from '@anti/shared';
import type { Birthday } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { Tag } from './ui';

export function NameMarks({ admin, verified, size = 15 }: { admin?: boolean; verified?: boolean; size?: number }) {
  const { c } = useTheme();
  if (!admin && !verified) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      {admin && (
        <Svg viewBox="0 0 64 40" width={size * 1.6} height={size} accessibilityLabel="admin" accessible>
          <Circle cx="22" cy="20" r="14.5" fill="none" stroke={c.ink} strokeWidth="6" />
          <Path d="M54.6 13.2 A14.5 14.5 0 1 0 56.5 20 H43.5" fill="none" stroke={c.ink} strokeWidth="6" />
          <Path d="M30.2 8.2 A14.5 14.5 0 0 1 35.9 15.6" fill="none" stroke={c.paper} strokeWidth="10" />
          <Path d="M30.2 8.2 A14.5 14.5 0 0 1 35.9 15.6" fill="none" stroke={c.ink} strokeWidth="6" />
        </Svg>
      )}
      {verified && (
        <Svg viewBox="0 0 24 24" width={size} height={size} accessibilityLabel="verified" accessible>
          <Path fill={c.ink} d="M12 1.5l2.2 1.9 2.9-.4 1.1 2.7 2.7 1.1-.4 2.9 1.9 2.3-1.9 2.2.4 2.9-2.7 1.1-1.1 2.7-2.9-.4L12 22.5l-2.2-1.9-2.9.4-1.1-2.7-2.7-1.1.4-2.9L1.6 12l1.9-2.2-.4-2.9 2.7-1.1 1.1-2.7 2.9.4z" />
          <Path d="M7.4 12.3l3 3 6.2-6.4" fill="none" stroke={c.paper} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )}
    </View>
  );
}

export const isBirthdayToday = (b: Birthday | null | undefined) => !!b && isBirthdayOn(b, localToday());

export function BirthdayTag({ b }: { b: Birthday | null | undefined }) {
  return isBirthdayToday(b) ? <Tag label="birthday today" red /> : null;
}
