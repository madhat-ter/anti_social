import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';

/**
 * A scrolling page with the site's column (max 46rem wide, 16 side padding), safe from the notch
 * and the keyboard. `top`: pad under the status bar (screens without a header bar).
 */
export function Screen({ children, top, refreshing, onRefresh, style }: {
  children: ReactNode; top?: boolean; refreshing?: boolean; onRefresh?: () => void; style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.paper }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.ink} /> : undefined}
        contentContainerStyle={{ paddingTop: top ? insets.top + 16 : 16, paddingBottom: insets.bottom + 32, paddingHorizontal: 16 }}
      >
        <View style={[{ gap: 16, width: '100%', maxWidth: 736, alignSelf: 'center' }, style]}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
