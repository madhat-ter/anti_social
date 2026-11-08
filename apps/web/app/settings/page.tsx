'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { DISPLAY_NAME_MAX } from '@anti/shared';
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

  if (loading) return <Loading />;
  if (error) return <ErrorNote message={errorMessage(error)} />;
  if (!me) return <p>Please <Link href="/login">sign in</Link>.</p>;
  const seated = me.state === 'active' || me.state === 'flagged_lurker';

  return (
    <div className="stack">
      <div className="row"><Link href="/" className="ui">Back to the feed</Link></div>
      <h1>Settings</h1>
      <Win title="Control panel" className="panel" bodyClassName="panel-body">
        <Profile me={me} onSaved={setMe} />
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
        <Avatar seed={me.handle} size={56} />
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
