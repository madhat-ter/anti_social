'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { DISPLAY_NAME_MAX } from '@anti/shared';
import { api, errorMessage, type InviteInfo, type Me, type PasskeyInfo } from '@/lib/api';
import { fmtDate, useMe } from '@/lib/hooks';
import { CopyButton, ErrorNote } from '@/components/ui';

export default function Settings() {
  const router = useRouter();
  const { me, loading, error, setMe } = useMe();

  if (loading) return <p className="muted">Loading...</p>;
  if (error) return <ErrorNote message={errorMessage(error)} />;
  if (!me) return <p>Please <Link href="/login">sign in</Link>.</p>;
  const seated = me.state === 'active' || me.state === 'flagged_lurker';

  return (
    <div className="stack">
      <div className="row"><Link href="/">Back</Link></div>
      <h1>Settings</h1>
      <Profile me={me} onSaved={setMe} />
      <Passkeys />
      {seated && <Invites />}
      <Danger me={me} onGone={() => { router.push('/'); router.refresh(); }} />
    </div>
  );
}

function Profile({ me, onSaved }: { me: Me; onSaved: (m: Me) => void }) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="card stack" onSubmit={async (e) => {
      e.preventDefault(); setErr(null); setMsg(null);
      try { onSaved(await api.updateMe({ displayName: displayName.trim(), bio })); setMsg('Saved.'); }
      catch (x) { setErr(errorMessage(x)); }
    }}>
      <h2>Profile</h2>
      <p className="muted">@{me.handle} (permanent)</p>
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
    <section className="card stack" aria-labelledby="pk">
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
    <section className="card stack" aria-labelledby="inv">
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

function Danger({ me, onGone }: { me: Me; onGone: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="card stack" aria-labelledby="dz">
      <h2 id="dz">Account</h2>
      <div className="row">
        <button className="btn" onClick={async () => { try { await api.logout(); } catch { /* ignore */ } onGone(); }}>Sign out</button>
      </div>
      <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--line)' }} />
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
