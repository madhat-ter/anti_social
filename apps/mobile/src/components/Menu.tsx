/**
 * The ⋯ menu and the "are you sure" box, as 1-bit windows from the bottom of the screen
 * (the site's .menu-pop and AlertDialog). Only things that can't be undone ask first (RFC §10.26).
 */
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { AlertIcon } from './Icons';
import { Btn, Field, Text, Touch, Win } from './ui';

export interface MenuItem { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }

export function ActionMenu({ open, title, items, onClose }: { open: boolean; title: string; items: MenuItem[]; onClose: () => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }} onPress={onClose} accessibilityLabel="Close menu">
        <Pressable style={{ padding: 16, paddingBottom: insets.bottom + 16 }} onPress={() => {}}>
          <Win title={title} onClose={onClose} bodyStyle={{ padding: 0, gap: 0 }}>
            {items.map((it, i) => (
              <Touch key={it.label} disabled={it.disabled} accessibilityRole="menuitem"
                onPress={() => { onClose(); it.onPress(); }}
                style={{ paddingVertical: 14, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderColor: c.hair, opacity: it.disabled ? 0.45 : 1 }}>
                <Text v="ui" style={{ fontSize: 17, color: it.danger ? c.signalText : c.ink }}>{it.label}</Text>
              </Touch>
            ))}
          </Win>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function Confirm({ open, title, message, confirmLabel, danger, input, onConfirm, onCancel }: {
  open: boolean; title: string; message: string; confirmLabel: string; danger?: boolean;
  /** an optional line to type (a report's reason) */
  input?: { label: string; placeholder?: string; maxLength?: number };
  onConfirm: (text: string) => void; onCancel: () => void;
}) {
  const [text, setText] = useState('');
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 20 }}>
        <Win title={title} onClose={onCancel}>
          <View style={{ flexDirection: 'row', gap: 14 }}>
            <AlertIcon />
            <Text style={{ flex: 1 }}>{message}</Text>
          </View>
          {input && <Field label={input.label} placeholder={input.placeholder} maxLength={input.maxLength} value={text} onChangeText={setText} />}
          <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
            <Btn label="Cancel" onPress={() => { setText(''); onCancel(); }} />
            <Btn label={confirmLabel} kind="default" danger={danger} onPress={() => { const t = text.trim(); setText(''); onConfirm(t); }} />
          </View>
        </Win>
      </View>
    </Modal>
  );
}
