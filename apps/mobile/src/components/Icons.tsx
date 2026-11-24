/** The site's 1-bit icons (PhoneBar.tsx TabIcon, retro.tsx alert/hello, the login key), drawn natively. */
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '@/lib/theme';

export type IconName = 'feed' | 'collabs' | 'members' | 'bell' | 'tape' | 'file' | 'search' | 'camera' | 'mic';

/** `fill`: the inside colour; a lit (ink) tab passes ink so the lines stay visible */
export function TabIcon({ name, size = 24, color, fill }: { name: IconName; size?: number; color?: string; fill?: string }) {
  const { c } = useTheme();
  const ink = color ?? c.ink;
  const s = { fill: fill ?? c.paper, stroke: ink, strokeWidth: 2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  const line = { stroke: ink, strokeWidth: 2, strokeLinecap: 'round' as const, fill: 'none' };
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size}>
      {name === 'feed' && (<>
        <Rect x="4" y="3" width="16" height="18" {...s} />
        <Path d="M8 8h8M8 12h8M8 16h5" {...line} />
      </>)}
      {name === 'collabs' && (<>
        <Rect x="3" y="3" width="12" height="12" {...s} />
        <Rect x="9" y="9" width="12" height="12" {...s} />
      </>)}
      {name === 'members' && (<>
        <Rect x="3" y="4" width="8" height="8" {...s} />
        <Rect x="13" y="4" width="8" height="8" {...s} fill={ink} />
        <Rect x="3" y="14" width="8" height="8" {...s} />
        <Rect x="13" y="14" width="8" height="8" {...s} />
      </>)}
      {name === 'tape' && (<>
        <Rect x="2" y="5" width="20" height="14" rx="1.5" {...s} />
        <Circle cx="8" cy="11" r="2.2" {...s} />
        <Circle cx="16" cy="11" r="2.2" {...s} />
        <Path d="M7 19l1.6-3.2h6.8L17 19" {...s} />
      </>)}
      {name === 'file' && (<>
        <Path d="M3 20V5h7l2 3h9v12Z" {...s} />
        <Path d="M3 11h18" {...line} />
      </>)}
      {name === 'bell' && (<>
        <Path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4l2-2Z" {...s} />
        <Path d="M10 21h4" {...line} />
      </>)}
      {name === 'search' && (<>
        <Circle cx="10" cy="10" r="6" {...s} />
        <Path d="M15 15l6 6" {...line} />
      </>)}
      {name === 'camera' && (<>
        <Path d="M3 7h4l2-3h6l2 3h4v13H3Z" {...s} />
        <Circle cx="12" cy="13" r="3.5" {...s} />
      </>)}
      {name === 'mic' && (<>
        <Rect x="9" y="3" width="6" height="11" rx="3" {...s} />
        <Path d="M5 11a7 7 0 0 0 14 0M12 18v3" {...line} />
      </>)}
    </Svg>
  );
}

/** The little warning triangle from the alert dialogs. */
export function AlertIcon({ size = 34 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <Svg viewBox="0 0 32 32" width={size} height={size}>
      <Path d="M16 3 L30 28 L2 28 Z" fill={c.paper} stroke={c.ink} strokeWidth={2.4} strokeLinejoin="round" />
      <Rect x="14.6" y="11" width="2.8" height="9.5" fill={c.ink} />
      <Rect x="14.6" y="22.5" width="2.8" height="2.8" fill={c.ink} />
    </Svg>
  );
}

/** A plain smiling face, where a window says hello rather than warns (RFC §10.25). */
export function HelloIcon({ size = 34 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <Svg viewBox="0 0 32 32" width={size} height={size}>
      <Rect x="3" y="3" width="26" height="26" rx="5" fill={c.paper} stroke={c.ink} strokeWidth={2.4} />
      <Rect x="10" y="10.5" width="2.8" height="5" fill={c.ink} />
      <Rect x="19.2" y="10.5" width="2.8" height="5" fill={c.ink} />
      <Path d="M9.5 19.5 Q16 26 22.5 19.5" fill="none" stroke={c.ink} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}

/** A 1-bit key, drawn to match the alert icon (sign-in). */
export function KeyIcon({ size = 34 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <Svg viewBox="0 0 32 32" width={size} height={size}>
      <Circle cx="10" cy="16" r="6.5" fill={c.paper} stroke={c.ink} strokeWidth={2.4} />
      <Circle cx="10" cy="16" r="2" fill={c.ink} />
      <Path d="M16.5 16 H29 M24 16 V21 M28 16 V20" stroke={c.ink} strokeWidth={2.4} strokeLinecap="square" fill="none" />
    </Svg>
  );
}
