'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, type FlagItem, type Me } from '@/lib/api';
import { fmtDate, relativeTime, useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { CopyButton, ErrorNote } from '@/components/ui';
import { AlertDialog, Loading, Win } from '@/components/retro';

/** Moderators only (role 'ops'): invite codes, the report queue, bans. Members see "Not found". */
export default function AdminPage() {
  useTitle('Admin');
  return <SeatedShell>{(me) => <Admin me={me} />}</SeatedShell>;
}

function Admin({ me }: { me: Me }) {
  if (me.role !== 'ops') return <p className="muted">Not found.</p>;
  return (
    <>
      <h1>Admin</h1>
      <Win title="Moderator panel" className="panel" bodyClassName="panel-body">
        <Invites />
        <Reports />
        <Ban />
      </Win>
    </>
  );
}

function Invites() {
  const [count, setCount] = useState(1);
  const [codes, setCodes] = useState<{ code: string; expiresAt: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true); setErr(null);
    try { setCodes(await api.opsInvites(count)); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <section className="panel-sec" aria-labelledby="adm-inv">
      <h2 id="adm-inv">Invite codes</h2>
      <p className="muted">Founder invites: no limit, nobody is listed as the inviter. Each code works once and expires in 7 days.</p>
      <div className="row">
        <label className="row">How many
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button type="button" className="btn primary" onClick={create} disabled={busy}>{busy ? 'Creating...' : 'Create'}</button>
      </div>
      {codes.length > 0 && (
        <div className="stack" role="status">
          <p className="muted">Copy them now. They are shown only once. Expire {fmtDate(codes[0].expiresAt)}.</p>
          <ul className="list">
            {codes.map((c) => (
              <li key={c.code}><span className="code">{c.code}</span><CopyButton text={c.code} /></li>
            ))}
          </ul>
          {codes.length > 1 && <div className="row"><CopyButton text={codes.map((c) => c.code).join('\n')} label="Copy all" /></div>}
        </div>
      )}
      <ErrorNote message={err} />
    </section>
  );
}

type Ask = { item: FlagItem; resolution: 'restored' | 'removed' } | null;

function Reports() {
  const [items, setItems] = useState<FlagItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask>(null);

  const load = useCallback(async () => {
    setErr(null);
    try { setItems(await api.opsFlags()); } catch (e) { setErr(errorMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function resolve(a: NonNullable<Ask>) {
    setAsk(null); setErr(null);
    try {
      if (a.item.kind === 'post') await api.opsResolvePost(a.item.postId!, a.resolution);
      else await api.opsResolveProject(a.item.projectId!, a.resolution);
      await load();
    } catch (e) { setErr(errorMessage(e)); }
  }

  const link = (f: FlagItem) => f.kind === 'post'
    ? `/p/${f.postId}`
    : f.author ? `/u/${f.author}/work/${f.projectId}` : null;

  return (
    <section className="panel-sec" aria-labelledby="adm-rep">
      <div className="row between">
        <h2 id="adm-rep">Reports</h2>
        <button type="button" className="btn" onClick={() => void load()}>Refresh</button>
      </div>
      <p className="muted">Posts and projects members reported. Five reports hide one automatically until you decide.</p>
      <ErrorNote message={err} />
      {items === null ? <Loading /> : items.length === 0 ? <p className="muted">No open reports.</p> : (
        <ul className="list adm-reports">
          {items.map((f) => {
            const href = link(f);
            return (
              <li key={f.postId ?? f.projectId} className="stack">
                <span>
                  <strong>{f.kind === 'post' ? 'Post' : 'Project'}</strong>
                  {' by '}{f.author ? <Link href={`/u/${f.author}`}>@{f.author}</Link> : 'a deleted member'}
                  {' · '}{f.flags} report{f.flags === 1 ? '' : 's'}
                  {' · '}<time dateTime={f.firstFlaggedAt} title={fmtDate(f.firstFlaggedAt)}>{relativeTime(f.firstFlaggedAt)}</time>
                  {f.hidden && <> · <strong>hidden</strong></>}
                </span>
                <span className="adm-body">{f.body || <em className="muted">(no text)</em>}</span>
                {f.reasons.length > 0 && (
                  <ul className="muted small">{f.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                )}
                <div className="row">
                  {href && <Link className="btn" href={href}>Open</Link>}
                  <button type="button" className="btn" onClick={() => setAsk({ item: f, resolution: 'restored' })}>
                    {f.hidden ? 'Restore' : 'Keep it'}
                  </button>
                  <button type="button" className="btn danger" onClick={() => setAsk({ item: f, resolution: 'removed' })}>Remove</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <AlertDialog
        open={ask?.resolution === 'restored'}
        title="Keep it"
        message="Close these reports and keep it visible?"
        confirmLabel="Keep it"
        onConfirm={() => ask && void resolve(ask)}
        onCancel={() => setAsk(null)}
      />
      <AlertDialog
        open={ask?.resolution === 'removed'}
        title="Remove"
        message={<>Remove this {ask?.item.kind ?? 'post'}? Its author is told it was removed after reports. <strong>This cannot be undone.</strong></>}
        confirmLabel="Remove"
        danger
        onConfirm={() => ask && void resolve(ask)}
        onCancel={() => setAsk(null)}
      />
    </section>
  );
}

function Ban() {
  const [handle, setHandle] = useState('');
  const [ask, setAsk] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const clean = handle.trim().replace(/^@/, '');

  async function ban() {
    setAsk(false); setErr(null); setMsg(null);
    try { await api.opsBan(clean); setMsg(`@${clean} is banned.`); setHandle(''); } catch (e) { setErr(errorMessage(e)); }
  }

  return (
    <section className="panel-sec" aria-labelledby="adm-ban">
      <h2 id="adm-ban">Ban a member</h2>
      <p className="muted">Signs them out everywhere, frees their seat, and pauses invites for whoever invited them for 30 days.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (clean) setAsk(true); }}>
        <input aria-label="Handle to ban" placeholder="@handle" value={handle} onChange={(e) => setHandle(e.target.value)} />
        <button className="btn danger" disabled={!clean}>Ban</button>
      </form>
      {msg && <p role="status" className="muted">{msg}</p>}
      <ErrorNote message={err} />
      <AlertDialog
        open={ask}
        title="Ban member"
        message={<>Ban <strong>@{clean}</strong>? <strong>This cannot be undone</strong> from the site.</>}
        confirmLabel="Ban"
        danger
        onConfirm={() => void ban()}
        onCancel={() => setAsk(false)}
      />
    </section>
  );
}
