'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { DISPLAY_NAME_MAX, GENDERS, GENDER_LABEL, INTERESTS_MAX, type Gender } from '@anti/shared';
import { InterestPicker } from '@/components/Interests';
import { VerifiedBadge } from '@/components/Marks';
import { api, errorMessage, formatMoney, type InviteInfo, type Me, type PasskeyInfo, type PaymentRecord } from '@/lib/api';
import { fmtDate, useMe, useTitle } from '@/lib/hooks';
import { CopyButton, ErrorNote } from '@/components/ui';
import { PayButton } from '@/components/Billing';
import { PushToggle } from '@/components/PushToggle';
import { Loading, Win } from '@/components/retro';
import { Avatar } from '@/components/Avatar';

export default function Settings() {
  useTitle('Settings');
  const router = useRouter();
  const { me, loading, error, setMe } = useMe();
  useEffect(() => { if (me?.setupNeeded) router.replace('/setup'); }, [me, router]);

  if (loading) return <Loading />;
  if (error) return <ErrorNote message={errorMessage(error)} />;
  if (!me) return <p>Please <Link href="/login">sign in</Link>.</p>;
  if (me.setupNeeded) return <Loading what="Redirecting" />;
  const seated = me.state === 'active' || me.state === 'flagged_lurker';

  return (
    <div className="stack">
      <div className="row"><Link href="/" className="ui">Back to the feed</Link></div>
      <h1>Settings</h1>
      <Win title="Control panel" className="panel" bodyClassName="panel-body">
        <Profile me={me} onSaved={setMe} />
        <Face me={me} onSaved={setMe} />
        <BirthdaySec me={me} onSaved={setMe} />
        <InterestsSec me={me} onSaved={setMe} />
        <ContactSec me={me} onSaved={setMe} />
        <Passkeys />
        <PushToggle />
        {seated && <Invites />}
        <Payments me={me} seated={seated} />
        <Danger me={me} onGone={() => { router.push('/'); router.refresh(); }} />
      </Win>
    </div>
  );
}

function Profile({ me, onSaved }: { me: Me; onSaved: (m: Me) => void }) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="panel-sec" onSubmit={async (e) => {
      e.preventDefault(); setErr(null); setMsg(null);
      try { onSaved(await api.updateMe({ displayName: displayName.trim(), bio })); setMsg('Saved.'); }
      catch (x) { setErr(errorMessage(x)); }
    }}>
      <h2>Profile</h2>
      <div className="row">
        <Avatar seed={me.handle} gender={me.gender} size={56} />
        {me.role === 'ops' ? (
          <p className="muted">
            Your handle is <strong className="ui">@{me.handle}</strong>. As an admin you can change it (anyone&apos;s, in fact)
            under <Link href="/admin#members">Admin → Members</Link>. The face is drawn from the handle, so it changes with it.
          </p>
        ) : (
          <p className="muted">Your handle <strong className="ui">@{me.handle}</strong> is permanent, and so is the face that comes with it.</p>
        )}
      </div>
      <label>Display name
        <input value={displayName} maxLength={DISPLAY_NAME_MAX} onChange={(e) => setDisplayName(e.target.value)} required />
      </label>
      <label>Bio ({bio.length}/160)
        <textarea value={bio} maxLength={160} onChange={(e) => setBio(e.target.value)} />
      </label>
      <ErrorNote message={err} />
      {msg && <p role="status" className="muted">{msg}</p>}
      <div className="row"><button className="btn primary">Save</button></div>
    </form>
  );
}

/** Gender only shapes your face (RFC §10.3); it can change any time and the face redraws at once. */
function Face({ me, onSaved }: { me: Me; onSaved: (m: Me) => void }) {
  // the choice shows at once; the face and everything else follow when the save lands
  const [chosen, setChosen] = useState<Gender | null>(me.gender);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function pick(g: Gender) {
    if (g === chosen) return;
    const before = chosen;
    setChosen(g); setErr(null); setMsg(null);
    try { onSaved(await api.updateMe({ gender: g })); setMsg('Saved. Your face is redrawn everywhere.'); }
    catch (e) { setChosen(before); setErr(errorMessage(e)); }
  }
  return (
    <section className="panel-sec" aria-labelledby="face">
      <h2 id="face">Your face</h2>
      <div className="you">
        <div className="you-face"><Avatar seed={me.handle} gender={chosen} size={88} label="Your face" /></div>
        <fieldset className="setup-choices grow">
          <legend className="ui">Gender</legend>
          {GENDERS.map((g) => (
            <label key={g} className="check setup-choice">
              <input type="radio" name="settings-gender" value={g} checked={chosen === g} onChange={() => void pick(g)} />
              <span>{GENDER_LABEL[g]}</span>
            </label>
          ))}
          <p className="muted small">It only shapes your face; it is never shown as text.</p>
        </fieldset>
      </div>
      {msg && <p role="status" className="muted">{msg}</p>}
      <ErrorNote message={err} />
    </section>
  );
}

/** Your birthday (members can't change it; admins can) and whether the "birthday today" tag shows. */
function BirthdaySec({ me, onSaved }: { me: Me; onSaved: (m: Me) => void }) {
  const [shown, setShown] = useState(me.birthdayPublic);
  const [err, setErr] = useState<string | null>(null);
  async function toggle(v: boolean) {
    setShown(v); setErr(null);
    try { onSaved(await api.updateMe({ birthdayPublic: v })); } catch (e) { setShown(!v); setErr(errorMessage(e)); }
  }
  const pretty = me.birthday
    ? new Date(`${me.birthday}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : 'Not set';
  return (
    <section className="panel-sec" aria-labelledby="bday">
      <h2 id="bday">Birthday</h2>
      <p><strong>{pretty}</strong> <span className="muted small">Only an admin can change it.</span></p>
      <label className="check">
        <input type="checkbox" checked={shown} onChange={(e) => void toggle(e.target.checked)} />
        Show a &ldquo;birthday today&rdquo; tag by my name on my day
      </label>
      <p className="muted small">Members never see your age or the year.</p>
      <ErrorNote message={err} />
    </section>
  );
}

/** Interests (RFC §10.5): up to 10; collabs and events with the same tags find you. Saved as you tap. */
function InterestsSec({ me, onSaved }: { me: Me; onSaved: (m: Me) => void }) {
  const [picked, setPicked] = useState<string[]>(me.interests);
  const [err, setErr] = useState<string | null>(null);
  async function change(next: string[]) {
    const before = picked;
    setPicked(next); setErr(null);
    try { const r = await api.setInterests(next); setPicked(r.interests); onSaved({ ...me, interests: r.interests }); }
    catch (e) { setPicked(before); setErr(errorMessage(e)); }
  }
  return (
    <section className="panel-sec" aria-labelledby="interests">
      <h2 id="interests">Interests</h2>
      <p className="muted small">Pick up to {INTERESTS_MAX} ({picked.length} now). Collabs and events with the same interests find you, and you find them.</p>
      <InterestPicker value={picked} onChange={(n) => void change(n)} max={INTERESTS_MAX} />
      <ErrorNote message={err} />
    </section>
  );
}

function Passkeys() {
  const [list, setList] = useState<PasskeyInfo[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const load = useCallback(async () => {
    try { setList(await api.passkeys()); } catch (e) { setErr(errorMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function add() {
    setErr(null);
    try {
      const ch = await api.passkeyOptions();
      const response = await startRegistration({ optionsJSON: ch.options as any });
      await api.passkeyVerify({ challengeId: ch.challengeId, response, deviceLabel: label.trim() || undefined });
      setLabel(''); await load();
    } catch (e) { setErr(errorMessage(e)); }
  }
  async function remove(id: string) {
    setErr(null);
    try { await api.deletePasskey(id); await load(); } catch (e) { setErr(errorMessage(e)); }
  }

  return (
    <section className="panel-sec" aria-labelledby="pk">
      <h2 id="pk">Passkeys</h2>
      <ul className="list">
        {list.map((p) => (
          <li key={p.id}>
            <span>{p.deviceLabel || 'Passkey'}<br /><small className="muted">Added {fmtDate(p.createdAt)}{p.lastUsedAt ? `, last used ${fmtDate(p.lastUsedAt)}` : ''}</small></span>
            <button className="btn danger" onClick={() => remove(p.id)} disabled={list.length <= 1}>Remove</button>
          </li>
        ))}
      </ul>
      <div className="row">
        <input aria-label="Device label" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="btn" onClick={add}>Add passkey</button>
      </div>
      <ErrorNote message={err} />
    </section>
  );
}

function Invites() {
  const [list, setList] = useState<InviteInfo[]>([]);
  const [fresh, setFresh] = useState<{ code: string; expiresAt: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setList(await api.invites()); } catch (e) { setErr(errorMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    setErr(null);
    try { setFresh(await api.createInvite()); await load(); } catch (e) { setErr(errorMessage(e)); }
  }

  return (
    <section className="panel-sec" aria-labelledby="inv">
      <h2 id="inv">Invites</h2>
      {fresh && (
        <div className="stack" role="status">
          <p className="muted">Copy this code now. It is shown only once. Expires {fmtDate(fresh.expiresAt)}.</p>
          <p className="code">{fresh.code}</p>
          <div className="row"><CopyButton text={fresh.code} /><button className="btn" onClick={() => setFresh(null)}>Hide</button></div>
        </div>
      )}
      <div className="row"><button className="btn primary" onClick={create}>Create invite</button></div>
      <ErrorNote message={err} />
      {list.length === 0 ? <p className="muted">No invites yet.</p> : (
        <ul className="list">
          {list.map((i, n) => (
            <li key={n}>
              <span>Created {fmtDate(i.createdAt)}<br /><small className="muted">
                {i.status === 'redeemed' ? `Used by @${i.redeemedBy?.handle ?? 'unknown'}` : i.status === 'open' ? `Expires ${fmtDate(i.expiresAt)}` : i.status}
              </small></span>
              <span className="muted">{i.status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const PRODUCT_LABEL: Record<string, string> = { stay_fee_90d: 'Stay fee (90 days)', reinstatement: 'Reinstatement' };
const STATUS_LABEL: Record<string, string> = { paid: 'Paid', refund_pending: 'Refund in progress', refunded: 'Refunded' };

function Payments({ me, seated }: { me: Me; seated: boolean }) {
  const [list, setList] = useState<PaymentRecord[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.myPayments().then(setList, (e) => setErr(errorMessage(e))); }, []);
  const exempt = me.lurkerExemptUntil && new Date(me.lurkerExemptUntil).getTime() > Date.now() ? me.lurkerExemptUntil : null;
  return (
    <section className="panel-sec" aria-labelledby="pay">
      <h2 id="pay">Payments</h2>
      {seated && (
        exempt
          ? <p>You are exempt from the posting rule until {fmtDate(exempt)}. You still need to sign in at least once every 30 days.</p>
          : <>
              <p className="muted">Not a big poster? The stay fee exempts you from the posting rule for 90 days. It does not cover the 30-day sign-in rule.</p>
              <div className="row"><PayButton productKey="stay_fee_90d" label="Pay stay fee" /></div>
            </>
      )}
      <ErrorNote message={err} />
      {list && (list.length === 0 ? <p className="muted">No payments yet.</p> : (
        <ul className="list">
          {list.map((p) => (
            <li key={p.id}>
              <span>{PRODUCT_LABEL[p.productKey] ?? p.productKey}<br /><small className="muted">
                {fmtDate(p.paidAt ?? p.createdAt)}{p.refundedAt ? `, refunded ${fmtDate(p.refundedAt)}` : ''}
              </small></span>
              <span className="muted">{formatMoney(p.amountMinor, p.currency)}, {(STATUS_LABEL[p.status] ?? p.status).toLowerCase()}</span>
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
}

function Danger({ me, onGone }: { me: Me; onGone: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="panel-sec danger-zone" aria-labelledby="dz">
      <h2 id="dz">Account</h2>
      <div className="row">
        <button className="btn" onClick={async () => { try { await api.logout(); } catch { /* ignore */ } onGone(); }}>Sign out</button>
      </div>
            <h3>Delete account</h3>
      <p className="muted">This is permanent. Type <strong>{me.handle}</strong> to confirm.</p>
      <input aria-label="Type your handle to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
      <ErrorNote message={err} />
      <div className="row">
        <button className="btn danger" disabled={confirm !== me.handle} onClick={async () => {
          try { await api.deleteMe(); onGone(); } catch (e) { setErr(errorMessage(e)); }
        }}>Delete my account</button>
      </div>
    </section>
  );
}

/** RFC §10.7: your contact details (only admins see them) and whether an admin has verified you. */
function ContactSec({ me, onSaved }: { me: Me; onSaved: (m: Me) => void }) {
  const [phone, setPhone] = useState(me.contact?.phone ?? '');
  const [email, setEmail] = useState(me.contact?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!me.contactEnabled) return null;
  const changed = phone !== (me.contact?.phone ?? '') || email !== (me.contact?.email ?? '');
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null); setSaved(false);
    try { const m = await api.setContact({ phone, email }); onSaved(m); setPhone(m.contact?.phone ?? ''); setEmail(m.contact?.email ?? ''); setSaved(true); }
    catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  }
  return (
    <section className="panel-sec" aria-labelledby="contact">
      <h2 id="contact">Contact details</h2>
      <p className="verified-line">
        {me.verifiedAt
          ? <><VerifiedBadge /> <span>Verified by an admin. The badge shows by your name.</span></>
          : <span className="muted">Not verified yet: an admin checks every member.</span>}
      </p>
      <p className="muted small">Only admins see these, never members. Stored encrypted; every time an admin opens them it is recorded.</p>
      <form className="stack" onSubmit={save}>
        <div className="row two">
          <label>Cell phone<input type="tel" inputMode="tel" autoComplete="tel" value={phone} maxLength={30} onChange={(e) => { setPhone(e.target.value); setSaved(false); }} /></label>
          <label>Email<input type="email" autoComplete="email" value={email} maxLength={254} onChange={(e) => { setEmail(e.target.value); setSaved(false); }} /></label>
        </div>
        <div className="row">
          <button className="btn" disabled={busy || !changed}>{busy ? 'Saving…' : 'Save'}</button>
          {saved && <span className="muted" role="status">Saved.</span>}
        </div>
        <ErrorNote message={err} />
      </form>
    </section>
  );
}