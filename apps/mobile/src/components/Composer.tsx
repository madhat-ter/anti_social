/**
 * The post box (apps/web/src/components/Composer.tsx): a window with words, up to four photos and,
 * on the feed while it is empty, Record (RFC §10.26). Typing @ lists members (RFC §10.16). The draft
 * is kept on the phone, one per place you can write.
 */
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, TextInput, View, type TextInputSelectionChangeEvent } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage, IMAGE_MAX_BYTES, IMAGES_MAX, POST_MAX, type Image as Img, type Post } from '@/lib/api';
import { FONT, useTheme } from '@/lib/theme';
import { Avatar } from './Avatar';
import { Btn, ErrorNote, Row, Shadowed, Text, Touch } from './ui';

interface Att { key: string; uri: string; status: 'uploading' | 'done' | 'error'; image?: Img; error?: string }

/** the word being typed right before the cursor, when it starts with @ */
function mentionAt(text: string, caret: number): { start: number; q: string } | null {
  const before = text.slice(0, caret);
  const m = before.match(/(^|[^\w@])@([a-zA-Z0-9_]{0,20})$/);
  if (!m) return null;
  return { start: caret - m[2]!.length - 1, q: m[2]! };
}

export function Composer({ parentId, collabId, eventId, onCreated, placeholder, submitLabel, autoFocus, record, title }: {
  parentId?: string; collabId?: string; eventId?: string;
  onCreated: (p: Post) => void; placeholder?: string; submitLabel?: string; autoFocus?: boolean;
  /** the feed's box: Record sits beside + Photo while nothing is written */
  record?: boolean;
  title?: string;
}) {
  const { c } = useTheme();
  const [body, setBody] = useState('');
  const [atts, setAtts] = useState<Att[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  const draftKey = `anti:draft:${parentId ?? (collabId ? `c:${collabId}` : eventId ? `e:${eventId}` : 'feed')}`;
  const restored = useRef(false);
  useEffect(() => {
    AsyncStorage.getItem(draftKey).then((d) => { if (d) setBody(d); }).finally(() => { restored.current = true; });
  }, [draftKey]);
  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => { void (body.trim() ? AsyncStorage.setItem(draftKey, body) : AsyncStorage.removeItem(draftKey)); }, 400);
    return () => clearTimeout(t);
  }, [body, draftKey]);

  // RFC §10.16: @ opens the members list
  const men = focused ? mentionAt(body, caret) : null;
  const menQ = useQuery({
    queryKey: ['mention', men?.q ?? ''],
    queryFn: () => api.mentionMembers(men!.q),
    enabled: !!men,
    staleTime: 60_000,
  });
  const pickMention = (handle: string) => {
    if (!men) return;
    const next = `${body.slice(0, men.start)}@${handle} ${body.slice(caret)}`;
    setBody(next);
    setCaret(men.start + handle.length + 2);
  };

  const uploading = atts.some((a) => a.status === 'uploading');
  const hasImage = atts.some((a) => a.status === 'done');
  const trimmed = body.trim();
  const over = body.length > POST_MAX;
  const canPost = !busy && !uploading && (trimmed.length > 0 || hasImage) && !over;

  async function pick() {
    setErr(null);
    const room = IMAGES_MAX - atts.length;
    if (room <= 0) return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: room, quality: 0.85, exif: false,
    });
    if (r.canceled) return;
    for (const a of r.assets.slice(0, room)) {
      if (a.fileSize && a.fileSize > IMAGE_MAX_BYTES) { setErr('That photo is larger than 5 MB.'); continue; }
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setAtts((cur) => [...cur, { key, uri: a.uri, status: 'uploading' }]);
      const type = a.mimeType ?? 'image/jpeg';
      const name = a.fileName ?? `photo.${type.split('/')[1] ?? 'jpg'}`;
      api.upload({ uri: a.uri, name, type }).then(
        (image) => setAtts((cur) => cur.map((x) => (x.key === key ? { ...x, status: 'done', image } : x))),
        (e) => setAtts((cur) => cur.map((x) => (x.key === key ? { ...x, status: 'error', error: errorMessage(e) } : x))),
      );
    }
  }

  async function submit() {
    if (!canPost) return;
    setBusy(true); setErr(null);
    try {
      const imageIds = atts.filter((a) => a.status === 'done' && a.image).map((a) => a.image!.id);
      const post = await api.createPost({
        body: trimmed,
        ...(parentId ? { parentId } : {}),
        ...(collabId ? { collabId } : {}),
        ...(eventId ? { eventId } : {}),
        ...(imageIds.length ? { imageIds } : {}),
      });
      await AsyncStorage.removeItem(draftKey);
      setBody(''); setAtts([]);
      input.current?.blur();
      onCreated(post);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const people = menQ.data?.items ?? [];
  return (
    <Shadowed>
      <View style={{ borderWidth: 2, borderColor: c.ink, backgroundColor: c.paper }}>
        <View style={{ height: 26, borderBottomWidth: 2, borderColor: c.ink, justifyContent: 'center', alignItems: 'center' }}>
          <Text v="ui" style={{ fontSize: 13 }}>{title ?? (parentId ? 'reply.txt' : 'new_post.txt')}</Text>
        </View>
        <View style={{ padding: 12, gap: 10 }}>
          <TextInput
            ref={input}
            value={body}
            onChangeText={setBody}
            onSelectionChange={(e: TextInputSelectionChangeEvent) => setCaret(e.nativeEvent.selection.end)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            autoFocus={autoFocus}
            multiline
            placeholder={placeholder ?? (parentId ? 'Write a reply...' : 'What is on your mind?')}
            placeholderTextColor={c.gray}
            selectionColor={c.signal}
            accessibilityLabel={parentId ? 'Write a reply' : 'Write a post'}
            style={{ fontFamily: FONT.text, fontSize: 17, lineHeight: 24, color: c.ink, minHeight: parentId ? 64 : 84, textAlignVertical: 'top', padding: 0 }}
          />
          {men && people.length > 0 && (
            <View style={{ borderWidth: 2, borderColor: c.ink }} accessibilityRole="menu">
              {people.slice(0, 5).map((m) => (
                <Touch key={m.handle} onPress={() => pickMention(m.handle)} accessibilityRole="menuitem"
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 }}>
                  <Avatar seed={m.handle} gender={m.gender} size={26} />
                  <Text v="small" numberOfLines={1} style={{ flex: 1 }}>{m.displayName} <Text v="small" muted>@{m.handle}</Text></Text>
                </Touch>
              ))}
            </View>
          )}
          {atts.length > 0 && (
            <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
              {atts.map((a, i) => (
                <View key={a.key} style={{ width: 76, height: 76, borderWidth: 2, borderColor: a.status === 'error' ? c.signal : c.ink }}>
                  <Image source={{ uri: a.uri }} style={{ flex: 1, opacity: a.status === 'uploading' ? 0.45 : 1 }} contentFit="cover" accessibilityLabel={`Attachment ${i + 1}`} />
                  {a.status === 'error' && <Text v="ui" style={{ position: 'absolute', bottom: 2, left: 4, fontSize: 11, color: c.signalText }}>Failed</Text>}
                  <Pressable onPress={() => setAtts((cur) => cur.filter((x) => x.key !== a.key))} hitSlop={8}
                    accessibilityRole="button" accessibilityLabel={`Remove image ${i + 1}`}
                    style={{ position: 'absolute', top: -2, right: -2, width: 22, height: 22, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
                    <Text v="ui" style={{ color: c.paper, fontSize: 14, lineHeight: 16 }}>×</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
          {atts.filter((a) => a.error).map((a) => <ErrorNote key={a.key} message={a.error} />)}
          <ErrorNote message={err} />
          <Row gap={8}>
            <Btn small label="+ Photo" onPress={() => void pick()} disabled={atts.length >= IMAGES_MAX} />
            {record && !body && atts.length === 0 && (
              <Btn small label="Record" onPress={() => router.push('/record')}
                icon={<View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.signal }} />} />
            )}
            <View style={{ flex: 1 }} />
            <Text v="ui" style={{ fontSize: 13, color: over ? c.signalText : c.gray }}>{body.length}/{POST_MAX}</Text>
            <Btn small kind="primary" label={busy ? 'Posting...' : (submitLabel ?? (parentId ? 'Reply' : 'Post'))} onPress={() => void submit()} disabled={!canPost} />
          </Row>
        </View>
      </View>
    </Shadowed>
  );
}
