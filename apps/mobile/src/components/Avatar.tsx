/**
 * The doodle faces, drawn by the website's own code (face.generated.tsx, made from
 * apps/web/src/components/Avatar.tsx by scripts/sync-mobile-avatar.ts). Same handle + gender, same
 * face, on the site and in the app.
 */
import { memo } from 'react';
import Svg, { G, Rect, Text as SvgText } from 'react-native-svg';
import type { Gender } from '@anti/shared';
import { FONT, useTheme } from '@/lib/theme';
import { drawFace } from './face.generated';

export const Avatar = memo(function Avatar({ seed, gender = null, size = 40, label, ink }: {
  /** usually the handle; null = deleted user */
  seed: string | null; gender?: Gender | null; size?: number; label?: string;
  /** draw in another colour (e.g. paper on an ink tab) */
  ink?: string;
}) {
  const { c } = useTheme();
  const color = ink ?? c.ink;
  return (
    <Svg
      viewBox="0 0 64 64" width={size} height={size} color={color}
      accessible={!!label} accessibilityLabel={label} accessibilityRole={label ? 'image' : undefined}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
    >
      {seed ? drawFace(seed, gender, c.paper) : (
        <G>
          <Rect x="9" y="9" width="50" height="50" fill={color} />
          <Rect x="5" y="5" width="50" height="50" fill={c.paper} stroke={color} strokeWidth={2.2} strokeDasharray="4 4" />
          <SvgText x="30" y="38" textAnchor="middle" fontSize="20" fontFamily={FONT.ui} fill={color}>?</SvgText>
        </G>
      )}
    </Svg>
  );
});
