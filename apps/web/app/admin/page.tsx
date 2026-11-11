'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { NameMarks } from '@/components/Marks';
import { ActionMenu } from '@/components/ActionMenu';
import { api, ApiError, errorMessage, type AdminCollabItem, type AdminContact, type AdminInterest, type AdminMember, type AdminSettings, type ConsultAsk, type FlagItem, type Me, type OpsConsultation, type OpsConsultationDetail, type Pick, type VisitorPassInfo } from '@/lib/api';
import { minutesLabel, priceLabel } from '@/components/Consult';
import { minutesLeft } from '@/components/Visitor';
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
      <NeedsYou />
      {/* RFC §10.20: what waits on an admin comes first; the same row of section links as Settings */}
      <nav className="panel-index" aria-label="Sections">
        <a href="#reports">Reports</a>
        <a href="#consulting">Consulting</a>
        <a href="#members">Members</a>
        <a href="#collab">Collab</a>
        <a href="#invites">Invite codes</a>
        <a href="#visitors">Visitor passes</a>
        <a href="#picks">Picks</a>
        <a href="#consultations">Consultations</a>
        <a href="#community">Community</a>
      </nav>
      <Win title="Moderator panel" className="panel" bodyClassName="panel-body">
        <Reports />
        <ConsultAsks />
        <Members me={me} />
        <CollabAdmin />
        <Invites />
        <VisitorPasses />
        <Picks />
        <Consultations />
        <Community />
      </Win>
    </>
  );
}

/** the sections tell this box how many things are left in them, after every load */
const NEEDS_EVENT = 'anti:admin-needs';
function tellNeeds(what: 'reports' | 'consulting', n: number) {
  window.dispatchEvent(new CustomEvent(NEEDS_EVENT, { detail: { what, n } }));
}

/** RFC §10.20: one line per kind of thing that waits on an admin, each a jump to its section. */
function NeedsYou() {
  const [n, setN] = useState<{ reports: number | null; consulting: number | null }>({ reports: null, consulting: null });
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ what: 'reports' | 'consulting'; n: number }>).detail;
      setN((cur) => ({ ...cur, [d.what]: d.n }));
    };
    window.addEventListener(NEEDS_EVENT, on);
    return () => window.removeEventListener(NEEDS_EVENT, on);
  }, []);
  if (n.reports === null || n.consulting === null) return null;
  const lines = [
    n.reports > 0 && <a key="r" href="#reports">{n.reports} {n.reports === 1 ? 'report' : 'reports'} to decide</a>,
    n.consulting > 0 && <a key="c" href="#consulting">{n.consulting} consulting {n.consulting === 1 ? 'offer' : 'offers'} waiting for a yes</a>,
  ].filter(Boolean);
  return (
    <section className={lines.length ? 'banner needs-you' : 'meta needs-you'} aria-label="Needs you" role="status">
      {lines.length
        ? <><strong>Needs you:</strong>{' '}{lines.map((l, i) => <span key={i}>{i > 0 && ' · '}{l}</span>)}</>
        : <>Nothing is waiting on you.</>}
    </section>
  );
}

/** RFC §10.4: every pick in the rotation, and a way to remove any of them. */
function Picks() {
  const [items, setItems] = useState<Pick[] | null>(null);
  const [ask, setAsk] = useState<Pick | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    api.opsPicks().then((r) => setItems(r.items), (e) => setErr(errorMessage(e)));
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function remove(p: Pick) {
    try { await api.opsRemovePick(p.id); await load(); }
    catch (e) { setErr(errorMessage(e)); }
  }
  return (
    <section className="panel-sec" aria-labelledby="adm-picks" id="picks">
      <h2 id="adm-picks">Picks</h2>
      <p className="muted small">Everything suggested for the pick window. Removing one takes it out of the rotation for everyone; the author is told.</p>
      <ErrorNote message={err} />
      {items === null ? <Loading /> : items.length === 0 ? <p className="muted">No picks yet.</p> : (
        <ul className="list">
          {items.map((p) => (
            <li key={p.id}>
              <span className="grow">
                <span className="tag">{p.kind}</span>{' '}
                <strong>{p.title}</strong>
                {p.author && <> · <Link href={`/u/${p.author.handle}`}>@{p.author.handle}</Link></>}
                <span className="muted small"> · score {p.up - p.down} · {p.remarkCount} {p.remarkCount === 1 ? 'remark' : 'remarks'}</span>
              </span>
              <button type="button" className="btn" onClick={() => setAsk(p)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog
        open={ask !== null}
        title="Remove pick"
        message={ask ? <>Remove <strong>{ask.title}</strong> from the rotation? {ask.author ? `@${ask.author.handle} is told.` : ''} This cannot be undone.</> : ''}
        confirmLabel="Remove"
        danger
        onConfirm={() => { const p = ask; setAsk(null); if (p) void remove(p); }}
        onCancel={() => setAsk(null)}
      />
    </section>
  );
}

/**
 * RFC §10.21: every event, activity and project in one list, with the admin's wipe. This is the
 * place to reach for Remove — including events, which have no other admin door.
 */
function CollabAdmin() {
  const [items, setItems] = useState<AdminCollabItem[] | null>(null);
  const [ask, setAsk] = useState<AdminCollabItem | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.opsCollab().then((r) => setItems(r.items), (e) => setErr(errorMessage(e)));
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function remove(it: AdminCollabItem) {
    setBusy(true);
    setErr(null);
    try {
      if (it.type === 'event') await api.opsRemoveEvent(it.id);
      else await api.opsRemoveCollab(it.id);
      await load();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  const WORD: Record<AdminCollabItem['type'], string> = { event: 'event', activity: 'activity', project: 'project' };
  return (
    <section className="panel-sec" aria-labelledby="adm-collab" id="collab">
      <h2 id="adm-collab">Collab</h2>
      <p className="muted small">
        Every event, activity and project, including hidden ones and team-only meetups. Removing one deletes it
        for good — its team, requests, invites, updates and meetups go with it — and the host is told, not who.
      </p>
      <ErrorNote message={err} />
      {items === null ? <Loading /> : items.length === 0 ? <p className="muted">Nothing in Collab yet.</p> : (
        <ul className="list adm-collab">
          {items.map((it) => (
            <li key={`${it.type}:${it.id}`}>
              <span className="grow">
                <span className="tag">{WORD[it.type]}</span>{' '}
                <Link href={it.type === 'event' ? `/collab/event/${it.id}` : `/collab/${it.id}`}><strong>{it.title}</strong></Link>
                {it.host && <> · <Link href={`/u/${it.host}`}>@{it.host}</Link></>}
                <span className="muted small">
                  {it.startsAt ? ` · ${fmtDate(it.startsAt)}` : ''}
                  {it.status ? ` · ${it.status}` : ''}
                  {it.flagged ? ' · flagged' : ''}
                </span>
              </span>
              <button type="button" className="btn danger" disabled={busy} onClick={() => setAsk(it)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog
        open={ask !== null}
        title={ask ? `Remove ${WORD[ask.type]}` : 'Remove'}
        message={ask ? <>Remove <strong>{ask.title}</strong> for good? Its team, requests, invites, updates and meetups are deleted with it. This cannot be undone.{ask.host ? ` @${ask.host} is told (not who).` : ''}</> : ''}
        confirmLabel="Remove"
        danger
        onConfirm={() => { const it = ask; setAsk(null); if (it) void remove(it); }}
        onCancel={() => setAsk(null)}
      />
    </section>
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
    <section className="panel-sec" aria-labelledby="adm-inv" id="invites">
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

/**
 * Visitor passes (RFC §10.8): an hour of looking around for someone without an account. The code
 * (and the link that carries it) is shown once; the list keeps the last 30 days with each pass's
 * state. Revoking ends an active visit on the visitor's next click and kills an unopened code.
 */
function VisitorPasses() {
  const [items, setItems] = useState<VisitorPassInfo[] | null>(null);
  const [active, setActive] = useState(0);
  const [label, setLabel] = useState('');
  const [made, setMade] = useState<(VisitorPassInfo & { code: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<VisitorPassInfo | null>(null);
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const load = useCallback(async () => {
    try { const r = await api.opsVisitorPasses(); setItems(r.items); setActive(r.active); } catch (e) { setErr(errorMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { setMade(await api.opsCreateVisitorPass(label)); setLabel(''); await load(); }
    catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  }
  async function revoke(p: VisitorPassInfo) {
    setAsk(null); setErr(null);
    try { await api.opsRevokeVisitorPass(p.id); if (made?.id === p.id) setMade(null); await load(); }
    catch (x) { setErr(errorMessage(x)); }
  }

  const state = (p: VisitorPassInfo): { text: string; cls?: string } => {
    switch (p.status) {
      case 'unopened': return { text: `not opened yet · code works until ${fmtDate(p.codeExpiresAt)}` };
      case 'active': return { text: `visiting now · ${minutesLeft(p.expiresAt!)} min left`, cls: 'on' };
      case 'ended': return { text: `visited ${fmtDate(p.openedAt)} · over` };
      case 'expired': return { text: 'never opened · code expired' };
      case 'revoked': return { text: `revoked ${fmtDate(p.revokedAt)}`, cls: 'danger' };
    }
  };
  const link = made ? `${origin}/visit/${made.code}` : '';

  return (
    <section className="panel-sec" aria-labelledby="adm-visit" id="visitors">
      <h2 id="adm-visit">Visitor passes</h2>
      <p className="muted">
        An hour of looking around for someone who is not a member: everything members see, nothing they can do. Each pass works once,
        in one browser; the hour starts when the code is entered. An unopened code lasts a week.
        {active > 0 && <> <strong>{active} visiting right now.</strong></>}
      </p>
      <form className="row adm-visit-form" onSubmit={create}>
        <label className="grow">Who is it for? <span className="muted">(only you see this)</span>
          <input value={label} maxLength={80} placeholder="Priya from the agency" onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button className="btn primary" disabled={busy}>{busy ? 'Making…' : 'Make a 1-hour pass'}</button>
      </form>
      {made && (
        <div className="stack adm-visit-made" role="status">
          <p className="muted">Send them either one. Shown only once.{made.label ? <> For <strong>{made.label}</strong>.</> : null}</p>
          <ul className="list">
            <li><span className="code">{made.code}</span><CopyButton text={made.code} label="Copy code" /></li>
            <li><span className="code adm-visit-link">{link}</span><CopyButton text={link} label="Copy link" /></li>
          </ul>
        </div>
      )}
      <ErrorNote message={err} />
      {items === null ? (err ? null : <Loading />) : items.length === 0 ? <p className="muted">No passes yet.</p> : (
        <ul className="list adm-visits">
          {items.map((p) => {
            const s = state(p);
            return (
              <li key={p.id}>
                <span className="adm-visit-main">
                  <span>
                    <strong>{p.label || 'Unnamed pass'}</strong>
                    <span className={`tag${s.cls ? ` ${s.cls}` : ''}`}>{p.status === 'active' ? 'visiting' : p.status}</span>
                  </span>
                  <span className="muted small">{s.text} · made {relativeTime(p.createdAt)}{p.createdByHandle && <> by @{p.createdByHandle}</>}</span>
                </span>
                {(p.status === 'unopened' || p.status === 'active') && (
                  <button type="button" className="btn danger" onClick={() => setAsk(p)}>{p.status === 'active' ? 'End the visit' : 'Revoke'}</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <AlertDialog
        open={ask !== null}
        title={ask?.status === 'active' ? 'End the visit' : 'Revoke pass'}
        message={ask?.status === 'active'
          ? <>End <strong>{ask.label || 'this'}</strong>&apos;s visit now? They are out on their next click and see that their hour is up.</>
          : <>Revoke the pass for <strong>{ask?.label || 'this'}</strong>? The code stops working.</>}
        confirmLabel={ask?.status === 'active' ? 'End it' : 'Revoke'}
        danger
        onConfirm={() => ask && void revoke(ask)}
        onCancel={() => setAsk(null)}
      />
    </section>
  );
}

/**
 * RFC §10.18: members who switched their consulting offer on and are waiting for a yes. The badge
 * is always there (only verified members can ask); the offer is shown in words so the decision
 * needs one screen and no extra clicking.
 */
function ConsultAsks() {
  const [items, setItems] = useState<ConsultAsk[] | null>(null);
  const [ask, setAsk] = useState<{ a: ConsultAsk; approved: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try { const r = await api.opsConsultAsks(); setItems(r); tellNeeds('consulting', r.length); } catch (e) { setErr(errorMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function decide(a: ConsultAsk, approved: boolean) {
    setAsk(null); setErr(null); setMsg(null);
    try {
      await api.opsDecideConsulting(a.handle, approved);
      setMsg(approved ? `@${a.handle} can offer consulting. Their offer goes live when they switch it on.` : `@${a.handle}'s consulting is not approved. They are told.`);
      await load();
    } catch (e) { setErr(errorMessage(e)); }
  }

  return (
    <section className="panel-sec" aria-labelledby="adm-asks" id="consulting">
      <h2 id="adm-asks">Consulting</h2>
      <p className="muted">
        Members who finished setting up an offer and are waiting for a yes. Offering consulting needs the verified badge first, so everyone here has it.
        Approving lasts: they pause and resume without asking again. A member who loses the badge loses this too.
      </p>
      {msg && <p role="status" className="muted">{msg}</p>}
      <ErrorNote message={err} />
      {items === null ? (err ? null : <Loading />) : items.length === 0 ? <p className="muted">Nobody is waiting.</p> : (
        <ul className="list adm-asks">
          {items.map((a) => (
            <li key={a.handle}>
              <Avatar seed={a.handle} gender={a.gender ?? null} size={40} />
              <span className="adm-member-main">
                <span>
                  <Link href={`/u/${a.handle}`} className="name">{a.displayName}</Link>
                  {' '}<span className="muted handle">@{a.handle}</span>
                  <NameMarks admin={a.admin} verified={a.verified} />
                  <span className="tag hot">waiting</span>
                </span>
                <span className="muted small">
                  asked {relativeTime(a.askedAt)} · {minutesLabel(a.minutes)} · {priceLabel(a)}
                  {!a.active && <> · <strong>their offer is paused</strong></>}
                </span>
                {a.description && <span className="adm-body">{a.description}</span>}
              </span>
              <span className="row adm-member-actions">
                <button type="button" className="btn primary" onClick={() => setAsk({ a, approved: true })}>Approve</button>
                <button type="button" className="btn" onClick={() => setAsk({ a, approved: false })}>Not now</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog
        open={ask?.approved === true}
        title="Approve consulting"
        message={ask ? <>Let <strong>@{ask.a.handle}</strong> offer consulting? Their offer ({minutesLabel(ask.a.minutes)}, {priceLabel(ask.a)}) goes live as soon as it is switched on. They are told.</> : ''}
        confirmLabel="Approve"
        onConfirm={() => ask && void decide(ask.a, true)}
        onCancel={() => setAsk(null)}
      />
      <AlertDialog
        open={ask?.approved === false}
        title="Not this time"
        message={ask ? <>Not approve <strong>@{ask.a.handle}</strong>? Their offer is switched off and they cannot switch it back on until an admin changes this. No reason is given; they are told the decision.</> : ''}
        confirmLabel="Not this time"
        danger
        onConfirm={() => ask && void decide(ask.a, false)}
        onCancel={() => setAsk(null)}
      />
    </section>
  );
}

type Ask = { item: FlagItem; resolution: 'restored' | 'removed' } | null;
const KIND_LABEL: Record<FlagItem['kind'], string> = {
  post: 'Post', project: 'Project', collab: 'Collab', consult_offer: 'Consultation offer', consultation: 'Consultation request',
};

/** A reported request in full: admins see contacts only here, to judge a report (RFC §10.6). */
function ConsultDetail({ id }: { id: string }) {
  const [d, setD] = useState<OpsConsultationDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.opsConsultation(id).then(setD, (e) => setErr(errorMessage(e))); }, [id]);
  if (err) return <ErrorNote message={err} />;
  if (!d) return <Loading />;
  return (
    <dl className="facts adm-consult">
      <dt>State</dt><dd>{d.status}{d.pricing && <> · {d.pricing === 'paid' ? d.priceNote ?? 'paid' : 'free'}</>}</dd>
      <dt>Asked</dt><dd className="pre">{d.need}</dd>
      {d.when && <><dt>When</dt><dd>{d.when}</dd></>}
      <dt>Contacts</dt>
      <dd>@{d.consultant.handle}: {d.contacts.consultant ?? <em className="muted">not shared or already wiped</em>}<br />@{d.requester.handle}: {d.contacts.requester ?? <em className="muted">wiped</em>}</dd>
      {d.paymentUrl && <><dt>Payment link</dt><dd className="mono">{d.paymentUrl}</dd></>}
      {d.thanks && <><dt>Thank-you</dt><dd>{d.thanks}</dd></>}
      <dt>Reports</dt><dd>{d.reports.map((r, i) => <span key={i} className="block">@{r.handle}{r.reason ? `: ${r.reason}` : ''} <span className="muted small">{fmtDate(r.at)}{!r.open && ' · handled'}</span></span>)}</dd>
    </dl>
  );
}

/** Who consulted whom and when. Never what was asked or the contacts (those only on a report). */
function Consultations() {
  const [items, setItems] = useState<OpsConsultation[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.opsConsultations().then(setItems, (e) => setErr(errorMessage(e))); }, []);
  return (
    <section className="panel-sec" aria-labelledby="adm-con" id="consultations">
      <h2 id="adm-con">Consultations</h2>
      <p className="muted">Who asked whom, and when. What they asked and their contacts stay between them unless one of them reports it.</p>
      <ErrorNote message={err} />
      {items === null ? (err ? null : <Loading />) : items.length === 0 ? <p className="muted">None yet.</p> : (
        <ul className="list adm-consults">
          {items.slice(0, 50).map((c) => (
            <li key={c.id}>
              <Link href={`/u/${c.requester.handle}`}>@{c.requester.handle}</Link> → <Link href={`/u/${c.consultant.handle}`}>@{c.consultant.handle}</Link>
              {' '}<span className="muted small">{c.status}{c.pricing ? ` · ${c.pricing}` : ''} · {relativeTime(c.createdAt)}</span>
              {c.reported && <span className="tag danger">reported</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Reports() {
  const [items, setItems] = useState<FlagItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try { const r = await api.opsFlags(); setItems(r); tellNeeds('reports', r.length); } catch (e) { setErr(errorMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function resolve(a: NonNullable<Ask>) {
    setAsk(null); setErr(null);
    try {
      if (a.item.kind === 'post') await api.opsResolvePost(a.item.postId!, a.resolution);
      else if (a.item.kind === 'collab') await api.opsResolveCollab(a.item.collabId!, a.resolution);
      else if (a.item.kind === 'consult_offer') await api.opsResolveConsultOffer(a.item.offerHandle!, a.resolution);
      else if (a.item.kind === 'consultation') await api.opsResolveConsultation(a.item.consultationId!, a.resolution);
      else await api.opsResolveProject(a.item.projectId!, a.resolution);
      await load();
    } catch (e) { setErr(errorMessage(e)); }
  }

  const link = (f: FlagItem) => f.kind === 'post'
    ? `/p/${f.postId}`
    : f.kind === 'collab' ? `/collab/${f.collabId}`
    : f.kind === 'consult_offer' ? `/u/${f.offerHandle}`
    : f.kind === 'consultation' ? null
    : f.author ? `/u/${f.author}/work/${f.projectId}` : null;

  return (
    <section className="panel-sec" aria-labelledby="adm-rep" id="reports">
      <h2 id="adm-rep">Reports</h2>
      <div className="row between adm-rep-head">
        <p className="muted">Posts, projects, collabs and consultations members reported. Five reports hide one automatically until you decide; a reported consultation request comes straight here.</p>
        <button type="button" className="btn" onClick={() => void load()}>Refresh</button>
      </div>
      <ErrorNote message={err} />
      {items === null ? <Loading /> : items.length === 0 ? <p className="muted">No open reports.</p> : (
        <ul className="adm-reports">
          {items.map((f) => {
            const href = link(f);
            return (
              <li key={f.postId ?? f.projectId ?? f.collabId ?? f.consultationId ?? `offer:${f.offerHandle}`}>
                <span className="adm-meta">
                  <strong>{KIND_LABEL[f.kind]}</strong>
                  {f.kind === 'collab' ? ' hosted by ' : f.kind === 'consultation' ? ' to ' : ' by '}{f.author ? <Link href={`/u/${f.author}`}>@{f.author}</Link> : 'a deleted member'}
                  {f.kind === 'consultation' && f.requester && <> from <Link href={`/u/${f.requester}`}>@{f.requester}</Link></>}
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
                {f.kind === 'consultation' && open === f.consultationId && <ConsultDetail id={f.consultationId!} />}
                <div className="row">
                  {href && <Link className="btn" href={href}>Open</Link>}
                  {f.kind === 'consultation' && (
                    <button type="button" className="btn" onClick={() => setOpen(open === f.consultationId ? null : f.consultationId!)}>
                      {open === f.consultationId ? 'Hide request' : 'Read the request'}
                    </button>
                  )}
                  <button type="button" className="btn" onClick={() => setAsk({ item: f, resolution: 'restored' })}>
                    {f.hidden ? 'Restore' : 'Keep it'}
                  </button>
                  <button type="button" className="btn danger" onClick={() => setAsk({ item: f, resolution: 'removed' })}>
                    {f.kind === 'consult_offer' ? 'Switch consulting off' : f.kind === 'consultation' ? 'Close it' : 'Remove'}
                  </button>
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
        message={ask?.item.kind === 'consult_offer'
          ? <>Switch <strong>@{ask.item.offerHandle}</strong>&apos;s consulting off? Their offer disappears and requests not yet under way close. You can switch it back on from Members.</>
          : ask?.item.kind === 'consultation'
            ? <>Close this request? Both contacts are hidden at once and both people are told an admin closed it.</>
            : <>Remove this {ask?.item.kind ?? 'post'}? Its author is told it was removed after reports. <strong>This cannot be undone.</strong></>}
        confirmLabel={ask?.item.kind === 'consult_offer' ? 'Switch off' : ask?.item.kind === 'consultation' ? 'Close it' : 'Remove'}
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
/** RFC §10.18: how their consulting stands, in words an admin reads at a glance. */
const CONSULTING_LABEL: Record<AdminMember['consulting'], string> = {
  none: '', on: 'on', paused: 'paused', off: 'switched off by an admin',
  waiting: 'waiting for approval', declined: 'not approved',
};

type MemberAsk = { kind: 'ban' | 'unban' | 'admin' | 'unadmin' | 'rename' | 'birthday'; m: AdminMember } | null;
type MemberFilter = 'all' | 'seated' | 'waiting' | 'archived' | 'banned' | 'unverified' | 'consulting';
const FILTERS: [MemberFilter, string][] = [['all', 'Everyone'], ['seated', 'Seated'], ['unverified', 'Not verified'], ['consulting', 'Consulting'], ['waiting', 'Waiting'], ['archived', 'Archived'], ['banned', 'Banned']];

/** Everyone in the room (and the queue, archived and banned), with what an admin can do to each. */
function Members({ me }: { me: Me }) {
  const [list, setList] = useState<AdminMember[] | null>(null);
  const [q, setQ] = useState('');
  const [ask, setAsk] = useState<MemberAsk>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** a corrected birthday that makes someone under 13: confirm before their account is closed */
  const [underage, setUnderage] = useState<{ m: AdminMember; birthday: string; detail: string } | null>(null);
  /** RFC §10.7: work through who is not verified yet; contact details opened on request (logged) */
  const [filter, setFilter] = useState<MemberFilter>('all');
  const [contacts, setContacts] = useState<Record<string, AdminContact>>({});
  const [pinCode, setPinCode] = useState<{ handle: string; code: string; expiresAt: string } | null>(null);

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

  async function consulting(m: AdminMember, on: boolean) {
    setErr(null); setMsg(null);
    try {
      await api.opsSetConsulting(m.handle, on);
      setMsg(on ? `@${m.handle} can offer consultations again.` : `@${m.handle}'s consulting is switched off.`);
      await load();
    } catch (e) { setErr(errorMessage(e)); }
  }

  async function verify(m: AdminMember, on: boolean) {
    setErr(null); setMsg(null);
    try {
      await api.opsVerify(m.handle, on);
      setMsg(on ? `@${m.handle} is verified. They got a notification.` : `@${m.handle}'s badge is taken back.`);
      await load();
    } catch (e) { setErr(errorMessage(e)); }
  }

  /** RFC §10.18: the same yes and no as the Consulting queue, from the member's own row. */
  async function decideConsulting(m: AdminMember, approved: boolean) {
    setErr(null); setMsg(null);
    try {
      await api.opsDecideConsulting(m.handle, approved);
      setMsg(approved ? `@${m.handle} can offer consulting.` : `@${m.handle}'s consulting is not approved. They are told.`);
      await load();
    } catch (e) { setErr(errorMessage(e)); }
  }

  /** RFC §10.13: a one-hour code to give the member in person or by phone; they are told; it is logged */
  async function resetPin(m: AdminMember) {
    setErr(null); setMsg(null);
    try { const r = await api.opsPinReset(m.handle); setPinCode({ handle: m.handle, ...r }); }
    catch (e) { setErr(errorMessage(e)); }
  }

  async function showContact(m: AdminMember) {
    if (contacts[m.handle]) { setContacts((c) => { const n = { ...c }; delete n[m.handle]; return n; }); return; }
    setErr(null);
    try { const r = await api.opsContact(m.handle); setContacts((c) => ({ ...c, [m.handle]: r })); }
    catch (e) { setErr(errorMessage(e)); }
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
  const seatedState = (m: AdminMember) => m.state === 'active' || m.state === 'flagged_lurker';
  const unverified = (list ?? []).filter((m) => seatedState(m) && !m.verified);
  const inFilter = (m: AdminMember, f: MemberFilter) => {
    switch (f) {
      case 'seated': return seatedState(m);
      case 'waiting': return m.state === 'waitlisted';
      case 'archived': return m.state === 'archived';
      case 'banned': return m.state === 'banned';
      case 'unverified': return seatedState(m) && !m.verified;
      case 'consulting': return m.consulting === 'on' || m.consulting === 'waiting';
      default: return true;
    }
  };
  const count = (f: MemberFilter) => (list ?? []).filter((m) => inFilter(m, f)).length;
  const shown = (list ?? []).filter((m) => inFilter(m, filter) && (!term
    || m.handle.toLowerCase().includes(term) || m.displayName.toLowerCase().includes(term) || m.state.includes(term)));
  const seated = (m: AdminMember) => m.state === 'active' || m.state === 'flagged_lurker';
  const who = ask ? (ask.m.handle === me.handle ? 'yourself' : `@${ask.m.handle}`) : '';

  return (
    <section className="panel-sec" aria-labelledby="adm-mem" id="members">
      <h2 id="adm-mem">Members</h2>
      <p className="muted">Everyone, including people waiting for a seat, archived and banned. Admins never lose their seat to the activity rules.</p>
      <input type="search" aria-label="Filter members" placeholder="Filter by handle or name" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips adm-filters" role="group" aria-label="Show">
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" className={`chip${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {label}{f === 'unverified' ? ` (${unverified.length})` : f === 'all' ? '' : ` (${count(f)})`}
          </button>
        ))}
      </div>
      {msg && <p role="status" className="muted">{msg}</p>}
      <ErrorNote message={err} />
      {pinCode && (
        <div className="pin-reset-code" role="status">
          <p>
            PIN reset code for <strong>@{pinCode.handle}</strong>. Give it to them in person or on the phone, not in a post.
            It works once, until {new Date(pinCode.expiresAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.
            They enter it under <em>Forgot your PIN?</em> on the sign-in page.
          </p>
          <p className="code" aria-label="Reset code">{pinCode.code}</p>
          <div className="row"><CopyButton text={pinCode.code} /><button type="button" className="btn" onClick={() => setPinCode(null)}>Done</button></div>
        </div>
      )}
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
                  <NameMarks admin={m.role === 'ops'} verified={!!m.verified} />
                  {STATE_LABEL[m.state] && <span className={`tag${m.state === 'banned' ? ' danger' : ''}`}>{STATE_LABEL[m.state]}</span>}
                </span>
                <span className="muted small">
                  Joined {fmtDate(m.joinedAt)}
                  {' · '}{m.lastSeenAt ? `seen ${relativeTime(m.lastSeenAt)}` : 'never seen'}
                  {' · '}{m.postCount} {m.postCount === 1 ? 'post' : 'posts'}
                  {m.age !== null && <> · age {m.age}</>}
                  {m.consulting !== 'none' && <> · consulting {CONSULTING_LABEL[m.consulting]}</>}
                  {m.invitedBy && <> · invited by @{m.invitedBy}</>}
                  {m.verified && <> · verified {fmtDate(m.verified.at)}{m.verified.by && <> by @{m.verified.by}</>}</>}
                  {!m.hasContact && seatedState(m) && <> · no contact details yet</>}
                  {m.contactChangedSinceVerified && <> · <strong>contact changed since verified</strong></>}
                </span>
                {contacts[m.handle] && (
                  <dl className="contact-reveal" aria-label={`Contact details of @${m.handle}`}>
                    <dt>Phone</dt><dd>{contacts[m.handle]!.phone ? <a href={`tel:${contacts[m.handle]!.phone}`}>{contacts[m.handle]!.phone}</a> : <span className="muted">none</span>}</dd>
                    <dt>Email</dt><dd>{contacts[m.handle]!.email ? <a href={`mailto:${contacts[m.handle]!.email}`}>{contacts[m.handle]!.email}</a> : <span className="muted">none</span>}</dd>
                    <dt>Opened</dt><dd className="muted small">{contacts[m.handle]!.openedBy.slice(0, 3).map((v) => `@${v.handle ?? 'a former admin'} ${relativeTime(v.at)}`).join(', ')}</dd>
                  </dl>
                )}
              </span>
              {/* one button for the thing most likely needed now; everything else in the row's menu */}
              <span className="row adm-member-actions">
                {seatedState(m) && !m.verified && <button type="button" className="btn primary" onClick={() => void verify(m, true)}>Verify</button>}
                {/* RFC §10.20: a consulting request waiting on an admin is the thing to do now, so it is a button */}
                {m.consulting === 'waiting' && <button type="button" className={m.verified ? 'btn primary' : 'btn'} onClick={() => void decideConsulting(m, true)}>Approve consulting</button>}
                {m.state === 'banned' && <button type="button" className="btn" onClick={() => setAsk({ kind: 'unban', m })}>Unban</button>}
                {m.hasContact && <button type="button" className="btn" onClick={() => void showContact(m)}>{contacts[m.handle] ? 'Hide contact' : 'Show contact'}</button>}
                {/* the menu in groups: their account, their consulting, their role, and Ban last */}
                <ActionMenu label={`More actions for @${m.handle}`} items={[
                  seatedState(m) && m.verified && { label: 'Remove verification', onSelect: () => void verify(m, false) },
                  m.handle !== me.handle && m.state !== 'banned' && { label: 'Reset PIN', onSelect: () => void resetPin(m) },
                  { label: 'Change handle', onSelect: () => setAsk({ kind: 'rename', m }) },
                  { label: 'Change birthday', onSelect: () => setAsk({ kind: 'birthday', m }) },
                  m.consulting === 'waiting' && { label: 'Do not approve consulting', onSelect: () => void decideConsulting(m, false) },
                  m.consulting === 'declined' && { label: 'Approve consulting', onSelect: () => void decideConsulting(m, true) },
                  m.consulting === 'off' && { label: 'Allow consulting', onSelect: () => void consulting(m, true) },
                  (m.consulting === 'on' || m.consulting === 'paused') && { label: 'Switch consulting off', onSelect: () => void consulting(m, false) },
                  m.state !== 'banned' && m.role === 'ops' && { label: 'Remove admin', onSelect: () => setAsk({ kind: 'unadmin', m }) },
                  m.state !== 'banned' && m.role !== 'ops' && seated(m) && { label: 'Make admin', onSelect: () => setAsk({ kind: 'admin', m }) },
                  m.state !== 'banned' && m.role !== 'ops' && { label: 'Ban', danger: true, onSelect: () => setAsk({ kind: 'ban', m }) },
                ]} />
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
        message={<>Unban <strong>{who}</strong>? They can sign in again with their handle and PIN. They get a seat if one is free; otherwise they wait in line.</>}
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
    <section className="panel-sec" aria-labelledby="adm-room" id="community">
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