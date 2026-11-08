'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { COLLAB_NOTE_MAX } from '@anti/shared';
import { api, errorMessage, type Collab, type CollabSuggestion } from '@/lib/api';
import { fmtDate, useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { ErrorNote } from '@/components/ui';
import { AlertDialog, Loading } from '@/components/retro';
import { Avatar } from '@/components/Avatar';
import { InterestTags } from '@/components/Interests';
import { StatusTag } from '@/components/Collabs';
import { Composer } from '@/components/Composer';
import { PostList } from '@/components/PostList';
import { eventWhen } from '@/components/Events';
import { usePaged } from '@/lib/hooks';
import type { Post } from '@/lib/api';

export default function CollabPage() {
  useTitle('Collab');
  return <SeatedShell>{(me) => <CollabView myHandle={me.handle} />}</SeatedShell>;
}

const ROLE_LABEL = { host: 'host', cohost: 'co-host', member: '' } as const;

function CollabView({ myHandle }: { myHandle: string }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<Collab | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<null | 'leave' | 'delete' | 'report' | 'remove'>(null);
  const [reported, setReported] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setC(await api.collab(id)); } catch (e) { setErr(errorMessage(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function act(fn: () => Promise<unknown>, said?: string) {
    setBusy(true); setErr(null); setDone(null);
    try { await fn(); await load(); if (said) setDone(said); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  if (!c) return err ? <><ErrorNote message={err} /><p><Link href="/collabs">Back to collabs</Link></p></> : <Loading />;

  const onTeam = !!c.my.role;
  const full = c.teamCount >= c.teamMax;
  const iAmHost = c.my.role === 'host';
  return (
    <>
      <p><Link href="/collabs" className="ui">Back to collabs</Link></p>
      <article className="stack collab-detail">
        {c.hidden && <div className="banner" role="status">Hidden after reports. Only the team and admins can see it until an admin decides.</div>}
        {c.cover && (
          <div className="pf-coverwrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pf-coverimg" src={c.cover.url} alt="" width={c.cover.width} height={c.cover.height} />
          </div>
        )}
        <header>
          <h1>{c.title} <StatusTag c={c} /></h1>
          <InterestTags slugs={c.interests} />
        </header>
        {c.description && <p className="body collab-desc">{c.description}</p>}
        <dl className="facts">
          {c.roles.length > 0 && <><dt>Looking for</dt><dd>{c.roles.join(', ')}</dd></>}
          {c.requirements && <><dt>Needs</dt><dd className="body">{c.requirements}</dd></>}
          <dt>Team</dt><dd>{c.teamCount} of {c.teamMax} people{full && c.status === 'recruiting' ? ' (full)' : ''}</dd>
          <dt>Joining</dt><dd>{c.status !== 'recruiting' ? 'Not looking for people right now' : c.joinMode === 'open' ? 'Anyone can join' : 'Ask, and the host decides'}</dd>
          {c.host && <><dt>Host</dt><dd><Link href={`/u/${c.host.handle}`}>@{c.host.handle}</Link></dd></>}
          {(c.priceNote || c.paymentUrl) && (
            <>
              <dt>Cost</dt>
              <dd>
                {c.priceNote}{c.priceNote && c.paymentUrl ? '. ' : ''}
                {c.paymentUrl && <><a href={c.paymentUrl} target="_blank" rel="noopener noreferrer nofollow">Link</a> (paid to them, not anti)</>}
              </dd>
            </>
          )}
        </dl>

        <ErrorNote message={err} />
        {done && <p className="muted" role="status">{done}</p>}
        {c.my.invited && !onTeam && (
          <div className="banner" role="status">
            You were invited to join.{' '}
            <button className="btn primary" disabled={busy || full} onClick={() => act(() => api.answerCollabInvite(id, true), 'You are on the team.')}>Join the team</button>{' '}
            <button className="btn" disabled={busy} onClick={() => act(() => api.answerCollabInvite(id, false))}>No thanks</button>
          </div>
        )}
        <div className="row">
          {!onTeam && !c.my.invited && c.status === 'recruiting' && !full && c.my.request === null && (
            c.joinMode === 'open'
              ? <button className="btn primary" disabled={busy} onClick={() => act(() => api.joinCollab(id), 'You are on the team.')}>Join</button>
              : !asking && <button className="btn primary" disabled={busy} onClick={() => setAsking(true)}>Ask to join</button>
          )}
          {c.my.request === 'pending' && !onTeam && (
            <>
              <span className="muted">You asked to join. The host will decide.</span>
              <button className="btn" disabled={busy} onClick={() => act(() => api.withdrawCollabRequest(id))}>Withdraw</button>
            </>
          )}
          {c.my.request === 'declined' && !onTeam && <span className="muted">This one has found its people. Plenty more in Collabs.</span>}
          {c.canManage && <Link className="btn" href={`/collabs/${id}/edit`}>Edit</Link>}
          {c.canManage && c.status === 'recruiting' && <button className="btn" disabled={busy} onClick={() => act(() => api.updateCollab(id, { status: 'closed' }), 'Not recruiting any more.')}>Stop recruiting</button>}
          {c.canManage && c.status === 'closed' && <button className="btn" disabled={busy} onClick={() => act(() => api.updateCollab(id, { status: 'recruiting' }), 'Recruiting again.')}>Recruit again</button>}
          {c.canManage && c.status !== 'finished' && <button className="btn" disabled={busy} onClick={() => act(() => api.updateCollab(id, { status: 'finished' }), 'Marked finished. Well done.')}>Mark finished</button>}
          {onTeam && <button className="btn" disabled={busy} onClick={() => setConfirm('leave')}>Leave</button>}
          {iAmHost && <button className="btn danger" disabled={busy} onClick={() => setConfirm('delete')}>Delete</button>}
          {c.canReport && <button className="btn" disabled={busy || reported} onClick={() => setConfirm('report')}>{reported ? 'Reported' : 'Report'}</button>}
          {c.canModerate && !iAmHost && <button className="btn danger" disabled={busy} onClick={() => setConfirm('remove')}>Remove (admin)</button>}
        </div>
        {asking && (
          <form className="stack card" onSubmit={(e) => { e.preventDefault(); void act(() => api.joinCollab(id, note.trim() || undefined), 'Asked. You will get a notification when the host decides.').then(() => setAsking(false)); }}>
            <label>A note for the host (optional)
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={COLLAB_NOTE_MAX} rows={3} placeholder="What you would bring, or why it speaks to you." />
            </label>
            <div className="row">
              <button className="btn primary" disabled={busy}>Send request</button>
              <button type="button" className="btn" onClick={() => setAsking(false)}>Cancel</button>
            </div>
          </form>
        )}
      </article>

      <section className="stack">
        <h2 className="section-h">Team ({c.teamCount})</h2>
        <ul className="crowd">
          {c.team.map((p) => (
            <li key={p.handle}>
              <Link href={`/u/${p.handle}`}>
                <Avatar seed={p.handle} gender={p.gender} size={64} />
                <span className="crowd-name">{p.displayName}</span>
              </Link>
              {ROLE_LABEL[p.role] && <span className="tag">{ROLE_LABEL[p.role]}</span>}
              {c.canManage && p.handle.toLowerCase() !== myHandle.toLowerCase() && p.role !== 'host' && (
                <span className="crowd-actions">
                  {iAmHost && (
                    <button type="button" className="link-btn" disabled={busy}
                      onClick={() => act(() => api.setCollabRole(id, p.handle, p.role === 'cohost' ? 'member' : 'cohost'))}>
                      {p.role === 'cohost' ? 'Make member' : 'Make co-host'}
                    </button>
                  )}
                  {(iAmHost || p.role === 'member') && (
                    <button type="button" className="link-btn" disabled={busy} onClick={() => act(() => api.removeFromCollab(id, p.handle))}>Remove</button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Meetups c={c} onTeam={onTeam} />
      <Updates c={c} onTeam={onTeam} />

      {c.canManage && <Manage c={c} busy={busy} act={act} />}

      <AlertDialog
        open={confirm !== null}
        title={confirm === 'delete' ? 'Delete collab' : confirm === 'report' ? 'Report' : confirm === 'remove' ? 'Remove collab' : 'Leave'}
        message={confirm === 'delete'
          ? 'Delete this collab for everyone? The team, requests and invites go with it.'
          : confirm === 'report' ? 'Report this collab to the admins? After five reports it is hidden until they look.'
          : confirm === 'remove' ? 'Remove this collab for everyone? The host gets a notification (not who removed it).'
          : iAmHost
            ? 'Leave the team? Your longest-standing co-host becomes host; with no co-host, the collab stops recruiting.'
            : 'Leave the team?'}
        confirmLabel={confirm === 'delete' ? 'Delete' : confirm === 'report' ? 'Report' : confirm === 'remove' ? 'Remove' : 'Leave'}
        cancelLabel={confirm === 'leave' ? 'Stay' : 'Cancel'}
        danger={confirm !== 'report'}
        onConfirm={() => {
          const what = confirm;
          setConfirm(null);
          if (what === 'delete') void act(async () => { await api.deleteCollab(id); router.push('/collabs'); });
          else if (what === 'remove') void act(async () => { await api.opsRemoveCollab(id); router.push('/collabs'); });
          else if (what === 'report') void act(async () => { await api.flagCollab(id); setReported(true); }, 'Reported. Thanks, an admin will take a look.');
          else void act(() => api.leaveCollab(id), 'You left the team.');
        }}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

/** Hosts and co-hosts: requests to answer, and people to invite. */
function Manage({ c, busy, act }: { c: Collab; busy: boolean; act: (fn: () => Promise<unknown>, said?: string) => Promise<void> }) {
  const [sugs, setSugs] = useState<CollabSuggestion[] | null>(null);
  const [handle, setHandle] = useState('');
  useEffect(() => { api.collabSuggestions(c.id).then((r) => setSugs(r.items), () => setSugs([])); }, [c.id, c.invites?.length, c.teamCount]);
  const requests = c.requests ?? [];
  const invites = c.invites ?? [];
  return (
    <>
      <section className="card stack">
        <h2>Asking to join ({requests.length})</h2>
        {requests.length === 0 ? <p className="muted">No requests waiting.</p> : (
          <ul className="list collab-requests">
            {requests.map((r) => (
              <li key={r.handle} className="stack">
                <div className="row between">
                  <Link href={`/u/${r.handle}`} className="who"><Avatar seed={r.handle} gender={r.gender} size={32} /> {r.displayName} <span className="muted">@{r.handle}</span></Link>
                  <span className="muted small">{fmtDate(r.at)}</span>
                </div>
                {r.note && <p className="body">{r.note}</p>}
                <div className="row">
                  <button className="btn primary" disabled={busy || c.teamCount >= c.teamMax} onClick={() => act(() => api.decideCollabRequest(c.id, r.handle, true), `@${r.handle} is on the team.`)}>Accept</button>
                  <button className="btn" disabled={busy} onClick={() => act(() => api.decideCollabRequest(c.id, r.handle, false))}>Decline</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Declining sends a kind note; it never says who decided.</p>
      </section>

      <section className="card stack">
        <h2>Invite people</h2>
        <p className="muted small">People who might fit share this collab&apos;s interests. An invite skips asking: they join with one tap.</p>
        {sugs === null ? <Loading /> : sugs.length === 0 ? <p className="muted">Nobody else shares these interests yet.</p> : (
          <ul className="list">
            {sugs.map((s) => (
              <li key={s.handle} className="row between">
                <span className="who"><Avatar seed={s.handle} gender={s.gender} size={32} /> <Link href={`/u/${s.handle}`}>{s.displayName}</Link> <InterestTags slugs={s.shared} /></span>
                <button className="btn" disabled={busy} onClick={() => act(() => api.inviteToCollab(c.id, s.handle), `Invited @${s.handle}.`)}>Invite</button>
              </li>
            ))}
          </ul>
        )}
        <form className="row" onSubmit={(e) => { e.preventDefault(); const h = handle.trim(); if (h) void act(() => api.inviteToCollab(c.id, h), `Invited @${h.replace(/^@/, '')}.`).then(() => setHandle('')); }}>
          <input aria-label="Invite by handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" maxLength={40} />
          <button className="btn" disabled={busy || !handle.trim()}>Invite</button>
        </form>
        {invites.length > 0 && <p className="muted small">Invited, not answered yet: {invites.map((i) => `@${i.handle}`).join(', ')}</p>}
      </section>
    </>
  );
}

/** Meetups the team planned: team-only ones only the team sees. */
function Meetups({ c, onTeam }: { c: Collab; onTeam: boolean }) {
  if (!onTeam && c.meetups.length === 0) return null;
  return (
    <section className="stack">
      <div className="row between">
        <h2 className="section-h">Meetups</h2>
        {onTeam && c.status !== 'finished' && <Link className="btn" href={`/events/new?collab=${c.id}`}>Plan a meetup</Link>}
      </div>
      {c.meetups.length === 0 ? <p className="muted">No meetups yet. Plan one to work on it together.</p> : (
        <ul className="list meetups">
          {c.meetups.map((m) => (
            <li key={m.id} className={m.past ? 'past' : undefined}>
              <Link href={`/events/${m.id}`}>{m.title}</Link>
              <span className="muted small">
                {eventWhen(m.startsAt, null)} · {m.goingCount} going
                {m.audience === 'team' && <span className="tag" title="Only the team can see this one">team only</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The public updates thread: the team posts (photos, optionally from a meetup); anyone replies. */
function Updates({ c, onTeam }: { c: Collab; onTeam: boolean }) {
  const p = usePaged<Post>(`collab-updates:${c.id}`, (cur) => api.collabUpdates(c.id, cur));
  return (
    <section className="stack">
      <h2 className="section-h">Updates</h2>
      {onTeam && (
        <Composer collabId={c.id} title="update.txt" meetups={c.meetups.map((m) => ({ id: m.id, title: m.title }))}
          placeholder="How is it going? Photos welcome." submitLabel="Post update"
          onCreated={(post) => p.setItems((cur) => [post, ...cur])} />
      )}
      <PostList p={p} context="event" byDay={false}
        empty={onTeam ? 'No updates yet. Share how it is going.' : 'No updates yet. Anyone can reply once the team posts.'} />
    </section>
  );
}