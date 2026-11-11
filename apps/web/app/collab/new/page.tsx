'use client';
/**
 * RFC §10.21: one door to starting something. Three choices with one line each, then only the
 * basics; everything else is behind one "More options" fold. `?collab=<id>` plans a meetup for that
 * team; `?from=<eventId>` fills the form in from a past event ("Run it again" / "Make it regular").
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, type AnEvent, type Collab } from '@/lib/api';
import { useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { EventForm } from '@/components/Events';
import { CollabForm } from '@/components/Collabs';

type Kind = 'event' | 'activity' | 'project';

export default function StartPage() {
  useTitle('Start something');
  return <SeatedShell>{() => <Start />}</SeatedShell>;
}

const CHOICES: { kind: Kind; title: string; line: string; example: string }[] = [
  { kind: 'event', title: 'Event', line: 'Happens once.', example: 'A picnic on Saturday.' },
  { kind: 'activity', title: 'Activity', line: 'Keeps going.', example: 'A Sunday run club.' },
  { kind: 'project', title: 'Project', line: 'Has a finish.', example: 'Making a zine together.' },
];

function Start() {
  const router = useRouter();
  const [kind, setKind] = useState<Kind | null>(null);
  const [meetup, setMeetup] = useState<Collab | null>(null);
  const [from, setFrom] = useState<AnEvent | null>(null);
  const [audience, setAudience] = useState<'team' | 'anyone'>('team');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const k = q.get('kind');
    if (k === 'event' || k === 'activity' || k === 'project') setKind(k);
    const meetupId = q.get('collab');
    if (meetupId) api.collab(meetupId).then((c) => { if (c.my.role) setMeetup(c); }, () => {});
    const fromId = q.get('from');
    if (fromId) api.event(fromId).then(setFrom, () => {});
  }, []);

  if (!kind && !meetup) {
    return (
      <>
        <p><Link href="/collab">Back to Collab</Link></p>
        <h1>Start something</h1>
        <p className="muted">What is it? You can change the details later.</p>
        <ul className="start-choices">
          {CHOICES.map((c) => (
            <li key={c.kind}>
              <Link href={`/collab/new?kind=${c.kind}`} className="start-choice">
                <span className="start-choice-title">{c.title}</span>
                <span className="start-choice-line">{c.line} <span className="muted">{c.example}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      </>
    );
  }

  const back = meetup ? <Link href={`/collab/${meetup.id}`}>Back to {meetup.title}</Link> : <Link href="/collab">Back to Collab</Link>;

  if (meetup) {
    return (
      <>
        <p>{back}</p>
        <h1>Plan a meetup</h1>
        <div className="stack">
          <p className="muted">A time and place for the team of <strong>{meetup.title}</strong> to meet and work on it. The team gets a notification.</p>
          <fieldset className="stack meetup-audience">
            <legend>Who can see it</legend>
            <label className="check"><input type="radio" name="audience" checked={audience === 'team'} onChange={() => setAudience('team')} /> Only the team</label>
            <label className="check"><input type="radio" name="audience" checked={audience === 'anyone'} onChange={() => setAudience('anyone')} /> Anyone: it shows in Coming up too</label>
          </fieldset>
        </div>
        <EventForm submitLabel="Plan it" onSubmit={async (b) => {
          const e = await api.createEvent({ ...b, collabId: meetup.id, audience });
          router.push(`/collab/event/${e.id}`);
        }} />
      </>
    );
  }

  if (kind === 'event') {
    // Run it again: everything but the dates
    const prefill: AnEvent | undefined = from
      ? { ...from, startsAt: '', endsAt: null, cancelledAt: null, my: null }
      : undefined;
    return (
      <>
        <p>{back}</p>
        <h1>{from ? 'Run it again' : 'Start an event'}</h1>
        <p className="muted">{from ? 'Everything is filled in; only the date is yours to set.' : 'Anyone with a seat can host. Once someone you confirm actually came, hosting counts as taking part.'}</p>
        <EventForm key={from?.id ?? 'new'} initial={prefill} submitLabel={from ? 'Create event' : 'Create event'} onSubmit={async (b) => {
          const e = await api.createEvent(b);
          router.push(`/collab/event/${e.id}`);
        }} />
      </>
    );
  }

  return (
    <>
      <p>{back}</p>
      <h1>{kind === 'activity' ? (from ? 'Make it regular' : 'Start an activity') : 'Start a project'}</h1>
      <p className="muted">
        {kind === 'activity'
          ? 'Something that keeps going: a run club, a reading group. You host it; the team joins in.'
          : 'A team that makes something together and finishes it. The team gets draft portfolio projects at the end.'}
      </p>
      <CollabForm
        key={`${kind}:${from?.id ?? 'new'}`}
        kind={kind!}
        fromEventId={kind === 'activity' && from ? from.id : undefined}
        prefill={kind === 'activity' && from ? {
          title: from.title, description: from.description, interests: from.interests,
          requirements: from.requirements, priceNote: from.priceNote,
        } : undefined}
        submitLabel={kind === 'activity' ? 'Start it' : 'Start it'}
        onSubmit={async (b) => {
          const c = await api.createCollab(b);
          router.push(`/collab/${c.id}`);
        }}
      />
    </>
  );
}
