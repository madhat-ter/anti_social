/**
 * The site's 1-bit desktop pieces, drawn natively (apps/web/src/components/retro.tsx + globals.css):
 * windows with a striped title bar and a hard ink shadow, square-edged buttons in the pixel face,
 * plain inputs with a 2px ink border, the red dot, tags and chips.
 */
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, Text as RNText, TextInput, View, type PressableProps, type StyleProp,
  type TextInputProps, type TextProps, type TextStyle, type ViewProps, type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { FONT, useTheme } from '@/lib/theme';

// ─── type ────────────────────────────────────────────────────────────────────
type Variant = 'body' | 'meta' | 'small' | 'ui' | 'poster' | 'h2' | 'bold' | 'big';

/** All text goes through here so it wears the theme's ink and the site's faces. */
export function Text({ v = 'body', muted, red, style, ...rest }: TextProps & { v?: Variant; muted?: boolean; red?: boolean }) {
  const { c } = useTheme();
  const base: TextStyle =
    v === 'poster' ? { fontFamily: FONT.poster, fontSize: 44, lineHeight: 42, textTransform: 'uppercase' }
    : v === 'h2' ? { fontFamily: FONT.poster, fontSize: 28, lineHeight: 28, textTransform: 'uppercase' }
    : v === 'big' ? { fontFamily: FONT.textMedium, fontSize: 22, lineHeight: 30 }
    : v === 'ui' ? { fontFamily: FONT.ui, fontSize: 15, lineHeight: 19 }
    : v === 'meta' ? { fontFamily: FONT.text, fontSize: 14, lineHeight: 19, color: c.grayStrong }
    : v === 'small' ? { fontFamily: FONT.text, fontSize: 14, lineHeight: 20 }
    : v === 'bold' ? { fontFamily: FONT.textBold, fontSize: 17, lineHeight: 25 }
    : { fontFamily: FONT.text, fontSize: 17, lineHeight: 26 };
  return <RNText {...rest} style={[{ color: c.ink }, base, muted && { color: c.gray }, red && { color: c.signalText }, style]} />;
}

// ─── windows ─────────────────────────────────────────────────────────────────
/** A hard offset shadow, the way the site draws it (box-shadow 5px 5px 0 ink). */
export function Shadowed({ children, offset = 5, color, style }: { children: ReactNode; offset?: number; color?: string; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[{ marginRight: offset, marginBottom: offset }, style]}>
      <View style={{ position: 'absolute', left: offset, top: offset, right: -offset, bottom: -offset, backgroundColor: color ?? c.shadow }} />
      {children}
    </View>
  );
}

function Stripes({ color }: { color: string }) {
  return (
    <Svg width="100%" height="100%" style={{ position: 'absolute' }}>
      <Defs>
        <Pattern id="stripes" width="4" height="3" patternUnits="userSpaceOnUse">
          <Rect x="0" y="0" width="4" height="1" fill={color} />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#stripes)" />
    </Svg>
  );
}

/** A 1-bit window: striped title bar, a close box (working when `onClose`), the body. */
export function Win({ title, children, onClose, dark, style, bodyStyle, accent }: {
  title: string; children: ReactNode; onClose?: () => void; dark?: boolean;
  style?: StyleProp<ViewStyle>; bodyStyle?: StyleProp<ViewStyle>;
  /** a red frame (the site's .win.offer) */
  accent?: boolean;
}) {
  const { c } = useTheme();
  const line = accent ? c.signal : c.ink;
  return (
    <Shadowed style={style} color={accent ? c.signal : undefined}>
      <View style={{ borderWidth: 2, borderColor: line, backgroundColor: c.paper }} accessibilityRole="none">
        <View style={{ height: 28, borderBottomWidth: 2, borderColor: line, padding: 5, justifyContent: 'center', alignItems: 'center', backgroundColor: dark ? c.ink : c.paper }}>
          {!dark && <View style={{ position: 'absolute', left: 5, right: 5, top: 5, bottom: 5 }}><Stripes color={c.ink} /></View>}
          <Pressable
            onPress={onClose} disabled={!onClose} hitSlop={10}
            accessibilityRole={onClose ? 'button' : undefined} accessibilityLabel={onClose ? `Close ${title}` : undefined}
            style={{ position: 'absolute', left: 9, width: 14, height: 14, borderWidth: 2, borderColor: line, backgroundColor: c.paper }}
          />
          <View style={{ backgroundColor: dark ? c.ink : c.paper, paddingHorizontal: 9, maxWidth: '75%' }}>
            <Text v="ui" numberOfLines={1} accessibilityRole="header" style={{ color: dark ? c.paper : c.ink }}>{title}</Text>
          </View>
        </View>
        <View style={[{ padding: 16, gap: 12 }, bodyStyle]}>{children}</View>
      </View>
    </Shadowed>
  );
}

/** A plain framed card (the site's .card / framed post). */
export function Card({ children, style, dashed, pad = 16 }: { children: ReactNode; style?: StyleProp<ViewStyle>; dashed?: boolean; pad?: number }) {
  const { c } = useTheme();
  const box = <View style={[{ borderWidth: 2, borderColor: c.ink, backgroundColor: c.paper, padding: pad, borderStyle: dashed ? 'dashed' : 'solid' }, dashed && style]}>{children}</View>;
  return dashed ? box : <Shadowed offset={3} style={style}>{box}</Shadowed>;
}

// ─── buttons ─────────────────────────────────────────────────────────────────
export function Btn({ label, onPress, kind = 'plain', danger, disabled, busy, small, style, icon, accessibilityLabel }: {
  label: string; onPress?: () => void; kind?: 'plain' | 'primary' | 'default';
  danger?: boolean; disabled?: boolean; busy?: boolean; small?: boolean; style?: StyleProp<ViewStyle>; icon?: ReactNode;
  accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const off = disabled || busy;
  const fill = off ? c.paper : kind === 'primary' ? c.ink : c.paper;
  const ink = off ? c.gray : kind === 'primary' ? c.paper : danger ? c.signalText : c.ink;
  const ring = danger ? c.signal : c.ink;
  const btn = (
    <Pressable
      onPress={() => { if (off) return; void Haptics.selectionAsync(); onPress?.(); }}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => [{
        flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center',
        paddingVertical: small ? 6 : 9, paddingHorizontal: small ? 11 : 16, minHeight: small ? 34 : 44,
        borderWidth: 2, borderRadius: 8, borderColor: off ? c.gray : danger ? c.signalText : c.ink,
        backgroundColor: pressed && !off ? (kind === 'primary' ? c.signal : c.ink) : fill,
        // always a list: RN 0.88 crashes ("forEach of null") when a transform is taken away on release
        transform: [{ translateX: pressed && !off ? 1 : 0 }, { translateY: pressed && !off ? 1 : 0 }],
      }, kind !== 'default' && style]}
    >
      {({ pressed }) => (
        <>
          {busy ? <ActivityIndicator size="small" color={c.gray} /> : icon}
          <Text v="ui" style={{ color: pressed && !off ? (kind === 'primary' ? c.signalInk : c.paper) : ink, fontSize: small ? 14 : 16 }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
  if (kind !== 'default' || off) return kind === 'default' ? <View style={style}>{btn}</View> : btn;
  // the default button in an alert: a double ring, like the System 6 "OK"
  return (
    <View style={[{ borderWidth: 2, borderColor: ring, borderRadius: 11, padding: 2 }, style]}>{btn}</View>
  );
}

/** An underlined word that acts (the site's .link-btn / a plain link). */
export function LinkText({ label, onPress, style, small }: { label: string; onPress: () => void; style?: StyleProp<TextStyle>; small?: boolean }) {
  return (
    <Text v={small ? 'small' : 'body'} onPress={onPress} accessibilityRole="link" suppressHighlighting={false}
      style={[{ textDecorationLine: 'underline' }, style]}>{label}</Text>
  );
}

// ─── fields ──────────────────────────────────────────────────────────────────
export function Field({ label, help, style, inputStyle, ...rest }: TextInputProps & { label?: string; help?: string; inputStyle?: StyleProp<TextStyle> }) {
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text v="ui">{label}</Text> : null}
      <Shadowed offset={focused ? 4 : 0}>
        <TextInput
          placeholderTextColor={c.gray}
          selectionColor={c.signal}
          {...rest}
          onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
          style={[{
            fontFamily: FONT.text, fontSize: 17, color: c.ink, backgroundColor: c.paper,
            borderWidth: 2, borderColor: c.ink, paddingHorizontal: 12, paddingVertical: 10, minHeight: 46,
            textAlignVertical: rest.multiline ? 'top' : 'center',
          }, inputStyle]}
        />
      </Shadowed>
      {help ? <Text v="small" muted>{help}</Text> : null}
    </View>
  );
}

export function ErrorNote({ message }: { message: string | null | undefined }) {
  const { c } = useTheme();
  if (!message) return null;
  return (
    <View style={{ borderLeftWidth: 4, borderColor: c.signal, paddingLeft: 10, paddingVertical: 2 }} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text v="ui" style={{ color: c.signalText }}>{message}</Text>
    </View>
  );
}

/** "Loading… please be patient", with the striped bar. */
export function Loading({ what = 'Loading' }: { what?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ padding: 24, gap: 10, alignItems: 'center' }} accessibilityRole="progressbar" accessibilityLabel={what}>
      <Text v="ui">{what}… please be patient</Text>
      <View style={{ width: 200, height: 16, borderWidth: 2, borderColor: c.ink, padding: 2 }}>
        <Stripes color={c.ink} />
      </View>
    </View>
  );
}

/** The red dot from the posters: likes, unread marks. */
export function Dot({ on = true, size = 12 }: { on?: boolean; size?: number }) {
  const { c } = useTheme();
  return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: on ? c.signal : c.ink, backgroundColor: on ? c.signal : 'transparent' }} />;
}

export function Tag({ label, on, danger, red, dashed }: { label: string; on?: boolean; danger?: boolean; red?: boolean; dashed?: boolean }) {
  const { c } = useTheme();
  const border = danger ? c.signalText : red ? c.signal : c.ink;
  return (
    <View style={{ borderWidth: 1.5, borderColor: border, borderStyle: dashed ? 'dashed' : 'solid', paddingHorizontal: 5, backgroundColor: on ? c.ink : red ? c.signal : 'transparent' }}>
      <Text v="ui" style={{ fontSize: 13, lineHeight: 18, color: on ? c.paper : danger ? c.signalText : red ? c.signalInk : c.ink }}>{label}</Text>
    </View>
  );
}

export function Chip({ label, on, onPress, disabled }: { label: string; on?: boolean; onPress: () => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => { void Haptics.selectionAsync(); onPress(); }} disabled={disabled}
      accessibilityRole="radio" accessibilityState={{ checked: !!on, disabled }}
      style={{ borderWidth: 2, borderColor: c.ink, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12, backgroundColor: on ? c.ink : c.paper, opacity: disabled ? 0.4 : 1 }}
    >
      <Text v="ui" style={{ fontSize: 14, color: on ? c.paper : c.ink }}>{label}</Text>
    </Pressable>
  );
}

/** A heading with the site's thick rule running to the right (.section-h / .day-h). */
export function RuleHeading({ children }: { children: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 14, paddingBottom: 4 }}>
      <Text v="h2" accessibilityRole="header" style={{ fontSize: 24, lineHeight: 26 }}>{children}</Text>
      <View style={{ flex: 1, height: 3, backgroundColor: c.ink }} />
    </View>
  );
}

export function Row({ children, style, gap = 10, wrap, ...rest }: ViewProps & { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number; wrap?: boolean }) {
  return <View {...rest} style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

/** A pressable row that takes the press feedback the site gives links (a faint ink wash). */
export function Touch({ children, style, ...rest }: PressableProps & { style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return <Pressable {...rest} style={({ pressed }) => [style, pressed && { backgroundColor: c.highlight }]}>{children}</Pressable>;
}

/** A red count (the site's .badge). */
export function Badge({ n }: { n: number }) {
  const { c } = useTheme();
  if (n <= 0) return null;
  return (
    <View style={{ position: 'absolute', top: -6, right: -8, backgroundColor: c.signal, paddingHorizontal: 4, paddingVertical: 2, minWidth: 18, alignItems: 'center' }}>
      <Text v="ui" style={{ fontSize: 11, lineHeight: 12, color: c.signalInk }}>{n > 99 ? '99+' : n}</Text>
    </View>
  );
}
