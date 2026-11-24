/**
 * One post (apps/web/src/components/PostCard.tsx). In a list (feed, profile) each post is its own
 * framed card shaped by what it is (RFC §10.15): a photo runs full width with the words under it,
 * a short status is set large, a long one folds after a few lines. A monologue is the cassette
 * itself (RFC §10.22). Reply opens the box right under the post (RFC §10.26). Likes are a red dot;
 * a number shows only on your own posts.
 */
import { memo, useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { FEED, MONOLOGUE, MONOLOGUE_KINDS, MONOLOGUE_KIND_LABEL, postShape, type MonologueKind } from '@anti/shared';
import { api, errorMessage, EDIT_WINDOW_MS, mediaSource, POST_MAX, type Post } from '@/lib/api';
import { fmtDate, relativeTime } from '@/lib/format';
import { FONT, useTheme } from '@/lib/theme';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { ImageViewer } from './ImageViewer';
import { BirthdayTag, NameMarks } from './Marks';
import { ActionMenu, Confirm, type MenuItem } from './Menu';
import { TapeCard } from './Tape';
import { Btn, Chip, Dot, ErrorNote, Field, Row, Shadowed, Tag, Text } from './ui';

const URL_RE = /https?:\/\/[^\s<>"]+/g;
const MENTION_RE = /(?<![\w@])@([a-zA-Z][a-zA-Z0-9_]{2,19})/g;

/** plain text with http(s) links and real @mentions made tappable (never anything else) */
export function linkify(text: string, mentions: string[] = [], linkColor: string): ReactNode[] {
  const wanted = new Set(mentions.map((m) => m.toLowerCase()));
  const tokens: { at: number; len: number; node: ReactNode }[] = [];
  let n = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    const trail = url.match(/[.,;:!?)\]'"]+$/)?.[0] ?? '';
    if (trail) url = url.slice(0, url.length - trail.length);
    if (!url) continue;
    tokens.push({ at: m.index ?? 0, len: url.length, node: <Text key={`u${n++}`} style={{ textDecorationLine: 'underline' }} onPress={() => void Linking.openURL(url)} accessibilityRole="link">{url}</Text> });
  }
  if (wanted.size) {
    for (const m of text.matchAll(MENTION_RE)) {
      const handle = m[1]!;
      if (!wanted.has(handle.toLowerCase())) continue;
      const at = m.index ?? 0;
      const len = m[0].length;
      if (tokens.some((t) => at < t.at + t.len && at + len > t.at)) continue;
      tokens.push({ at, len, node: <Text key={`m${n++}`} style={{ color: linkColor, fontFamily: FONT.textMedium }} onPress={() => router.push({ pathname: '/u/[handle]', params: { handle } })} accessibilityRole="link">@{handle}</Text> });
    }
  }
  tokens.sort((a, b) => a.at - b.at);
  const out: ReactNode[] = [];
  let last = 0;
  for (const t of tokens) {
    if (t.at > last) out.push(text.slice(last, t.at));
    out.push(t.node);
    last = t.at + t.len;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const openProfile = (handle: string) => router.push({ pathname: '/u/[handle]', params: { handle } });
const openThread = (rootId: string, focus?: string) => router.push({ pathname: '/p/[id]', params: { id: rootId, focus: focus ?? '' } });

function snip(s: string, max = 60): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : max)}…`;
}

export const PostCard = memo(function PostCard({ post, onChange, variant, framed, highlight, context = 'all', replyingTo }: {
  post: Post; onChange: (p: Post) => void;
  /** 'lead' heads its thread; 'reply' sits inside one. Left out: a post in a list. */
  variant?: 'lead' | 'reply';
  framed?: boolean; highlight?: boolean;
  context?: 'all' | 'event' | 'none';
  replyingTo?: string | null;
}) {
  const { c } = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [draftTitle, setDraftTitle] = useState(post.monologue?.title ?? '');
  const [draftKind, setDraftKind] = useState<MonologueKind>(post.monologue?.kind ?? 'thought');
  const [menu, setMenu] = useState(false);
  const [ask, setAsk] = useState<null | 'delete' | 'report' | 'moderate'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [reported, setReported] = useState(false);
  const [opened, setOpened] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [replying, setReplying] = useState(false);
  const [replied, setReplied] = useState(false);
  const likeBusy = useRef(false);

  const mono = post.monologue ?? null;
  const shape = framed ? postShape(post.body, post.images.length, !!mono) : null;
  const clamp = !!framed && shape !== 'short' && !editing && !opened && !post.deleted;
  const listReply = !variant && !!post.parentId;
  const compact = variant === 'reply' || listReply;
  const inPlace = !variant;
  const face = compact || mono ? 36 : 48;

  if (post.deleted) {
    return (
      <View style={{ padding: 12, borderWidth: framed ? 2 : 0, borderStyle: 'dashed', borderColor: c.gray }}>
        <Text muted>This post was deleted.</Text>
      </View>
    );
  }

  const threadRoot = post.rootId ?? post.id;

  async function toggleLike() {
    if (likeBusy.current) return;
    likeBusy.current = true;
    setErr(null);
    const was = post;
    const nextLiked = !post.likedByMe;
    if (nextLiked) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange({ ...post, likedByMe: nextLiked, likeCount: post.likeCount === null ? null : Math.max(0, post.likeCount + (nextLiked ? 1 : -1)) });
    try {
      const r = nextLiked ? await api.like(post.id) : await api.unlike(post.id);
      onChange({ ...was, likedByMe: r.likedByMe, likeCount: r.likeCount });
    } catch (e) {
      onChange(was);
      setErr(errorMessage(e));
    } finally {
      likeBusy.current = false;
    }
  }

  async function saveEdit() {
    const body = draft.trim();
    if ((!body && !mono) || body.length > POST_MAX) return;
    if (mono && (!draftTitle.trim() || draftTitle.length > MONOLOGUE.titleMax)) return;
    setBusy(true); setErr(null);
    try {
      onChange(await api.editPost(post.id, body, mono ? { title: draftTitle.trim(), kind: draftKind } : undefined));
      setEditing(false);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  async function remove(asAdmin: boolean) {
    setAsk(null); setErr(null);
    try {
      if (asAdmin) await api.opsRemovePost(post.id); else await api.deletePost(post.id);
      onChange({ ...post, deleted: true, body: '', images: [], monologue: null });
    } catch (e) { setErr(errorMessage(e)); }
  }
  async function report(reason: string) {
    setAsk(null); setErr(null);
    try { await api.flagPost(post.id, reason || undefined); setReported(true); } catch (e) { setErr(errorMessage(e)); }
  }

  const items: MenuItem[] = [
    ...(post.canEdit ? [{ label: 'Edit', onPress: () => { setDraft(post.body); setDraftTitle(mono?.title ?? ''); setDraftKind(mono?.kind ?? 'thought'); setEditing(true); } }] : []),
    ...(post.canDelete ? [{ label: 'Delete', danger: true, onPress: () => setAsk('delete') }] : []),
    ...(post.canReport ? [{ label: reported ? 'Reported' : 'Report', disabled: reported, onPress: () => setAsk('report') }] : []),
    ...(post.canModerate ? [{ label: 'Remove (admin)', danger: true, onPress: () => setAsk('moderate') }] : []),
  ];

  const liked = post.likeCount !== null && post.likeCount > 0;
  const replyLabel = post.replyCount > 0
    ? `${post.replyCount} ${post.replyCount === 1 ? 'reply' : 'replies'}`
    : post.firstPost && !post.canDelete ? 'Say hello' : 'Reply';
  const minutesLeft = Math.max(0, Math.ceil((new Date(post.createdAt).getTime() + EDIT_WINDOW_MS - Date.now()) / 60000));
  const photoLed = shape === 'photo';
  const big = shape === 'short';
  const a = post.author;

  const head = (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Pressable onPress={() => a && openProfile(a.handle)} disabled={!a} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Avatar seed={a?.handle ?? null} gender={a?.gender ?? null} size={face} />
      </Pressable>
      <View style={{ flex: 1, gap: 2 }}>
        {variant === 'lead' && <View style={{ alignSelf: 'flex-start' }}><Tag label={mono ? 'Monologue' : 'Post'} /></View>}
        <Row wrap gap={6}>
          {a ? (
            <>
              <Text v="bold" onPress={() => openProfile(a.handle)} numberOfLines={1} style={{ fontSize: compact ? 15 : 16, flexShrink: 1 }}>{a.displayName}</Text>
              <NameMarks admin={a.role === 'ops'} verified={a.verified} size={13} />
              <Text v="meta" onPress={() => openProfile(a.handle)} numberOfLines={1} style={{ flexShrink: 1 }}>@{a.handle}</Text>
              <BirthdayTag b={a.birthday} />
              {a.isNew && a.state !== 'archived' && <Tag label="new here" />}
              {a.state === 'archived' && <Tag label="archived" />}
            </>
          ) : <Text muted>deleted user</Text>}
          {post.hidden && <Tag label="hidden after reports" danger />}
        </Row>
        <Row gap={6}>
          <Text v="meta" onPress={() => openThread(threadRoot, post.id)} accessibilityLabel={fmtDate(post.createdAt)}>{relativeTime(post.createdAt)}</Text>
          {post.editedAt && <Text v="meta">(edited)</Text>}
        </Row>
      </View>
      {items.length > 0 && (
        <Pressable onPress={() => setMenu(true)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Post actions"
          style={{ paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text v="ui" style={{ fontSize: 20 }}>⋯</Text>
        </Pressable>
      )}
    </View>
  );

  const editBox = editing && (
    <View style={{ gap: 10 }}>
      {mono && (
        <>
          <Field label="Title" value={draftTitle} maxLength={MONOLOGUE.titleMax} onChangeText={setDraftTitle} />
          <Row gap={8}>{MONOLOGUE_KINDS.map((k) => <Chip key={k} label={MONOLOGUE_KIND_LABEL[k]} on={draftKind === k} onPress={() => setDraftKind(k)} />)}</Row>
        </>
      )}
      <Field value={draft} onChangeText={setDraft} multiline autoFocus accessibilityLabel={mono ? 'Edit the note' : 'Edit post'} inputStyle={{ minHeight: 100 }} />
      <Row gap={8}>
        <Btn small kind="primary" label={busy ? 'Saving...' : 'Save'} onPress={() => void saveEdit()}
          disabled={busy || (!draft.trim() && !mono) || draft.length > POST_MAX || (!!mono && !draftTitle.trim())} />
        <Btn small label="Cancel" onPress={() => { setEditing(false); setErr(null); }} />
        <View style={{ flex: 1 }} />
        <Text v="meta">{minutesLeft > 0 ? `~${minutesLeft} min left` : ''}</Text>
      </Row>
    </View>
  );

  const bodyNode = !editing && post.body.trim() ? (
    <View>
      <Text
        selectable
        numberOfLines={clamp ? FEED.clampLines : undefined}
        onTextLayout={clamp && !overflows ? (e) => { if (e.nativeEvent.lines.length >= FEED.clampLines) setOverflows(true); } : undefined}
        style={big ? { fontFamily: FONT.textMedium, fontSize: 22, lineHeight: 30 } : compact ? { fontSize: 16, lineHeight: 23 } : undefined}
      >
        {linkify(post.body, post.mentions, c.signalText)}
      </Text>
      {clamp && overflows && (
        <Text v="ui" onPress={() => setOpened(true)} accessibilityRole="button" style={{ marginTop: 4, textDecorationLine: 'underline' }}>Read more</Text>
      )}
    </View>
  ) : null;

  const n = post.images.length;
  const imgs = n > 0 && (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      {post.images.map((im, i) => (
        <Pressable key={im.id} onPress={() => setViewing(i)} accessibilityRole="imagebutton" accessibilityLabel={`Open image ${i + 1} of ${n}`}
          style={{ width: n === 1 ? '100%' : '49%', aspectRatio: n === 1 ? Math.max(0.6, Math.min(2, im.width / Math.max(1, im.height))) : 1, borderWidth: 2, borderColor: c.ink }}>
          <Image source={mediaSource(im.url)} style={{ flex: 1 }} contentFit="cover" transition={120} recyclingKey={im.id} />
        </Pressable>
      ))}
    </View>
  );

  const foot = (
    <Row gap={18} style={{ paddingTop: 4 }}>
      {inPlace && post.replyCount > 0 && (
        <Text v="ui" onPress={() => openThread(threadRoot, post.id)} accessibilityRole="link">↳ {replyLabel}</Text>
      )}
      {inPlace ? (
        <Text v="ui" onPress={() => { if (!post.hidden) { setReplying((r) => !r); setReplied(false); } }} accessibilityRole="button" accessibilityState={{ expanded: replying }}>
          {replying ? 'Cancel reply' : post.replyCount > 0 ? 'Reply' : `↳ ${replyLabel}`}
        </Text>
      ) : (
        <Text v="ui" onPress={() => openThread(threadRoot, post.id)} accessibilityRole="link">↳ {replyLabel}</Text>
      )}
      <Pressable onPress={() => void toggleLike()} disabled={post.hidden} hitSlop={10}
        accessibilityRole="button" accessibilityState={{ selected: post.likedByMe }}
        accessibilityLabel={liked ? `Like, ${post.likeCount}, only you see this` : 'Like'}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Dot on={post.likedByMe} size={13} />
        <Text v="ui">{liked ? String(post.likeCount) : 'Like'}</Text>
      </Pressable>
    </Row>
  );

  const contextLine = !post.parentId && ((context === 'all' && (post.collab || post.event)) || (context === 'event' && post.event)) ? (
    <Text v="meta">
      Update
      {context === 'all' && post.collab && <> in <Text v="meta" style={{ textDecorationLine: 'underline' }} onPress={() => router.push({ pathname: '/collab/[id]', params: { id: post.collab!.id } })}>{post.collab.title}</Text></>}
      {post.event && <> from <Text v="meta" style={{ textDecorationLine: 'underline' }} onPress={() => router.push({ pathname: '/collab/event/[id]', params: { id: post.event!.id } })}>{post.event.title}</Text></>}
    </Text>
  ) : null;

  const inner = (
    <View style={{ gap: 10, padding: framed ? 14 : 0, backgroundColor: highlight ? c.highlight : undefined }}>
      {listReply && post.replyTo && (
        <Text v="meta" numberOfLines={2} onPress={() => openThread(post.replyTo!.rootId, post.id)}>
          ↳ Replied to {post.replyTo.author ? `${post.replyTo.author.displayName}’s` : 'a'} post{post.replyTo.snippet ? `: “${snip(post.replyTo.snippet)}”` : ''}
        </Text>
      )}
      {head}
      {post.firstPost && <View style={{ alignSelf: 'flex-start' }}><Tag label="First post" /></View>}
      {contextLine}
      {reported && <Text v="meta" accessibilityLiveRegion="polite">Reported. Thanks, a moderator will take a look.</Text>}
      {replyingTo && <Text v="meta">replying to <Text v="meta" onPress={() => openProfile(replyingTo)} style={{ textDecorationLine: 'underline' }}>@{replyingTo}</Text></Text>}
      {mono && <TapeCard id={post.id} mono={editing ? { ...mono, title: draftTitle || mono.title, kind: draftKind } : mono} who={a?.displayName} />}
      {photoLed && imgs}
      {editBox}
      {bodyNode}
      {!photoLed && imgs}
      <ErrorNote message={err} />
      {foot}
      {inPlace && replying && (
        <Composer parentId={post.id} autoFocus placeholder={a ? `Reply to @${a.handle}...` : undefined}
          onCreated={() => { setReplying(false); setReplied(true); onChange({ ...post, replyCount: post.replyCount + 1 }); }} />
      )}
      {replied && !replying && (
        <Text v="meta" accessibilityLiveRegion="polite">Reply sent. <Text v="meta" style={{ textDecorationLine: 'underline' }} onPress={() => openThread(threadRoot)}>See the thread</Text></Text>
      )}
    </View>
  );

  return (
    <>
      {framed ? (
        <Shadowed offset={3}>
          <View style={{ borderWidth: 2, borderColor: c.ink, backgroundColor: c.paper }}>{inner}</View>
        </Shadowed>
      ) : (
        <View style={compact && variant === 'reply' ? { borderLeftWidth: 3, borderColor: c.hair, paddingLeft: 12 } : undefined}>{inner}</View>
      )}
      <ActionMenu open={menu} title="post" items={items} onClose={() => setMenu(false)} />
      <Confirm open={ask === 'delete'} title="Delete post" danger confirmLabel="Delete"
        message={mono ? 'Delete this monologue? The recording is erased for good; replies stay. This cannot be undone.' : 'Delete this post? Replies stay, the post becomes a tombstone. This cannot be undone.'}
        onConfirm={() => void remove(false)} onCancel={() => setAsk(null)} />
      <Confirm open={ask === 'moderate'} title="Remove post" danger confirmLabel="Remove"
        message={`Remove this post as admin? ${a ? `@${a.handle} is told it was removed. ` : ''}This cannot be undone.`}
        onConfirm={() => void remove(true)} onCancel={() => setAsk(null)} />
      <Confirm open={ask === 'report'} title="Report post" confirmLabel="Send report"
        message="Report this post to the moderators. What is wrong with it? (optional)"
        input={{ label: 'Reason', placeholder: 'Spam, harassment, ...', maxLength: 500 }}
        onConfirm={(r) => void report(r)} onCancel={() => setAsk(null)} />
      {n > 0 && (
        <ImageViewer images={post.images} index={viewing} onClose={() => setViewing(null)}
          alt={(i) => `Image ${i + 1} of ${n}${a ? ` posted by @${a.handle}` : ''}`} />
      )}
    </>
  );
});

export function replaceIn(list: Post[], p: Post): Post[] {
  return list.map((x) => (x.id === p.id ? p : x));
}
