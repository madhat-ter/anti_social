/**
 * Edit profile (RFC §10.26: name, bio, face and the birthday tag live here, not in Settings).
 * Interests and the portfolio are edited on the website.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { DISPLAY_NAME_MAX, GENDERS, GENDER_LABEL, type Gender } from '@anti/shared';
import { api, errorMessage } from '@/lib/api';
import { openSite } from '@/lib/links';
import { useMe } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { Avatar } from '@/components/Avatar';
import { Screen } from '@/components/Screen';
import { Btn, Chip, ErrorNote, Field, LinkText, Row, Text, Touch } from '@/components/ui';

const BIO_MAX = 160;

export default function EditProfileScreen() {
  const me = useMe();
  const { c } = useTheme();
  const qc = useQueryClient();
  const [name, setName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio);
  const [gender, setGender] = useState<Gender | null>(me.gender);
  const [bday, setBday] = useState(me.birthdayPublic);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const next = await api.updateMe({ displayName: name.trim(), bio: bio.trim(), ...(gender ? { gender } : {}), birthdayPublic: bday });
      qc.setQueryData(['me'], next);
      void qc.invalidateQueries({ queryKey: ['member', me.handle] });
      router.back();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Screen>
      <Row style={{ justifyContent: 'center' }}>
        <View style={{ borderWidth: 2, borderColor: c.ink, padding: 4 }}>
          <Avatar seed={me.handle} gender={gender} size={110} label="Your face" />
        </View>
      </Row>
      <Text v="meta" style={{ textAlign: 'center' }}>Your face is drawn from your handle. Choosing a set changes the hair and shape.</Text>
      <Row wrap gap={8} style={{ justifyContent: 'center' }}>
        {GENDERS.map((g) => <Chip key={g} label={GENDER_LABEL[g]} on={gender === g} onPress={() => setGender(g)} />)}
      </Row>
      <Field label="Name" value={name} onChangeText={setName} maxLength={DISPLAY_NAME_MAX} />
      <Field label="Bio" value={bio} onChangeText={setBio} maxLength={BIO_MAX} multiline help={`${bio.length}/${BIO_MAX}`} inputStyle={{ minHeight: 90 }} />
      <Touch onPress={() => setBday((b) => !b)} accessibilityRole="switch" accessibilityState={{ checked: bday }}
        style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 6 }}>
        <View style={{ width: 22, height: 22, borderWidth: 2, borderColor: c.ink, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
          {bday && <View style={{ width: 12, height: 12, backgroundColor: c.ink }} />}
        </View>
        <Text style={{ flex: 1 }}>Show “birthday today” by my name on my birthday (never the year).</Text>
      </Touch>
      <ErrorNote message={err} />
      <Row style={{ justifyContent: 'flex-end' }}>
        <Btn label="Cancel" onPress={() => router.back()} />
        <Btn kind="primary" label={busy ? 'Saving…' : 'Save'} busy={busy} disabled={!name.trim()} onPress={() => void save()} />
      </Row>
      <Text v="meta">Interests, your headline and the rest of your portfolio: <LinkText small label="edit them on the website" onPress={() => void openSite(`/u/${me.handle}`)} />.</Text>
    </Screen>
  );
}
