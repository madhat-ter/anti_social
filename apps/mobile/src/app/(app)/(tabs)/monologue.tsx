/**
 * Monologue (RFC §10.22): only the cassettes, under the feed's rules (newest first, its own line,
 * an end), one kind or all. Record sits on top.
 */
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { MONOLOGUE_KINDS, MONOLOGUE_KIND_LABEL, type MonologueKind } from '@anti/shared';
import { api, type Post } from '@/lib/api';
import { usePaged } from '@/lib/paged';
import { useMe } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { FeedList, useFeedVisit } from '@/components/FeedList';
import { Btn, Chip, Row, Text } from '@/components/ui';

export default function MonologueScreen() {
  const me = useMe();
  const { c } = useTheme();
  const [kind, setKind] = useState<MonologueKind | 'all'>('all');
  const fv = useFeedVisit(me.handle, 'monologues');
  const p = usePaged<Post>(['monologues', kind], async (cur) => {
    const page = await api.monologues(cur, 20, { kind: kind === 'all' ? null : kind, ...(cur ? {} : fv.params()) });
    if (page.visit) fv.got(page.visit);
    return page;
  });
  const caughtUp = useCallback((through: string) => api.monologuesCaughtUp(through), []);
  const refresh = useCallback(() => { fv.restart(); void p.refresh(); }, [fv, p]);

  return (
    <FeedList
      p={p} visit={fv.visit} mine={me.handle} what="monologues" caughtUp={caughtUp}
      empty={kind === 'all' ? 'No monologues yet. Record the first one.' : `No ${MONOLOGUE_KIND_LABEL[kind].toLowerCase()}s yet.`}
      onRefresh={refresh} onScroll={fv.touch}
      header={
        <View style={{ gap: 12 }}>
          <Row>
            <Text v="poster" accessibilityRole="header" style={{ flex: 1, fontSize: 38, lineHeight: 38 }}>Monologue</Text>
            <Btn kind="primary" label="Record" onPress={() => router.push('/record')}
              icon={<View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: c.signal }} />} />
          </Row>
          <Text v="meta">Songs, thoughts and yaps, five minutes at most, in your own voice.</Text>
          <Row gap={8} wrap>
            <Chip label="All" on={kind === 'all'} onPress={() => setKind('all')} />
            {MONOLOGUE_KINDS.map((k) => <Chip key={k} label={MONOLOGUE_KIND_LABEL[k]} on={kind === k} onPress={() => setKind(k)} />)}
          </Row>
        </View>
      }
    />
  );
}
