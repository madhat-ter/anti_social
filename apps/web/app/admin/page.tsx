'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage, type AdminInterest, type AdminMember, type AdminSettings, type FlagItem, type Me } from '@/lib/api';
import { fmtDate, relativeTime, useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { CopyButton, ErrorNote } from '@/components/ui';
import { AlertDialog, Loading, Win } from '@/components/retro';
import { Avatar } from '@/components/Avatar';
import { interestsCached } from '@/lib/interests';

/**
 * Admins only (role 'ops'): invite codes, the report queue, everyone in the room (ban, unban,
 * make admin, change handle) and the room's settings. Members see "Not found".
 */
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
        <Members me={me} />
        <Community />
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
      <p className="muted">Founder invites: no limit, nobody is listed as the inviter. Each code works once and lasts as many days as set under Community.</p>
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
      else if (a.item.kind === 'collab') await api.opsResolveCollab(a.item.collabId!, a.resolution);
      else await api.opsResolveProject(a.item.projectId!, a.resolution);
      await load();
    } catch (e) { setErr(errorMessage(e)); }
  }

  const link = (f: FlagItem) => f.kind === 'post'
    ? `/p/${f.postId}`
    : f.kind === 'collab' ? `/collabs/${f.collabId}`
    : f.author ? `/u/${f.author}/work/${f.projectId}` : null;

  return (
    <section className="panel-sec" aria-labelledby="adm-rep">
      <h2 id="adm-rep">Reports</h2>
      <div className="row between adm-rep-head">
        <p className="muted">Posts, projects and collabs members reported. Five reports hide one automatically until you decide.</p>
        <button type="button" className="btn" onClick={() => void load()}>Refresh</button>
      </div>
      <ErrorNote message={err} />
      {items === null ? <Loading /> : items.length === 0 ? <p className="muted">No open reports.</p> : (
        <ul className="adm-reports">
          {items.map((f) => {
            const href = link(f);
            return (
              <li key={f.postId ?? f.projectId ?? f.collabId}>
                <span className="adm-meta">
                  <strong>{f.kind === 'post' ? 'Post' : f.kind === 'collab' ? 'Collab' : 'Project'}</strong>
                  {f.kind === 'collab' ? ' hosted by ' : ' by '}{f.author ? <Link href={`/u/${f.author}`}>@{f.author}</Link> : 'a deleted member'}
                  {' · '}{f.flags} report{f.flags === 1 ? '' : 's'}
                  {' · '}<time dateTime={f.firstFlaggedAt} title={fmtDate(f.firstFlaggedAt)}>{relativeTime(f.firstFlaggedAt)}</time>
                  {f.hidden && <span className="tag">hidden</span>}
                </span>
                <span className="adm-body">{f.body || <em className="muted">(no text)</em>}</span>
                {f.reasons.length > 0 && (
                  <ul className="adm-reasons muted small" aria-label="Reasons given">
                    {f.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
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

const STATE_LABEL: Record<string, string> = {
  waitlisted: 'waiting for a seat', flagged_lurker: 'flagged as quiet', archived: 'archived', banned: 'banned',
};

type MemberAsk = { kind: 'ban' | 'unban' | 'admin' | 'unadmin' | 'rename' | 'birthday'; m: AdminMember } | null;

/** Everyone in the room (and the queue, archived and banned), with what an admin can do to each. */
function Members({ me }: { me: Me }) {
  const [list, setList] = useState<AdminMember[] | null>(null);
  const [q, setQ] = useState('');
  const [ask, setAsk] = useState<MemberAsk>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** a corrected birthday that makes someone under 13: confirm before their account is closed */
  const [underage, setUnderage] = useState<{ m: AdminMember; birthday: string; detail: string } | null>(null);

  const load = useCallback(async () => {
    try { setList(await api.opsMembers()); } catch (e) { setErr(errorMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(a: NonNullable<MemberAsk>, value = '') {
    setAsk(null); setErr(null); setMsg(null);
    const self = a.m.handle === me.handle;
    try {
      if (a.kind === 'ban') {
        await api.opsBan(a.m.handle);
        setMsg(`@${a.m.handle} is banned.`);
      } else if (a.kind === 'unban') {
        const r = await api.opsUnban(a.m.handle);
        setMsg(r.state === 'active' ? `@${r.handle} is back, with a seat.` : `@${r.handle} is unbanned and waits in line for a seat.`);
      } else if (a.kind === 'admin') {
        await api.opsSetRole(a.m.handle, 'ops');
        setMsg(`@${a.m.handle} is now an admin.`);
      } else if (a.kind === 'unadmin') {
        await api.opsSetRole(a.m.handle, 'member');
        if (self) { window.location.assign('/'); return; } // this page is no longer yours
        setMsg(`@${a.m.handle} is no longer an admin.`);
      } else if (a.kind === 'birthday') {
        if (!value) return;
        try {
          const r = await api.opsSetBirthday(a.m.handle, value);
          setMsg(`@${r.handle}'s birthday is corrected (age ${r.age}).`);
        } catch (e) {
          if (e instanceof ApiError && e.error === 'underage') { setUnderage({ m: a.m, birthday: value, detail: e.detail ?? '' }); return; }
          throw e;
        }
      } else {
        if (!value) return;
        const r = await api.opsRename(a.m.handle, value);
        if (self) { window.location.reload(); return; } // your own handle: refresh everything that shows it
        setMsg(r.from === r.handle ? 'Nothing to change.' : `@${r.from} is now @${r.handle}.`);
      }
      await load();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  async function closeUnderage() {
    const u = underage;
    setUnderage(null); setErr(null); setMsg(null);
    if (!u) return;
    try {
      await api.opsSetBirthday(u.m.handle, u.birthday, true);
      setMsg(`@${u.m.handle}'s account is closed: they are under 13.`);
      await load();
    } catch (e) { setErr(errorMessage(e)); }
  }

  const term = q.trim().replace(/^@/, '').toLowerCase();
  const shown = (list ?? []).filter((m) => !term
    || m.handle.toLowerCase().includes(term) || m.displayName.toLowerCase().includes(term) || m.state.includes(term));
  const seated = (m: AdminMember) => m.state === 'active' || m.state === 'flagged_lurker';
  const who = ask ? (ask.m.handle === me.handle ? 'yourself' : `@${ask.m.handle}`) : '';

  return (
    <section className="panel-sec" aria-labelledby="adm-mem" id="members">
      <h2 id="adm-mem">Members</h2>
      <p className="muted">Everyone, including people waiting for a seat, archived and banned. Admins never lose their seat to the activity rules.</p>
      <input type="search" aria-label="Filter members" placeholder="Filter by handle, name or state" value={q} onChange={(e) => setQ(e.target.value)} />
      {msg && <p role="status" className="muted">{msg}</p>}
      <ErrorNote message={err} />
      {list === null ? <Loading /> : shown.length === 0 ? <p className="muted">Nobody matches.</p> : (
        <ul className="adm-members">
          {shown.map((m) => (
            <li key={m.handle}>
              <Avatar seed={m.handle} gender={m.gender} size={40} />
              <span className="adm-member-main">
                <span>
                  {m.state === 'banned' || m.state === 'waitlisted'
                    ? <span className="name">{m.displayName}</span>
                    : <Link href={`/u/${m.handle}`} className="name">{m.displayName}</Link>}
                  {' '}<span className="muted handle">@{m.handle}</span>
                  {m.handle === me.handle && <span className="tag">you</span>}
                  {m.role === 'ops' && <span className="tag">admin</span>}
                  {STATE_LABEL[m.state] && <span className={`tag${m.state === 'banned' ? ' danger' : ''}`}>{STATE_LABEL[m.state]}</span>}
                </span>
                <span className="muted small">
                  Joined {fmtDate(m.joinedAt)}
                  {' · '}{m.lastSeenAt ? `seen ${relativeTime(m.lastSeenAt)}` : 'never seen'}
                  {' · '}{m.postCount} {m.postCount === 1 ? 'post' : 'posts'}
                  {m.age !== null && <> · age {m.age}</>}
                  {m.invitedBy && <> · invited by @{m.invitedBy}</>}
                </span>
              </span>
              <span className="row adm-member-actions">
                <button type="button" className="btn" onClick={() => setAsk({ kind: 'rename', m })}>Change handle</button>
                <button type="button" className="btn" onClick={() => setAsk({ kind: 'birthday', m })}>Change birthday</button>
                {m.state === 'banned' ? (
                  <button type="button" className="btn" onClick={() => setAsk({ kind: 'unban', m })}>Unban</button>
                ) : m.role === 'ops' ? (
                  <button type="button" className="btn" onClick={() => setAsk({ kind: 'unadmin', m })}>Remove admin</button>
                ) : (
                  <>
                    {seated(m) && <button type="button" className="btn" onClick={() => setAsk({ kind: 'admin', m })}>Make admin</button>}
                    <button type="button" className="btn danger" onClick={() => setAsk({ kind: 'ban', m })}>Ban</button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog
        open={ask?.kind === 'ban'}
        title="Ban member"
        message={<>Ban <strong>{who}</strong>? They are signed out everywhere and lose their seat, and whoever invited them can&apos;t invite anyone for 30 days. You can unban them later.</>}
        confirmLabel="Ban"
        danger
        onConfirm={() => ask && void act(ask)}
        onCancel={() => setAsk(null)}
      />
      <AlertDialog
        open={ask?.kind === 'unban'}
        title="Unban member"
        message={<>Unban <strong>{who}</strong>? They can sign in again with their passkey. They get a seat if one is free; otherwise they wait in line.</>}
        confirmLabel="Unban"
        onConfirm={() => ask && void act(ask)}
        onCancel={() => setAsk(null)}
      />
      <AlertDialog
        open={ask?.kind === 'admin'}
        title="Make admin"
        message={<>Make <strong>{who}</strong> an admin? They get this page: invites, reports, removing posts, bans, handles and the room&apos;s settings.</>}
        confirmLabel="Make admin"
        onConfirm={() => ask && void act(ask)}
        onCancel={() => setAsk(null)}
      />
      <AlertDialog
        open={ask?.kind === 'unadmin'}
        title="Remove admin"
        message={ask?.m.handle === me.handle
          ? <>Remove <strong>yourself</strong> as admin? You lose this page. Another admin can give it back.</>
          : <>Remove <strong>{who}</strong> as admin? They lose this page and become a member like everyone else.</>}
        confirmLabel="Remove admin"
        danger
        onConfirm={() => ask && void act(ask)}
        onCancel={() => setAsk(null)}
      />
      <AlertDialog
        open={ask?.kind === 'birthday'}
        title="Change birthday"
        message={<>The right birthday for <strong>{who}</strong>{ask?.m.age !== null && ask?.m.age !== undefined ? <> (now age {ask.m.age})</> : null}. Members never see it; a birthday under 13 closes the account.</>}
        confirmLabel="Change"
        input={{ label: 'New birthday', type: 'date', max: new Date().toISOString().slice(0, 10) }}
        onConfirm={(v) => ask && void act(ask, v)}
        onCancel={() => setAsk(null)}
      />
      <AlertDialog
        open={!!underage}
        title="Under 13"
        message={<>{underage?.detail} <strong>This cannot be undone.</strong></>}
        confirmLabel="Close account"
        danger
        focusCancel
        onConfirm={() => void closeUnderage()}
        onCancel={() => setUnderage(null)}
      />
      <AlertDialog
        open={ask?.kind === 'rename'}
        title="Change handle"
        message={<>New handle for <strong>{who}</strong>: 3–20 letters, digits or underscores, starting with a letter. The face is drawn from the handle, so it changes too, and links to the old profile stop working.{ask && ask.m.handle !== me.handle ? ' They are told.' : ''}</>}
        confirmLabel="Change"
        input={{ label: 'New handle', placeholder: ask?.m.handle ?? '', maxLength: 21 }}
        onConfirm={(v) => ask && void act(ask, v)}
        onCancel={() => setAsk(null)}
      />
    </section>
  );
}

/**
 * The interest list (RFC §10.5): admins add tags, and see the ones members added (newest first)
 * to remove anything that should not be there. Removing takes it off every profile, collab, event.
 */
function AddInterest() {
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<AdminInterest[] | null>(null);
  const [ask, setAsk] = useState<AdminInterest | null>(null);
  const load = useCallback(() => api.opsInterests().then((r) => setItems(r.items), (x) => setErr(errorMessage(x))), []);
  useEffect(() => { void load(); }, [load]);
  async function add(e: FormEvent) {
    e.preventDefault(); setErr(null); setMsg(null);
    try { const r = await api.opsAddInterest(label); setMsg(`Added "${r.label}".`); setLabel(''); interestsCached(true).catch(() => {}); void load(); }
    catch (x) { setErr(errorMessage(x)); }
  }
  async function remove(i: AdminInterest) {
    setAsk(null); setErr(null); setMsg(null);
    try { await api.opsRemoveInterest(i.slug); setMsg(`Removed "${i.label}".`); interestsCached(true).catch(() => {}); void load(); }
    catch (x) { setErr(errorMessage(x)); }
  }
  const added = (items ?? []).filter((i) => i.addedBy);
  const uses = (i: AdminInterest) => {
    const parts = [[i.uses.members, 'member'], [i.uses.collabs, 'collab'], [i.uses.events, 'event']] as const;
    const s = parts.filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`).join(', ');
    return s || 'not used yet';
  };
  return (
    <div className="stack">
      <form className="stack" onSubmit={add}>
        <label>Add an interest
          <input value={label} maxLength={30} placeholder="Pottery" onChange={(e) => setLabel(e.target.value)} />
          <small className="muted">Members pick from this list for their profile, collabs and events, and can add missing ones themselves (5 a day).</small>
        </label>
        <div className="row"><button className="btn" disabled={label.trim().length < 2}>Add</button>{msg && <span role="status" className="muted">{msg}</span>}</div>
      </form>
      <ErrorNote message={err} />
      <h3 className="adm-sub">Added by members ({added.length})</h3>
      {items === null ? <Loading /> : added.length === 0 ? <p className="muted small">None yet.</p> : (
        <ul className="list adm-interests">
          {added.map((i) => (
            <li key={i.slug}>
              <span><strong>{i.label}</strong> <span className="muted small">by <Link href={`/u/${i.addedBy}`}>@{i.addedBy}</Link> · {relativeTime(i.addedAt)} · {uses(i)}</span></span>
              <button type="button" className="btn danger" onClick={() => setAsk(i)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog open={ask !== null} title="Remove interest"
        message={ask ? `Remove "${ask.label}"? It comes off ${uses(ask) === 'not used yet' ? 'the list' : `${uses(ask)} too`}.` : ''}
        confirmLabel="Remove" cancelLabel="Keep it" danger
        onConfirm={() => ask && void remove(ask)} onCancel={() => setAsk(null)} />
    </div>
  );
}

/** The room's size and the invite rules. */
function Community() {
  const [s, setS] = useState<AdminSettings | null>(null);
  const [form, setForm] = useState({ seatCap: '', invitesPerMember: '', inviteExpiryDays: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fill = (x: AdminSettings) => {
    setS(x);
    setForm({ seatCap: String(x.seatCap), invitesPerMember: String(x.invitesPerMember), inviteExpiryDays: String(x.inviteExpiryDays) });
  };
  useEffect(() => { api.opsSettings().then(fill, (e) => setErr(errorMessage(e))); }, []);

  async function save(e: FormEvent) {
    e.preventDefault(); setErr(null); setMsg(null);
    try {
      fill(await api.opsUpdateSettings({
        seatCap: Number(form.seatCap), invitesPerMember: Number(form.invitesPerMember), inviteExpiryDays: Number(form.inviteExpiryDays),
      }));
      setMsg('Saved.');
    } catch (x) { setErr(errorMessage(x)); }
  }

  const field = (name: keyof typeof form, label: string, min: number, max: number, hint: string) => (
    <label>{label}
      <input type="number" inputMode="numeric" min={min} max={max} step={1} required value={form[name]}
        onChange={(e) => setForm({ ...form, [name]: e.target.value })} />
      <small className="muted">{hint}</small>
    </label>
  );

  return (
    <section className="panel-sec" aria-labelledby="adm-room">
      <h2 id="adm-room">Community</h2>
      {s === null && !err ? <Loading /> : (
        <form className="stack" onSubmit={save}>
          {field('seatCap', 'Seats in the room', 1, 1000,
            `${s?.seatsUsed ?? 0} in use. Raising it seats people waiting in line right away; lowering it removes nobody.`)}
          {field('invitesPerMember', 'Open invites per member', 0, 20, 'How many unused invite codes each member can hold. Yours on this page have no limit.')}
          {field('inviteExpiryDays', 'Days an invite code lasts', 1, 60, 'For codes created from now on.')}
          <div className="row"><button className="btn primary">Save</button>{msg && <span role="status" className="muted">{msg}</span>}</div>
        </form>
      )}
      <AddInterest />
      <ErrorNote message={err} />
    </section>
  );
}