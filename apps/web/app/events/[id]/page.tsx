'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, type EventDetail, type Post } from '@/lib/api';
import { Composer } from '@/components/Composer';
import { ActionMenu } from '@/components/ActionMenu';
import { bnLang } from '@/lib/lang';
import { PostList } from '@/components/PostList';
import { usePaged } from '@/lib/hooks';
import { InterestTags } from '@/components/Interests';
import { COLLAB_NOTE_MAX } from '@anti/shared';
import type { CollabSuggestion } from '@/lib/api';
import { fmtDate, useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { ErrorNote } from '@/components/ui';
import { eventWhen, MyStatus, spotsText } from '@/components/Events';
import { AlertDialog, Loading } from '@/components/retro';
import { Avatar } from '@/components/Avatar';
import { NameMarks } from '@/components/Marks';
import { VISITOR_NOTE, useReadOnly } from '@/components/Visitor';

export default function EventPage() {
  useTitle('Event');
  return <SeatedShell>{() => <EventView />}</SeatedShell>;
}

function EventView() {
  const { id } = useParams<{ id: string }>();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const readOnly = useReadOnly();
  /** a visitor sees the buttons a member would, and can't press them */
  const ro = readOnly ? { disabled: true, title: VISITOR_NOTE } : {};

  const load = useCallback(async () => {
    try { setEv(await api.event(id)); } catch (e) { setErr(errorMessage(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); await load(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  if (!ev) return err ? <><ErrorNote message={err} /><p><Link href="/events">Back to events</Link></p></> : <Loading />;

  const going = ev.my?.status === 'going';
  const waiting = ev.my?.status === 'waitlisted';
  const full = ev.capacity !== null && ev.goingCount >= ev.capacity;

  const start = new Date(ev.startsAt);
  return (
    <>
      <p>{ev.collab ? <Link href={`/collabs/${ev.collab.id}`} className="ui">Back to {ev.collab.title}</Link> : <Link href="/events" className="ui">Back to events</Link>}</p>
      <article className="stack event-detail">
        {ev.cancelledAt && <div className="banner" role="status">This event was cancelled.</div>}
        <header className="event-poster">
          <span className="date-chip" aria-hidden>
            <span className="m">{start.toLocaleDateString(undefined, { month: 'short' })}</span>
            <span className="d">{start.getDate()}</span>
          </span>
          <div>
            <h1 {...bnLang(ev.title)}>{ev.title}</h1>
            <MyStatus e={ev} />
            {ev.audience === 'team' && <span className="tag" title="Only the collab's team can see this">team only</span>}
            <InterestTags slugs={ev.interests} />
          </div>
        </header>
        {ev.description && <p className="body event-desc">{ev.description}</p>}
        <dl className="facts">
          <dt>When</dt><dd>{eventWhen(ev.startsAt, ev.endsAt)}</dd>
          <dt>Where</dt>
          <dd>
            {ev.location ?? <span className="muted">Shared with people who are going.</span>}
            {ev.locationRsvpOnly && ev.location && <span className="tag" title="Only the host and people going can see this">private</span>}
          </dd>
          {ev.collab && <><dt>Meetup for</dt><dd><Link href={`/collabs/${ev.collab.id}`}>{ev.collab.title}</Link></dd></>}
          {ev.host && <><dt>Host</dt><dd><Link href={`/u/${ev.host.handle}`}>@{ev.host.handle}<NameMarks admin={ev.host.admin} verified={ev.host.verified} size=".85em" /></Link></dd></>}
          {ev.requirements && <><dt>Bring / know</dt><dd className="body pre">{ev.requirements}</dd></>}
          <dt>Spots</dt><dd>{spotsText(ev)}</dd>
          {ev.joinMode === 'approve' && <><dt>Joining</dt><dd>Ask with a note; the host decides</dd></>}
          {(ev.priceNote || ev.externalPaymentUrl) && (
            <>
              <dt>Cost</dt>
              <dd>
                {ev.priceNote}{ev.priceNote && ev.externalPaymentUrl ? '. ' : ''}
                {ev.externalPaymentUrl && <><a href={ev.externalPaymentUrl} target="_blank" rel="noopener noreferrer nofollow">Payment link</a> (paid to the host, not anti)</>}
              </dd>
            </>
          )}
        </dl>

        <ErrorNote message={err} />
        {ev.invited && !going && !waiting && ev.rsvpOpen && (
          <div className="banner" role="status">
            @{ev.host?.handle ?? 'The host'} invited you.{' '}
            <button className="btn primary" disabled={busy} onClick={() => act(() => api.rsvp(id))}>{full ? 'Join the waitlist' : "I'm going"}</button>{' '}
            <button className="btn" disabled={busy} onClick={() => act(() => api.declineEventInvite(id))}>No thanks</button>
          </div>
        )}
        <div className="row">
          {!ev.isHost && ev.rsvpOpen && !going && !waiting && ev.joinMode === 'approve' && !ev.invited && ev.request === null && !asking && (
            <button className="btn primary" disabled={busy} onClick={() => setAsking(true)} {...ro}>Ask to come</button>
          )}
          {!ev.isHost && !going && !waiting && ev.request === 'pending' && (
            <>
              <span className="muted">You asked to come. The host will decide.</span>
              <button className="btn" disabled={busy} onClick={() => act(() => api.withdrawEventRequest(id))}>Withdraw</button>
            </>
          )}
          {!ev.isHost && !going && !waiting && ev.request === 'declined' && <span className="muted">This one is full of people already. Plenty more in Events.</span>}
          {!ev.isHost && ev.rsvpOpen && !going && !waiting && !ev.invited && ev.joinMode === 'open' && (
            <button className="btn primary" disabled={busy} onClick={() => act(() => api.rsvp(id))} {...ro}>
              {full ? 'Join the waitlist' : "I'm going"}
            </button>
          )}
          {!ev.isHost && ev.rsvpOpen && (going || waiting) && (
            <button className="btn" disabled={busy} onClick={() => act(() => api.leaveEvent(id))}>
              {going ? "Can't make it" : 'Leave the waitlist'}
            </button>
          )}
          {ev.canEdit && <Link className="btn" href={`/events/${id}/edit`}>Edit</Link>}
          {/* the rare, destructive one lives in the menu */}
          <ActionMenu label="More actions for this event" items={[
            ev.canEdit && !ev.cancelledAt && { label: 'Cancel this event', danger: true, disabled: busy, onSelect: () => setAskCancel(true) },
          ]} />
        </div>
        {asking && (
          <form className="stack card" onSubmit={(e) => { e.preventDefault(); void act(() => api.askToCome(id, note.trim() || undefined)).then(() => setAsking(false)); }}>
            <label>A note for the host (optional)
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={COLLAB_NOTE_MAX} rows={3} placeholder="Why you would like to come, or what you would bring." />
            </label>
            <div className="row">
              <button className="btn primary" disabled={busy}>Send</button>
              <button type="button" className="btn" onClick={() => setAsking(false)}>Cancel</button>
            </div>
          </form>
        )}
        {waiting && <p className="muted small">You are #{ev.my!.waitlistPosition} on the waitlist. If a spot opens you move up automatically and get a notification.</p>}
      </article>
      <AlertDialog
        open={askCancel}
        title="Cancel event"
        message="Cancel this event? Everyone who said they were going gets a notification."
        confirmLabel="Cancel event"
        cancelLabel="Keep it"
        danger
        onConfirm={() => { setAskCancel(false); void act(() => api.cancelEvent(id)); }}
        onCancel={() => setAskCancel(false)}
      />

      {ev.canConfirmAttendance
        ? <Attendance ev={ev} onSaved={load} />
        : <People title={`Going (${ev.goingCount})`} people={ev.going} showAttended={ev.started} />}
      {ev.waitlist && ev.waitlist.length > 0 && <People title={`Waitlist (${ev.waitlist.length})`} people={ev.waitlist} showAttended={false} />}
      {ev.isHost && ev.rsvpOpen && <HostPanel ev={ev} busy={busy} act={act} />}
      <EventUpdates ev={ev} />
    </>
  );
}

function People({ title, people, showAttended }: { title: string; people: EventDetail['going']; showAttended: boolean }) {
  return (
    <section className="stack">
      <h2 className="section-h">{title}</h2>
      {people.length === 0 ? <p className="muted">Nobody yet. Be the first.</p> : (
        <ul className="crowd">
          {people.map((p) => (
            <li key={p.handle}>
              <Link href={`/u/${p.handle}`}>
                <Avatar seed={p.handle} gender={p.gender} size={64} />
                <span className="crowd-name">{p.displayName}<NameMarks admin={p.admin} verified={p.verified} size=".85em" /></span>
              </Link>
              {showAttended && p.attended && <span className="tag on">came</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Host-only, from the start until 14 days after: tick who actually came. */
function Attendance({ ev, onSaved }: { ev: EventDetail; onSaved: () => Promise<void> }) {
  const [picked, setPicked] = useState(() => new Set(ev.going.filter((p) => p.attended).map((p) => p.handle)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const toggle = (h: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(h)) n.delete(h); else n.add(h);
    return n;
  });
  return (
    <section className="card stack">
      <h2>Who came?</h2>
      <p className="muted small">Confirming attendance counts as taking part for each person you tick, and for you as host. You can change this until {fmtDate(new Date(new Date(ev.startsAt).getTime() + 14 * 86_400_000).toISOString())}.</p>
      {ev.going.length === 0 ? <p className="muted">Nobody RSVP&apos;d.</p> : (
        <ul className="list">
          {ev.going.map((p) => (
            <li key={p.handle}>
              <label className="check">
                <input type="checkbox" checked={picked.has(p.handle)} onChange={() => { toggle(p.handle); setSaved(false); }} />
                {p.displayName}<NameMarks admin={p.admin} verified={p.verified} size=".85em" /> <span className="muted">@{p.handle}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote message={err} />
      <div className="row">
        <button className="btn primary" disabled={busy || ev.going.length === 0} onClick={async () => {
          setBusy(true); setErr(null);
          try { await api.confirmAttendance(ev.id, [...picked]); await onSaved(); setSaved(true); }
          catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
        }}>Save attendance</button>
        {saved && <span className="muted" role="status">Saved.</span>}
      </div>
    </section>
  );
}

/** Updates on the event's page: the host and people going post (for a meetup, the team); anyone replies. */
function EventUpdates({ ev }: { ev: EventDetail }) {
  const p = usePaged<Post>(`event-updates:${ev.id}`, (cur) => api.eventUpdates(ev.id, cur));
  if (!ev.canPostUpdate && p.items.length === 0 && !p.loading) return null;
  return (
    <section className="stack">
      <h2 className="section-h">Updates</h2>
      {ev.canPostUpdate && (
        <Composer eventId={ev.id} title="update.txt" placeholder={ev.collab ? 'Notes, photos, what you got done.' : 'Photos, plans, a change of place.'}
          submitLabel="Post update" onCreated={(post) => p.setItems((cur) => [post, ...cur])} />
      )}
      <PostList p={p} context="none" byDay={false} empty="No updates yet." />
    </section>
  );
}

/** The host, before it starts: requests to answer, and people to invite. */
function HostPanel({ ev, busy, act }: { ev: EventDetail; busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [sugs, setSugs] = useState<CollabSuggestion[] | null>(null);
  const [handle, setHandle] = useState('');
  useEffect(() => { api.eventSuggestions(ev.id).then((r) => setSugs(r.items), () => setSugs([])); }, [ev.id, ev.invites?.length, ev.goingCount]);
  const requests = ev.requests ?? [];
  const invites = ev.invites ?? [];
  return (
    <>
      {(ev.joinMode === 'approve' || requests.length > 0) && (
        <section className="card stack">
          <h2>Asking to come ({requests.length})</h2>
          {requests.length === 0 ? <p className="muted">No requests waiting.</p> : (
            <ul className="list collab-requests">
              {requests.map((r) => (
                <li key={r.handle} className="stack">
                  <Link href={`/u/${r.handle}`} className="who"><Avatar seed={r.handle} gender={r.gender} size={32} /> {r.displayName}<NameMarks admin={r.admin} verified={r.verified} size=".85em" /> <span className="muted">@{r.handle}</span></Link>
                  {r.note && <p className="body">{r.note}</p>}
                  <div className="row">
                    <button className="btn primary" disabled={busy} onClick={() => act(() => api.decideEventRequest(ev.id, r.handle, true))}>Accept</button>
                    <button className="btn" disabled={busy} onClick={() => act(() => api.decideEventRequest(ev.id, r.handle, false))}>Decline</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">Accepted people go on the list (or the waitlist when it is full). Declining sends a kind note.</p>
        </section>
      )}
      <section className="card stack">
        <h2>Invite people</h2>
        <p className="muted small">{ev.audience === 'team' ? 'Your teammates who are not coming yet.' : 'People who share this event\u2019s interests. An invite skips asking.'}</p>
        {sugs === null ? <Loading /> : sugs.length === 0
          ? <p className="muted">{ev.interests.length || ev.audience === 'team' ? 'Nobody to suggest right now.' : 'Add interests to the event to see people who might fit.'}</p>
          : (
            <ul className="list">
              {sugs.map((s) => (
                <li key={s.handle} className="row between">
                  <span className="who"><Avatar seed={s.handle} gender={s.gender} size={32} /> <Link href={`/u/${s.handle}`}>{s.displayName}<NameMarks admin={s.admin} verified={s.verified} size=".85em" /></Link> <InterestTags slugs={s.shared} /></span>
                  <button className="btn" disabled={busy} onClick={() => act(() => api.inviteToEvent(ev.id, s.handle))}>Invite</button>
                </li>
              ))}
            </ul>
          )}
        <form className="row" onSubmit={(e) => { e.preventDefault(); const h = handle.trim(); if (h) void act(() => api.inviteToEvent(ev.id, h)).then(() => setHandle('')); }}>
          <input aria-label="Invite by handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" maxLength={40} />
          <button className="btn" disabled={busy || !handle.trim()}>Invite</button>
        </form>
        {invites.length > 0 && <p className="muted small">Invited, not answered yet: {invites.map((i) => `@${i.handle}`).join(', ')}</p>}
      </section>
    </>
  );
}