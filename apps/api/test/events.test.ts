import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { EVENTS_PER_DAY } from '@anti/shared';
import { cleanup, setup, type Client } from './client';

afterEach(cleanup);

const inDays = (d: number, h = 0) => new Date(Date.now() + d * 86_400_000 + h * 3_600_000).toISOString();

async function world() {
  const w = await setup({ seatCap: 10 });
  const rowsOf = async (q: ReturnType<typeof sql>) => ((await w.t.db.execute(q)) as any).rows as any[];
  const member = async (handle: string) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle)).status).toBe(200);
    return c;
  };
  /** Moves an event's start into the past (so attendance opens / RSVPs close). */
  const startNow = (id: string, hoursAgo = 1) =>
    w.t.db.execute(sql`update events set starts_at = now() - make_interval(hours => ${hoursAgo}), ends_at = null where id = ${id}::uuid`);
  /** Event notification kinds, newest first (ignores the 'activated' one from joining). */
  const kinds = async (c: Client) =>
    (await c.get('/notifications')).body.items.map((n: any) => n.kind).filter((k: string) => k.startsWith('event_'));
  return { ...w, rowsOf, member, startNow, kinds };
}

const base = { title: 'Saturday market walk', description: 'Meet by the fountain.', startsAt: inDays(3), location: 'Elm Square fountain' };

async function create(c: Client, extra: Record<string, unknown> = {}) {
  const r = await c.post('/events', { ...base, ...extra });
  expect(r.status).toBe(200);
  return r.body;
}

describe('create and list', () => {
  test('validates input and lists upcoming events soonest first', async () => {
    const w = await world();
    const host = await w.member('noor');
    const bad = async (b: Record<string, unknown>) => (await host.post('/events', { ...base, ...b })).body.error;
    expect(await bad({ title: '  ' })).toBe('event_invalid');
    expect(await bad({ startsAt: inDays(-1) })).toBe('event_invalid');
    expect(await bad({ startsAt: inDays(400) })).toBe('event_invalid');
    expect(await bad({ endsAt: inDays(2) })).toBe('event_invalid'); // ends before it starts
    expect(await bad({ capacity: 0 })).toBe('event_invalid');
    expect(await bad({ externalPaymentUrl: 'javascript:alert(1)' })).toBe('event_invalid');
    expect(await bad({ startsAt: 'tomorrow-ish' })).toBe('event_invalid');

    const later = await create(host, { title: 'Later', startsAt: inDays(5) });
    const soon = await create(host, {
      title: 'Soon', startsAt: inDays(1), endsAt: inDays(1, 2), capacity: 8, priceNote: '$5 at the door',
      externalPaymentUrl: 'https://pay.example.com/x',
    });
    expect(soon).toMatchObject({
      title: 'Soon', location: 'Elm Square fountain', capacity: 8, goingCount: 0, priceNote: '$5 at the door',
      externalPaymentUrl: 'https://pay.example.com/x', isHost: true, canEdit: true, rsvpOpen: true, my: null,
      host: { handle: 'noor', displayName: 'noor', state: 'active' },
    });

    const viewer = await w.member('vic');
    const list = (await viewer.get('/events')).body;
    expect(list.items.map((e: any) => e.title)).toEqual(['Soon', 'Later']);
    expect(list.items[0].isHost).toBe(false);

    // paginate one at a time
    const p1 = (await viewer.get('/events?limit=1')).body;
    const p2 = (await viewer.get(`/events?limit=1&cursor=${p1.nextCursor}`)).body;
    expect([p1.items[0].id, p2.items[0].id, p2.nextCursor]).toEqual([soon.id, later.id, null]);

    // past events move to the past tab
    await w.startNow(soon.id, 5);
    expect((await viewer.get('/events')).body.items.map((e: any) => e.title)).toEqual(['Later']);
    expect((await viewer.get('/events?scope=past')).body.items.map((e: any) => e.title)).toEqual(['Soon']);
  });

  test('waitlisted members cannot see events; creation is rate limited', async () => {
    const w = await setup({ seatCap: 1 });
    const a = w.client();
    await a.register(await w.mint(), 'alice');
    const b = w.client();
    await b.register(await w.mint(), 'bob');
    expect((await b.get('/events')).body.error).toBe('no_seat');
    expect((await b.post('/events', base)).body.error).toBe('no_seat');

    for (let i = 0; i < EVENTS_PER_DAY; i++) expect((await a.post('/events', base)).status).toBe(200);
    expect((await a.post('/events', base)).body.error).toBe('rate_limited');
  });
});

describe('RSVP', () => {
  test('capacity, FIFO waitlist, promotion on leave, host notified', async () => {
    const w = await world();
    const host = await w.member('noor');
    const [b, c, d] = [await w.member('bob'), await w.member('cyd'), await w.member('dia')];
    const ev = await create(host, { capacity: 1 });

    expect((await host.post(`/events/${ev.id}/rsvp`)).body.error).toBe('host_rsvp');
    expect((await b.post(`/events/${ev.id}/rsvp`)).body.my).toEqual({ status: 'going', waitlistPosition: null, attended: false });
    expect((await c.post(`/events/${ev.id}/rsvp`)).body.my).toMatchObject({ status: 'waitlisted', waitlistPosition: 1 });
    expect((await d.post(`/events/${ev.id}/rsvp`)).body.my).toMatchObject({ status: 'waitlisted', waitlistPosition: 2 });
    expect((await d.post(`/events/${ev.id}/rsvp`)).body.my.waitlistPosition).toBe(2); // idempotent

    const detail = (await b.get(`/events/${ev.id}`)).body;
    expect(detail).toMatchObject({ goingCount: 1, waitlistCount: 2, waitlist: null });
    expect(detail.going.map((p: any) => p.handle)).toEqual(['bob']);
    expect((await host.get(`/events/${ev.id}`)).body.waitlist.map((p: any) => p.handle)).toEqual(['cyd', 'dia']);
    expect(await w.kinds(host)).toEqual(['event_rsvp']); // only "going" RSVPs ping the host

    await b.del(`/events/${ev.id}/rsvp`);
    expect((await c.get(`/events/${ev.id}`)).body.my.status).toBe('going');
    expect(await w.kinds(c)).toEqual(['event_promoted']);
    expect((await d.get(`/events/${ev.id}`)).body.my.waitlistPosition).toBe(1);

    // b rejoins at the back of the line
    expect((await b.post(`/events/${ev.id}/rsvp`)).body.my).toMatchObject({ status: 'waitlisted', waitlistPosition: 2 });
  });

  test('RSVP-only location is shown to the host and going members only', async () => {
    const w = await world();
    const host = await w.member('noor');
    const [b, c] = [await w.member('bob'), await w.member('cyd')];
    const ev = await create(host, { capacity: 1, locationRsvpOnly: true, location: '12 Birch Lane, flat 3' });

    expect((await host.get(`/events/${ev.id}`)).body.location).toBe('12 Birch Lane, flat 3');
    const before = (await b.get(`/events/${ev.id}`)).body;
    expect([before.location, before.locationHidden]).toEqual([null, true]);
    expect((await b.get('/events')).body.items[0].location).toBeNull();

    expect((await b.post(`/events/${ev.id}/rsvp`)).body.location).toBe('12 Birch Lane, flat 3');
    expect((await c.post(`/events/${ev.id}/rsvp`)).body.location).toBeNull(); // waitlisted
  });
});

describe('host controls', () => {
  test('only the host edits; capacity changes promote; time changes notify', async () => {
    const w = await world();
    const host = await w.member('noor');
    const [b, c, d] = [await w.member('bob'), await w.member('cyd'), await w.member('dia')];
    const ev = await create(host, { capacity: 2 });
    for (const x of [b, c, d]) await x.post(`/events/${ev.id}/rsvp`);

    expect((await b.patch(`/events/${ev.id}`, { title: 'Mine now' })).body.error).toBe('not_host');
    expect((await host.patch(`/events/${ev.id}`, { capacity: 1 })).body.error).toBe('capacity_below_going');
    expect((await host.patch(`/events/${ev.id}`, { endsAt: inDays(2) })).body.error).toBe('event_invalid'); // before start

    const up = (await host.patch(`/events/${ev.id}`, { capacity: null, title: 'Market walk (open)' })).body;
    expect(up).toMatchObject({ title: 'Market walk (open)', capacity: null, goingCount: 3, waitlistCount: 0 });
    expect(await w.kinds(d)).toEqual(['event_promoted']);

    await host.patch(`/events/${ev.id}`, { startsAt: inDays(4), location: 'North gate' });
    for (const x of [b, c, d]) expect((await w.kinds(x))[0]).toBe('event_updated');
    const n = (await b.get('/notifications')).body.items[0];
    expect(n.event).toEqual({ id: ev.id, title: 'Market walk (open)' });
  });

  test('cancel notifies everyone and closes RSVPs', async () => {
    const w = await world();
    const host = await w.member('noor');
    const [b, c] = [await w.member('bob'), await w.member('cyd')];
    const ev = await create(host, { capacity: 1 });
    await b.post(`/events/${ev.id}/rsvp`);
    await c.post(`/events/${ev.id}/rsvp`);

    expect((await b.del(`/events/${ev.id}`)).body.error).toBe('not_host');
    const cancelled = (await host.del(`/events/${ev.id}`)).body;
    expect(cancelled.cancelledAt).toBeString();
    expect([cancelled.canEdit, cancelled.rsvpOpen]).toEqual([false, false]);
    expect((await w.kinds(b))[0]).toBe('event_cancelled');
    expect((await w.kinds(c))[0]).toBe('event_cancelled');
    expect((await c.post(`/events/${ev.id}/rsvp`)).body.error).toBe('event_cancelled');
    expect((await b.get('/events')).body.items).toEqual([]);
    expect((await b.get(`/events/${ev.id}`)).status).toBe(200); // still viewable from the notification
  });
});

describe('attendance', () => {
  test('host confirms attendees → contributions for both; un-confirming takes them back', async () => {
    const w = await world();
    const host = await w.member('noor');
    const [b, c] = [await w.member('bob'), await w.member('cyd')];
    const ev = await create(host);
    await b.post(`/events/${ev.id}/rsvp`);
    await c.post(`/events/${ev.id}/rsvp`);

    expect((await host.post(`/events/${ev.id}/attendance`, { handles: ['bob'] })).body.error).toBe('attendance_closed');
    await w.startNow(ev.id);
    expect((await b.del(`/events/${ev.id}/rsvp`)).body.error).toBe('event_started');
    expect((await b.post(`/events/${ev.id}/attendance`, { handles: ['bob'] })).body.error).toBe('not_host');
    expect((await host.post(`/events/${ev.id}/attendance`, { handles: ['zed'] })).body.error).toBe('not_attendee');

    const r = (await host.post(`/events/${ev.id}/attendance`, { handles: ['BOB'] })).body;
    expect([r.attendedCount, r.canConfirmAttendance]).toEqual([1, true]);
    const contrib = async () => (await w.rowsOf(sql`
      select u.handle, c.kind from contributions c join users u on u.id = c.user_id
       where c.kind like 'event_%' order by u.handle`)).map((x) => `${x.handle}:${x.kind}`);
    expect(await contrib()).toEqual(['bob:event_attended', 'noor:event_hosted']);
    expect((await b.get(`/events/${ev.id}`)).body.my.attended).toBe(true);

    await host.post(`/events/${ev.id}/attendance`, { handles: ['cyd'] });
    expect(await contrib()).toEqual(['cyd:event_attended', 'noor:event_hosted']);
    await host.post(`/events/${ev.id}/attendance`, { handles: [] });
    expect(await contrib()).toEqual([]);

    await w.startNow(ev.id, 24 * 15);
    expect((await host.post(`/events/${ev.id}/attendance`, { handles: ['bob'] })).body.error).toBe('attendance_closed');
  });

  test('attending counts toward clearing a lurker flag', async () => {
    const w = await world();
    const host = await w.member('noor');
    const b = await w.member('bob');
    const ev = await create(host);
    await b.post(`/events/${ev.id}/rsvp`);
    await w.t.db.execute(sql`update users set state = 'flagged_lurker', lurker_flagged_at = now() - interval '1 minute' where handle = 'bob'`);
    await w.startNow(ev.id);
    await host.post(`/events/${ev.id}/attendance`, { handles: ['bob'] });
    expect((await b.get('/me')).body.lurker.contributions).toBe(1);
  });
});
