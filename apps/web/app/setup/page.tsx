'use client';
/**
 * Setup (RFC §10.3): compulsory, once, right after joining (and on the next visit for everyone
 * who joined before it existed). About you (50–300 words, it becomes the portfolio's About),
 * gender (it only shapes your face; a live preview redraws as you pick), birthday, and contact
 * details only admins ever see (RFC §10.7; members set up earlier come back once for those). Under 13,
 * the app asks "is that right?" and then the account is closed. Until this is done, every other
 * page sends you here (and the API answers setup_required).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import {
  ABOUT_MAX_WORDS, ABOUT_MIN_WORDS, GENDERS, GENDER_LABEL, MAX_AGE, MIN_AGE, PF_ABOUT_MAX,
  ageOn, countWords, localToday, parseIsoDate, type Gender,
} from '@anti/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useMe, useTitle } from '@/lib/hooks';
import { ErrorNote } from '@/components/ui';
import { AlertDialog, Loading, Win } from '@/components/retro';
import { Avatar } from '@/components/Avatar';
import { HouseRules, markWelcomed } from '@/components/Welcome';

/** Three questions that get fifty words out of anyone. */
const ABOUT_PROMPTS = ['What do you make or do?', 'What do you like, outside of that?', 'Why did you come here?'];

const pad = (n: number) => String(n).padStart(2, '0');

export default function SetupPage() {
  useTitle('Set up your profile');
  const router = useRouter();
  const { me, loading, error } = useMe();
  const [about, setAbout] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [birthday, setBirthday] = useState('');
  const [filled, setFilled] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (loading || closed) return;
    if (!me) { router.replace('/login'); return; }
    if (!me.setupNeeded) { router.replace('/'); return; }
    if (filled) return;
    api.setupState().then((s) => {
      setAbout(s.about);
      if (s.gender) setGender(s.gender);
      if (s.birthday) setBirthday(s.birthday);
      setPhone(s.phone); setEmail(s.email); setDone(s.done);
      setFilled(true);
    }, (e) => setErr(errorMessage(e)));
  }, [loading, me, router, closed, filled]);

  if (closed) {
    return (
      <div className="stack">
        <h1>Account closed</h1>
        <Win title="closed.txt" bodyClassName="stack">
          <p>You have to be {MIN_AGE} or older to be here, so your account is closed. Nothing you typed on this page was kept.</p>
          <p>When you are {MIN_AGE}, anyone inside can invite you again.</p>
          <div className="row"><Link className="btn" href="/">OK</Link></div>
        </Win>
      </div>
    );
  }
  if (loading || !me || !me.setupNeeded) return error ? <ErrorNote message={errorMessage(error)} /> : <Loading />;

  const words = countWords(about);
  const aboutOk = words >= ABOUT_MIN_WORDS && words <= ABOUT_MAX_WORDS && about.trim().length <= PF_ABOUT_MAX;
  const today = localToday();
  const todayIso = `${today.y}-${pad(today.m)}-${pad(today.d)}`;
  const age = parseIsoDate(birthday) ? ageOn(birthday, today) : null;
  const birthdayOk = age !== null && age >= 0 && age <= MAX_AGE;
  const askContact = me.contactEnabled;
  const phoneDigits = phone.replace(/\D/g, '').length;
  const phoneOk = /^\+?[\d\s().-]+$/.test(phone.trim()) && phoneDigits >= 7 && phoneDigits <= 15;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const canSubmit = aboutOk && !!gender && birthdayOk && (!askContact || (phoneOk && emailOk)) && !busy;

  async function submit(confirmUnderage = false) {
    if (!gender) return;
    setAsking(false); setBusy(true); setErr(null);
    try {
      const r = await api.setup({ about, gender, birthday, confirmUnderage, ...(askContact ? { phone, email } : {}) });
      if ('closed' in r) { setClosed(true); return; }
      if (me) markWelcomed(me.handle); // the rules were on this page: no welcome window on top of them
      router.replace('/');
      router.refresh();
    } catch (e) {
      // the server counts age on its own (UTC) date: if it disagrees with this device, ask
      if (e instanceof ApiError && e.error === 'underage') setAsking(true);
      else setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (!done && age !== null && age < MIN_AGE) setAsking(true);
    else void submit();
  }

  async function signOut() {
    try { await api.logout(); } finally { router.replace('/'); router.refresh(); }
  }

  const left = ABOUT_MIN_WORDS - words;
  return (
    <div className="stack setup">
      <h1>Set up your profile</h1>
      <Win title="setup.app" bodyClassName="stack">
        <p>{done
          ? 'One new thing: contact details for the admins. The rest is already filled in from before.'
          : askContact ? 'Four things before you go in. Everyone does this once.' : 'Three things before you go in. Everyone does this once.'}</p>
        <form className="stack" onSubmit={onSubmit}>
          <section className="setup-sec stack" aria-labelledby="su-about">
            <h2 id="su-about"><span className="ui">1.</span> About you</h2>
            <p className="muted small">
              A few sentences, in your own words. It becomes the About on your profile, every member can read it, and you can
              change it later. Three questions that usually do it:
            </p>
            <ol className="about-prompts">
              {ABOUT_PROMPTS.map((p) => <li key={p}>{p}</li>)}
            </ol>
            <label htmlFor="su-about-text" className="sr-only">About you</label>
            <textarea id="su-about-text" rows={8} value={about} maxLength={PF_ABOUT_MAX} placeholder="I make… I like… I came here because…"
              onChange={(e) => setAbout(e.target.value)} aria-describedby="su-count" />
            <p id="su-count" className={`counter${words > ABOUT_MAX_WORDS ? ' over' : ''}`} aria-live="polite">
              {words === 0 ? `About ${ABOUT_MIN_WORDS} words, three or four sentences`
                : left > 0 ? `${words} words · about ${left} more`
                : words > ABOUT_MAX_WORDS ? `${words} words · ${words - ABOUT_MAX_WORDS} over the ${ABOUT_MAX_WORDS} limit`
                : `${words} words · that will do`}
            </p>
          </section>

          <section className="setup-sec stack" aria-labelledby="su-gender">
            <h2 id="su-gender"><span className="ui">2.</span> Gender</h2>
            <div className="you">
              <div className="you-face">
                <Avatar seed={me.handle} gender={gender} size={104} label={`Your face${gender ? `, drawn as ${GENDER_LABEL[gender].toLowerCase()}` : ''}`} />
                <p className="meta">{gender ? 'This is you.' : 'Pick one to see your face.'}</p>
              </div>
              <fieldset className="setup-choices grow">
                <legend className="sr-only">Gender</legend>
                {GENDERS.map((g) => (
                  <label key={g} className="check setup-choice">
                    <input type="radio" name="gender" value={g} checked={gender === g} onChange={() => setGender(g)} />
                    <span>{GENDER_LABEL[g]}</span>
                  </label>
                ))}
                <p className="muted small">It only shapes your face. It is never shown as text. You can change it any time in Settings.</p>
              </fieldset>
            </div>
          </section>

          <section className="setup-sec stack" aria-labelledby="su-bday">
            <h2 id="su-bday"><span className="ui">3.</span> Birthday</h2>
            <label>Your birthday
              <input type="date" value={birthday} min="1900-01-01" max={todayIso} required disabled={done} onChange={(e) => setBirthday(e.target.value)} />
            </label>
            <p className="muted small">
              On your day, members see a &ldquo;birthday today&rdquo; tag by your name: never your age or the year (you can turn the tag off in
              Settings). You can&apos;t change your birthday later, so check it.
            </p>
            {birthday && !birthdayOk && <p className="error" role="alert">{age !== null && age < 0 ? 'That date is in the future.' : 'Check the year.'}</p>}
          </section>

          {askContact && (
            <section className="setup-sec stack" aria-labelledby="su-contact">
              <h2 id="su-contact"><span className="ui">4.</span> Contact details</h2>
              <p className="muted small">
                Only the admins ever see these, never members. They use them to check that everyone here is a real person
                (that is the verified badge) and to reach you about your seat. They are stored encrypted, and every time
                an admin opens them it is recorded. You can change them in Settings.
              </p>
              <div className="row two">
                <label>Cell phone
                  <input type="tel" inputMode="tel" autoComplete="tel" value={phone} maxLength={30} placeholder="+977 980 000 0000" required onChange={(e) => setPhone(e.target.value)} />
                </label>
                <label>Email
                  <input type="email" autoComplete="email" value={email} maxLength={254} placeholder="you@example.com" required onChange={(e) => setEmail(e.target.value)} />
                </label>
              </div>
              <p className="muted small">Start the number with your country code if you can (+977 for Nepal).</p>
              {phone && !phoneOk && <p className="error" role="alert">A phone number has 7 to 15 digits.</p>}
              {email.trim() && !emailOk && <p className="error" role="alert">That email does not look right.</p>}
            </section>
          )}

          {!done && (
            <section className="setup-sec stack" aria-labelledby="su-rules">
              <h2 id="su-rules">Three things keep your seat</h2>
              <HouseRules />
            </section>
          )}

          <ErrorNote message={err} />
          <div className="row between">
            <button type="button" className="btn" onClick={() => void signOut()}>Sign out</button>
            <button className="btn primary" disabled={!canSubmit}>{busy ? 'Saving...' : done ? 'Done' : 'Done, take me in'}</button>
          </div>
        </form>
      </Win>
      <AlertDialog
        open={asking}
        title="Check your birthday"
        message={<>That birthday makes you <strong>{age ?? '?'}</strong>. Is that right? You have to be {MIN_AGE} or older to be here: if it is right, your account will be closed.</>}
        confirmLabel="Yes, close my account"
        cancelLabel="Let me fix it"
        danger
        focusCancel
        onConfirm={() => void submit(true)}
        onCancel={() => setAsking(false)}
      />
    </div>
  );
}
