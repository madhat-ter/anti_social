/**
 * Setup (RFC §10.3), once, right after joining: About you, gender (shapes the face only), birthday,
 * and contact details only admins see (§10.7). Under 13 the app asks "is that right?", then the
 * account is closed. As apps/web/app/setup/page.tsx.
 */
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  ABOUT_MAX_WORDS, ABOUT_MIN_WORDS, GENDERS, GENDER_LABEL, MAX_AGE, MIN_AGE, PF_ABOUT_MAX,
  ageOn, countWords, localToday, parseIsoDate, type Gender,
} from '@anti/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { Avatar } from '@/components/Avatar';
import { HouseRules } from '@/components/HouseRules';
import { Screen } from '@/components/Screen';
import { Btn, ErrorNote, Field, Loading, Row, Text, Win } from '@/components/ui';

const ABOUT_PROMPTS = ['What do you make or do?', 'What do you like, outside of that?', 'Why did you come here?'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function Section({ n, title, children }: { n?: string; title: string; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 10, borderTopWidth: 2, borderColor: c.ink, paddingTop: 14 }}>
      <Text v="h2" accessibilityRole="header">{n ? <Text v="ui" style={{ fontSize: 18 }}>{n} </Text> : null}{title}</Text>
      {children}
    </View>
  );
}

export default function Setup() {
  const { me, refreshMe, signOut } = useSession();
  const { c } = useTheme();
  const [about, setAbout] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [birthday, setBirthday] = useState('');
  const [picking, setPicking] = useState(false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [filled, setFilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    api.setupState().then((s) => {
      setAbout(s.about); if (s.gender) setGender(s.gender); if (s.birthday) setBirthday(s.birthday);
      setPhone(s.phone); setEmail(s.email); setDone(s.done); setFilled(true);
    }, (e) => setErr(errorMessage(e)));
  }, []);

  if (closed) {
    return (
      <Screen top>
        <Text v="poster">Account closed</Text>
        <Win title="closed.txt">
          <Text>You have to be {MIN_AGE} or older to be here, so your account is closed. Nothing you typed on this page was kept.</Text>
          <Text>When you are {MIN_AGE}, anyone inside can invite you again.</Text>
          <Row style={{ justifyContent: 'flex-end' }}><Btn label="OK" onPress={() => void api.forget().then(refreshMe)} /></Row>
        </Win>
      </Screen>
    );
  }
  if (!me || !filled) return <Screen top>{err ? <ErrorNote message={err} /> : <Loading />}</Screen>;

  const words = countWords(about);
  const aboutOk = words >= ABOUT_MIN_WORDS && words <= ABOUT_MAX_WORDS && about.trim().length <= PF_ABOUT_MAX;
  const today = localToday();
  const age = parseIsoDate(birthday) ? ageOn(birthday, today) : null;
  const birthdayOk = age !== null && age >= 0 && age <= MAX_AGE;
  const askContact = me.contactEnabled;
  const phoneDigits = phone.replace(/\D/g, '').length;
  const phoneOk = /^\+?[\d\s().-]+$/.test(phone.trim()) && phoneDigits >= 7 && phoneDigits <= 15;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const canSubmit = aboutOk && !!gender && birthdayOk && (!askContact || (phoneOk && emailOk)) && !busy;
  const left = ABOUT_MIN_WORDS - words;

  async function submit(confirmUnderage = false) {
    if (!gender) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.setup({ about, gender, birthday, confirmUnderage, ...(askContact ? { phone, email } : {}) });
      if ('closed' in r) { setClosed(true); return; }
      await refreshMe();
    } catch (e) {
      if (e instanceof ApiError && e.error === 'underage') askAge();
      else setErr(errorMessage(e));
    } finally { setBusy(false); }
  }
  function askAge() {
    Alert.alert(
      'Check your birthday',
      `That birthday makes you ${age ?? '?'}. Is that right? You have to be ${MIN_AGE} or older to be here: if it is right, your account will be closed.`,
      [
        { text: 'Let me fix it', style: 'cancel' },
        { text: 'Yes, close my account', style: 'destructive', onPress: () => void submit(true) },
      ],
    );
  }

  const bdayDate = parseIsoDate(birthday) ? new Date(`${birthday}T12:00:00`) : new Date(2008, 0, 1);

  return (
    <Screen top>
      <Text v="poster" accessibilityRole="header">Set up your profile</Text>
      <Win title="setup.app">
        <Text>{done
          ? 'One new thing: contact details for the admins. The rest is already filled in from before.'
          : askContact ? 'Four things before you go in. Everyone does this once.' : 'Three things before you go in. Everyone does this once.'}</Text>

        <Section n="1." title="About you">
          <Text v="small" muted>A few sentences, in your own words. It becomes the About on your profile, every member can read it, and you can change it later. Three questions that usually do it:</Text>
          {ABOUT_PROMPTS.map((p, i) => <Text key={p} v="small">{i + 1}. {p}</Text>)}
          <Field value={about} onChangeText={setAbout} maxLength={PF_ABOUT_MAX} multiline placeholder="I make… I like… I came here because…" inputStyle={{ minHeight: 170 }} accessibilityLabel="About you" />
          <Text v="ui" style={{ fontSize: 13, color: words > ABOUT_MAX_WORDS ? c.signalText : c.grayStrong }} accessibilityLiveRegion="polite">
            {words === 0 ? `About ${ABOUT_MIN_WORDS} words, three or four sentences`
              : left > 0 ? `${words} words · about ${left} more`
              : words > ABOUT_MAX_WORDS ? `${words} words · ${words - ABOUT_MAX_WORDS} over the ${ABOUT_MAX_WORDS} limit`
              : `${words} words · that will do`}
          </Text>
        </Section>

        <Section n="2." title="Gender">
          <Row style={{ alignItems: 'flex-start' }} gap={14}>
            <View style={{ alignItems: 'center', gap: 6, width: 108 }}>
              <Avatar seed={me.handle} gender={gender} size={104} label={`Your face${gender ? `, drawn as ${GENDER_LABEL[gender].toLowerCase()}` : ''}`} />
              <Text v="meta" style={{ textAlign: 'center', fontSize: 12 }}>{gender ? 'This is you.' : 'Pick one to see your face.'}</Text>
            </View>
            <View style={{ flex: 1, gap: 8 }} accessibilityRole="radiogroup">
              {GENDERS.map((g) => (
                <Pressable key={g} onPress={() => setGender(g)} accessibilityRole="radio" accessibilityState={{ checked: gender === g }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
                    {gender === g && <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.ink }} />}
                  </View>
                  <Text>{GENDER_LABEL[g]}</Text>
                </Pressable>
              ))}
              <Text v="small" muted>It only shapes your face. It is never shown as text. You can change it any time on your profile.</Text>
            </View>
          </Row>
        </Section>

        <Section n="3." title="Birthday">
          <Btn
            label={birthday ? new Date(`${birthday}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Choose your birthday'}
            disabled={done} onPress={() => setPicking(true)}
          />
          {(picking || (Platform.OS === 'ios' && picking)) && (
            <DateTimePicker
              value={bdayDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              maximumDate={new Date()} minimumDate={new Date(1900, 0, 1)}
              onChange={(e, d) => {
                if (Platform.OS !== 'ios') setPicking(false);
                if (e.type === 'set' || Platform.OS === 'ios') { if (d) setBirthday(iso(d)); }
                if (e.type === 'dismissed') setPicking(false);
              }}
            />
          )}
          {Platform.OS === 'ios' && picking && <Btn small label="Done" onPress={() => setPicking(false)} style={{ alignSelf: 'flex-end' }} />}
          <Text v="small" muted>On your day, members see a &ldquo;birthday today&rdquo; tag by your name: never your age or the year (you can turn the tag off on your profile). You can&apos;t change your birthday later, so check it.</Text>
          {birthday && !birthdayOk ? <ErrorNote message={age !== null && age < 0 ? 'That date is in the future.' : 'Check the year.'} /> : null}
        </Section>

        {askContact && (
          <Section n="4." title="Contact details">
            <Text v="small" muted>Only the admins ever see these, never members. They use them to check that everyone here is a real person (that is the verified badge) and to reach you about your seat. They are stored encrypted, and every time an admin opens them it is recorded. You can change them in Settings.</Text>
            <Field label="Cell phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel" maxLength={30} placeholder="+977 980 000 0000" />
            <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" autoCapitalize="none" maxLength={254} placeholder="you@example.com" />
            <Text v="small" muted>Start the number with your country code if you can (+977 for Nepal).</Text>
            {phone && !phoneOk ? <ErrorNote message="A phone number has 7 to 15 digits." /> : null}
            {email.trim() && !emailOk ? <ErrorNote message="That email does not look right." /> : null}
          </Section>
        )}

        {!done && (
          <Section title="Three things keep your seat">
            <HouseRules />
          </Section>
        )}

        <ErrorNote message={err} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Btn label="Sign out" onPress={() => void signOut()} />
          <Btn kind="primary" label={busy ? 'Saving…' : done ? 'Done' : 'Done, take me in'} busy={busy} disabled={!canSubmit}
            onPress={() => { if (!done && age !== null && age < MIN_AGE) askAge(); else void submit(); }} />
        </Row>
      </Win>
    </Screen>
  );
}
