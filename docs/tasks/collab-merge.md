# One Collab: events, activities, projects (to build)

> **Status (2026-11-11): decided, not built.** Every product decision is settled and recorded in
> **RFC §10.21** (`docs/rfc/0001-architecture.md`). This file is the build plan. Follow it as
> written; where it and the RFC disagree, the RFC wins, and say so in your report.

**For the agent building this (Command Code or Claude).** Read `AGENTS.md`, then RFC §10.5 (how
collabs and events work today), §10.9, §10.20 and §10.21 (what changes). Then read this file to
the end before touching code. The owner answered 30 questions; do not re-ask them, and do not
add features that are not here. If something is truly missing, choose the option that is
smallest and easiest to undo, and list it under "Calls I made" in your report.

## The job in one paragraph

Events and Collabs are two separate places today (`/events`, `/collabs`, two phone tabs). Make
them one place called **Collab** holding three kinds: **Event** (once, a time and a place),
**Activity** (ongoing, no end) and **Project** (a team with roles and a finish). One tab, one
**+ Start** button, one short form per kind with one "More options" fold, one card shape, one
join button whose words change. Keep every capability that exists today.

## Decisions (owner's answers, all accepted)

| # | Decision |
|---|---|
| Q1 | Event = happens once (RSVP, size limit, waitlist). Activity = ongoing group, no end; its dated get-togethers are events inside it. Project = team, roles, a finish → portfolio drafts. |
| Q2 | Phone bar: **Feed, Collab, Members, You**. Freed slot stays empty. Desktop menu matches. |
| Q3 | One **+ Start** → three choices with one line each → short form for that kind. |
| Q4 | Collab page order: Coming up → For you → chips (All · Events · Activities · Projects) + interest filter. (Q20 puts **Yours** above all of it.) |
| Q5 | Every existing collab becomes a **Project**; the host can switch it. |
| Q6 | **Plan a meetup** stays: team only by default, or anyone (then it is in Coming up). |
| Q7 | Activity ↔ Project can switch in Edit; an Event never switches. |
| Q8 | Activity: no size limit unless the host sets one. |
| Q9 | Default joining: Activity open, Project ask to join. Host can change either. |
| Q10 | Activity states: Running → Ended. Ended = readable, joining closed, no portfolio draft. |
| Q11 | At most 3 open activities and projects together per host. Events not counted. |
| Q12 | Profile tab: activities/projects someone is in + events they **host**. Never events they only go to. |
| Q13 | Posting (lurker) rule unchanged. |
| Q14 | Desktop side window and the feed's end card say **Coming up** and list the same things as the page's strip. |
| Q15 | Events get **co-hosts**: edit, accept requests, invite, mark attendance. |
| Q16 | **Make it regular** on a host's past event: new Activity filled in from it, inviting everyone who came. |
| Q17 | The three choices carry examples: *A picnic on Saturday* / *A Sunday run club* / *Making a zine together*. |
| Q18 | One page; basics up front; everything else in **one** "More options" fold (never nested); all editable later. |
| Q19 | Activity has a plain **"When we meet"** line. No repeating-event engine. Dated sign-ups = Plan a meetup. |
| Q20 | **Yours** strip at the top (host / in / going / requests waiting on you), shown only when non-empty. |
| Q21 | One card shape, small kind label, second line per kind (see "Cards"). |
| Q22 | Activity → Project is refused when the activity has more than 20 people; Edit explains why. |
| Q23 | **Run it again** next to Make it regular: new event filled in, only the date to set. |
| Q24 | One join button, words follow the rules (see "The join button"). In → **You're in ✓** → tap → *Leave*. |
| Q25 | Project roles are **slots**; asking, you may tap the role you'd take; page shows "illustrator: @handle"; all slots filled or team full → **Team set** by itself; host can reopen. |
| Q26 | Requests: reminder to whoever decides at 3 days; closed at 7 days; the person is told "it wasn't answered in time", never "declined". |
| Q27 | Quiet nudge, once per quiet spell: project after 3 weeks ("Finish it, keep going, or close?"), activity after 6 weeks ("Keep it running, or end it?"). |
| Q28 | One-time strip for members from before: "Events and Collabs are one place now." Closing is saved to the account. |
| Q29 | Portfolio drafts only for the team at the finish (unchanged). |
| Q30 | Commit each step; take before/after screenshots; **push once at the end, after the owner has seen the screenshots and said OK.** |

## Calls already made (follow these; the owner can overrule them)

These were not asked. They follow from the answers above, chosen to be the smallest change.

1. **Data stays in two tables.** `events` stays as it is; `collabs` gains a `kind`
   (`activity` | `project`). No rename of API routes (`/events`, `/collabs` stay); only the web
   addresses change. Fewer moving parts, the same tests keep meaning.
2. **Activity status reuses the existing values**: `recruiting` = *Running*, `finished` =
   *Ended*. `closed` ("team set") is project-only. Labels come from kind + status.
3. **A full activity** (its optional cap reached) shows a disabled **Full** button. Activities
   have no waitlist.
4. **A host leaving an activity** hands over to the longest-standing co-host, else the
   longest-standing member. Leaving as the only person ends it. Projects keep today's rule.
5. **No kind switching once finished or ended**: drafts have already been handed out.
6. **Activity → Project** sets the team size to the larger of 5 and the current headcount, at
   most 20. **Project → Activity** turns *Team set* back into *Running* and keeps the team size as
   the activity's cap, which the host can clear.
7. **Team set does not undo itself** when someone leaves; the host taps **Recruit again**.
   Recruit again on a project whose team is at its size says: "Raise the team size in Edit
   first." Recruit again also checks the 3-open limit (today it doesn't).
8. **Co-hosts on events** must be going; the host picks them from the going list. Cancelling
   the event stays with the host. The `event_hosted` contribution stays the host's only, so the
   posting rule is unchanged (Q13).
9. **Make it regular** only appears on standalone events, not meetups. It invites people whose
   attendance was confirmed, or everyone who was going if none was confirmed. It skips the host,
   and those invites don't count against the 20-open-invites limit.
10. **Run it again** keeps a meetup a meetup (same collab, same audience) if you're still on the
    team.
11. **Requests on an event that has started** close at the start, with the same "not answered
    in time" message.
12. **"Nothing new"** (Q27) means no update post, no one joining, no meetup planned and no edit.
    "Keep going" or "Keep it running" just records the answer; the nudge comes back only after
    another full quiet spell.
13. **Past events and finished or ended things** are behind one link at the foot of the list,
    **Past and finished**, not in a chip.
14. **Detail pages move** to `/collab/event/<id>` and `/collab/<id>`. Old addresses forward
    permanently, and internal links are updated to the new ones.

## Data: migration `0032_collab_kinds.sql`

The highest migration today is `packages/db/drizzle/0031_consult_approval.sql`. Recent ones are
**hand-written SQL plus a hand-added entry in `packages/db/drizzle/meta/_journal.json`**:
`idx: 32`, `version: "7"`, a `when` later than 1794232000000, `tag: "0032_collab_kinds"`,
`breakpoints: true`. There are no snapshot files after 0026; don't add one. Separate statements
with `--> statement-breakpoint` and use `if not exists` where it applies. Mirror every change in
`packages/db/src/schema.ts`.

- `collabs`:
  - add `kind text not null default 'project'`, check `kind in ('activity','project')`. Existing
    rows become projects (Q5).
  - add `meets text not null default ''`, check `char_length(meets) <= 120` (the "When we
    meet" line).
  - make `team_max` nullable. Replace `collabs_team_max` with `(kind = 'project' and team_max
    between 2 and 20) or (kind = 'activity' and (team_max is null or team_max between 2 and
    1000))`.
  - add check: `kind = 'project' or status in ('recruiting','finished')`.
  - add `quiet_nudged_at timestamptz`.
- `collab_members`: add `slot text` (the role they took, or null).
- `collab_requests`: add `slot text`, `reminded_at timestamptz`. Status gains `'expired'`
  (there is no check constraint today; keep it that way or add one listing all values).
- `event_requests`: add `reminded_at timestamptz`; status gains `'expired'`.
- New `event_hosts (event_id uuid → events on delete cascade, user_id uuid → users on delete
  cascade, added_at timestamptz default now(), primary key (event_id, user_id))`. This table holds
  co-hosts only; `events.host_id` is still the host.
- `users`: add `collab_intro_seen_at timestamptz`, then `set default now()`. Existing members
  stay null and see the one-time strip (Q28); new members get a value and never see it.

Shared constants (`packages/shared/src/rules.ts`): `COLLAB_KINDS`, `COLLAB_MEETS_MAX = 120`,
`ACTIVITY_SIZE_MAX = 1000`, `REQUEST_REMIND_DAYS = 3`, `REQUEST_EXPIRE_DAYS = 7`,
`QUIET_PROJECT_DAYS = 21`, `QUIET_ACTIVITY_DAYS = 42`. `COLLAB_HOSTING_MAX = 3` now counts
activities and projects with status `recruiting`.

## API (`apps/api`)

Where things live today: `src/routes/events.ts`, `src/lib/events.ts`, `src/routes/collabs.ts`,
`src/lib/collabs.ts`, `src/lib/feed.ts`, `src/lib/updates.ts`, `src/lib/push.ts`,
`src/routes/social.ts` (notifications), `src/lib/moderation.ts`, `src/lib/jobs.ts`.

**Collabs**
- `checkFields` (`lib/collabs.ts` ~L189):
  - accepts `kind` and `meets`; `meets` is required for an activity.
  - `teamMax` is required for a project (2–20, form default 5) and optional for an activity
    (2–1000 or null).
  - joinMode defaults to `open` for an activity and `approve` for a project.
  - interests 1–5 for both, as today.
- `createCollab`: the hosting limit counts both kinds with status `recruiting`. It also accepts
  `fromEventId` for Make it regular (call 9). Check the caller hosts that event, it has started
  and it isn't a meetup, then send the invites in the same transaction.
- `updateCollab`:
  - Kind switch with calls 5 and 6; Activity → Project with more than 20 members fails with
    409 `too_big_for_project`.
  - Reopening goes through the limit check and call 7 (409 `team_full`).
  - The first `finished` still calls `offerDrafts`, for projects only.
- Joining (`joinCollab`, `decideRequest`, invite accept):
  - Accept an optional `slot`. It must be one of the project's roles and not yet taken; a taken
    slot is silently dropped to null on accept.
  - After anyone joins a project: if members ≥ `team_max`, or every role is taken, set status
    `closed` (Team set).
  - An activity at its cap refuses to join with 409 `full`.
- `leaveCollab`: call 4 for activities.
- `setTeamRole` or a new `POST /collabs/:id/members/:handle/slot {slot|null}` lets managers give
  or change a member's slot.
- `GET /collabs`: accept `kind`. New `GET /collab?kind=all|event|activity|project&interest=&done=0|1&cursor=`
  returns one list of `{type:'event', …AnEvent} | {type:'collab', …CollabSummary}`, newest
  created first, with a keyset cursor on `(created_at, id)`. `done=0` gives upcoming events plus
  activities and projects not finished; `done=1` gives past events plus finished and ended ones.
  Use the existing visibility rules (`eventVisible`, the hidden-collab filter).
- `GET /me/collab` (the **Yours** strip; `/me/` is already closed to visitors) returns
  `{ hosting, in, going, waiting }`:
  - `hosting`: upcoming events you host or co-host, and open activities and projects you host or
    co-host.
  - `in`: activities and projects where you're a plain member.
  - `going`: upcoming events, going or waitlisted.
  - `waiting`: `{type, id, title, count}` of pending requests on things you manage.
- `GET /members/:handle/events`: events that person hosts. Upcoming first, then the latest 10
  past. Respect `eventVisible`. Add it next to `GET /members/:handle/collabs`; don't change that
  endpoint's shape.

**Events**
- Co-hosts: `POST /events/:id/cohosts {handle}` (host only, target must be going) and
  `DELETE /events/:id/cohosts/:handle`. Add one `canManage(event, me)` = host or co-host, and use
  it for PATCH, request decisions, suggestions, invites and attendance. DELETE (cancel) stays
  host only. `hostView`/`toEvent` return `cohosts` and `canManage`.
- `GET /events/:id` returns what the web needs for **Run it again** (it already returns every
  field). Run it again is web-only: it prefills a new form.

**Jobs** (`lib/jobs.ts`; add one job `collab_sweep`, every hour, idempotent like the others)
- Requests at 3 days, `reminded_at is null`: one notification `requests_waiting {collabId|eventId,
  title, count}` to each manager per thing, then set `reminded_at`.
- Requests at 7 days, or a pending event request once its event has started: set status
  `expired` and send `request_expired {collabId|eventId, title}` to the person who asked.
- Quiet nudge:
  - Projects with status `recruiting` or `closed` and nothing new (call 12) for 21 days;
    activities with status `recruiting` for 42 days.
  - Skip any collab whose `quiet_nudged_at` is newer than its last activity.
  - Send `collab_quiet {collabId, title, kind}` to the host and set `quiet_nudged_at`.
- "Last activity" = the greatest of `collabs.updated_at`, its newest update post, its newest
  `collab_members.joined_at` and its newest meetup's `created_at`.

**Notifications and push.** New kinds: `requests_waiting`, `request_expired`, `collab_quiet`. Add
them to `describePush` (`lib/push.ts` ~L67). Point every push URL at the new web addresses
(`/collab/event/<id>`, `/collab/<id>`).

**Intro strip.** `GET /me` exposes `collabIntroSeen: boolean`, and
`POST /me/collab-intro/dismiss` sets `collab_intro_seen_at = now()`.

**Visitors** (RFC §10.8): reads stay open as today, and every new write is already refused by
`app.ts`. `GET /me/collab` is covered by `CLOSED_TO_VISITORS`.

## Web (`apps/web`; read `apps/web/AGENTS.md` first: this Next.js has breaking changes)

**Addresses**

| New | Was |
|---|---|
| `/collab` (the page; `?kind=event\|activity\|project`, `?interest=`, `?done=1`) | `/events`, `/collabs` |
| `/collab/new` (the three choices) and `/collab/new?kind=…` (the form; `&collab=<id>` = meetup, `&from=<eventId>` = Run it again / Make it regular) | `/events/new`, `/collabs/new` |
| `/collab/event/<id>`, `/collab/event/<id>/edit` | `/events/<id>`, `/events/<id>/edit` |
| `/collab/<id>`, `/collab/<id>/edit` | `/collabs/<id>`, `/collabs/<id>/edit` |

- Add `redirects()` to `apps/web/next.config.ts` (it has none today), all `permanent: true`.
  List the most specific first:
  - `/events/new` → `/collab/new?kind=event`
  - `/events/:id/edit` → `/collab/event/:id/edit`
  - `/events/:id` → `/collab/event/:id`
  - `/events` → `/collab?kind=event`
  - `/collabs/new` → `/collab/new`
  - `/collabs/:id/edit` → `/collab/:id/edit`
  - `/collabs/:id` → `/collab/:id`
  - `/collabs` → `/collab`
- Move the page files; don't copy them. Update every internal link: `Rail.tsx`, `Feed.tsx`
  (`EndCard`, `EventLine`), `PostCard.tsx` (~L398), `app/p/[id]/page.tsx` (~L66), the
  notification links (`app/notifications/page.tsx` ~L133-143) and the admin links
  (`app/admin/page.tsx` ~L434).
- `Visitor.tsx` `MEMBERS_ONLY`: add `collab/new`.

**Navigation**
- `PhoneBar.tsx` `ROOMS` becomes Feed, **Collab** (icon: reuse the collabs drawing), Members,
  then the You tab. Fix the header comment ("four tabs: three rooms and you").
- `Shell.tsx` `items`: replace Events and Collabs with one **Collab** (`/collab`) in the same
  spot; keep the order of everything else.
- Leave the header (`.top`) alone.

**The Collab page** (`app/collab/page.tsx`), top to bottom:
1. **One-time strip** (Q28), only while `collabIntroSeen` is false: "Events and Collabs are one
   place now." with a close button that calls the dismiss endpoint.
2. **+ Start** (the page's one primary button) → `/collab/new`.
3. **Yours** (from `GET /me/collab`): a compact row, dated items first. A "N requests waiting"
   chip for each entry in `waiting`. Hidden when everything is empty, and for visitors.
4. **Coming up**: the next 5 events (`GET /events?scope=upcoming&limit=5`), soonest first. When
   there are none: "Nothing coming up. Start one?"
5. **For you**: up to 6 from `GET /collabs?tab=for-you`. Hidden when empty.
6. Chips **All · Events · Activities · Projects** (one choice at a time; chips filter, they never
   navigate) + the existing interest select, over the `GET /collab` list with `usePaged`. At the
   foot, **Past and finished** → `?done=1`.
- Hide the side window `coming_up` on `/collab*`, as `next_events` was hidden on `/events*`
  (§10.9: no window repeats its page).

**Start** (`app/collab/new/page.tsx`): with no `kind`, show three big choices:
- **Event**: "Happens once." *A picnic on Saturday.*
- **Activity**: "Keeps going." *A Sunday run club.*
- **Project**: "Has a finish." *Making a zine together.*

Each one goes to `?kind=…`.

**Forms** (Q18; reshape `EventForm` in `Events.tsx` and `CollabForm` in `Collabs.tsx`; the
activity and project forms share `CollabForm` with a `kind` prop). There is exactly **one**
`<details>` "More options". It opens by itself when editing something that already has a value
inside it, or when a validation error is inside it. The existing "Cost" fold folds into it; do
not nest folds.

| Kind | Up front | In "More options" |
|---|---|---|
| Event | Title, Starts, Where, "What is it?" | Ends, size limit, "only show the place to people going", who can come (anyone / ask with a note), what to bring or know, interests, price note + link |
| Activity | Title, **When we meet** (required, ≤ 120, placeholder "Sundays 7am, by the lake"), "What is it?", interests (1–5) | size limit (empty = no limit), joining (open / ask), requirements, price note + link, cover |
| Project | Title, "What is it, and what will you make together?", **Looking for** (roles), interests (1–5) | team size (default 5), joining (ask / open), requirements, price note + link, cover |

- **Meetups** (`?collab=<id>`) keep today's "Only the team / Anyone" choice up front.
- The **Edit** page of an activity or project adds "Kind: Activity / Project" inside More options
  and shows the Q22 / call 5 explanation instead of failing silently.
- **Prefill.** `?from=<eventId>` with `kind=event` (Run it again) copies everything except the
  dates. With `kind=activity` (Make it regular) it copies the title, description, interests,
  requirements and price, leaves "When we meet" empty, and sends `fromEventId`.

**Cards**: one `CollabItemCard` for all three, used on the Collab page, Yours, the profile tab and
For you.
- **Top line**: a small kind label (`event` / `activity` / `project`, in the UI face), then the
  title and the cover if there is one.
- **Second line** (`.meta`):
  - Event: the date chip and time, then "3 spots left", "Full · join the waitlist", or nothing
    when there's no limit.
  - Activity: "Sundays 7am · 12 in", or "Ended".
  - Project: "Looking for illustrator, printer · 3 of 6" (open slots only), "Team set · 6 of 6",
    or "Finished".
- Keep the existing date rules (§10.9 "Dates") and "zeros are invitations".

**The join button** (Q24): one `JoinButton` used on cards that have room for it and on the detail
pages. Its words:

| Situation | Event | Activity | Project |
|---|---|---|---|
| Can just join | **I'm going** | **Join** | **Join** (open mode) |
| Must ask | **Ask to come** | **Ask to join** | **Ask to join** (taps a slot, optional, then a note) |
| Full | **Join the waitlist** | **Full** (disabled, says why via `why()`) | Team set: no button |
| Asked, waiting | **Asked ✓** → *Withdraw* | same | same |
| In | **You're in ✓** (waitlisted: **On the waitlist ✓**) → *Leave* | **You're in ✓** → *Leave* | **You're in ✓** → *Leave* |

- An invite still shows its banner with Accept; accepting skips the ask.
- Visitors get the greyed button with `why()`, as now (`useReadOnly()`).

**Detail pages**
- **Event** (`/collab/event/[id]`):
  - The facts list shows "Hosts: @a, @b".
  - Co-host controls sit in the going list's row menu ("Make co-host" / "Remove as co-host") and
    are visible to the host only.
  - On a past event the host gets **Run it again** and **Make it regular** (standalone events
    only, call 9) as buttons beside the existing ones.
  - Managers (host and co-hosts) get Edit, requests, invites and attendance.
  - The host also gets **Cancel event**.
- **Activity / project** (`/collab/[id]`):
  - The status buttons follow the kind: a project gets Stop recruiting / Recruit again / Mark
    finished; an activity gets **End it**, with a confirm, as for any destructive step (§10.20).
  - A project lists its slots: "illustrator: @handle" / "printer: open".
  - When `collab_quiet` is the latest unanswered nudge, the host sees a strip under the title:
    - project: "Quiet for 3 weeks. **Mark finished** · **Keep going** · **Delete**"
    - activity: "Quiet for 6 weeks. **Keep it running** · **End it**"
- The `⋯` menu keeps only Leave, Report, Delete and Remove (admin) (§10.20).

**Elsewhere**
- `Rail.tsx`: rename `NextEvents` and its window title to `coming_up`. Its links go to the new
  addresses, "All" goes to `/collab?kind=event`, and the empty state goes to `/collab/new?kind=event`.
- `Feed.tsx`: the end card's line reads "Coming up: …". Leave the feed's rules alone (§10.11).
- Profile (`app/u/[handle]/page.tsx` ~L81, L112-122): the tab label becomes **Collab**. It lists
  `memberCollabs` plus `GET /members/:handle/events`, using `CollabItemCard`.
- Notifications page: wording and links for the three new kinds:
  - `requests_waiting`: "2 people are waiting to join **title**"
  - `request_expired`: "Your request to join **title** wasn't answered in time."
  - `collab_quiet`: the Q27 question
- Copy that names "Events" or "Collabs" as places becomes "Collab": `settings/page.tsx` ~L180 and
  ~L193, `feed-rules/page.tsx` ~L29, `app/page.tsx` ~L84, `Welcome.tsx` ~L31, `PushToggle.tsx`
  ~L78, `Checklist.tsx` ~L21.
- `apps/web/src/lib/api.ts`: types and methods for everything above, plus the new error codes
  (`too_big_for_project`, `team_full`, `full`) in plain words.
- Light by default, every colour a CSS variable (`globals.css`), no `prefers-color-scheme`.

## Build order: one commit per step

Commit with `git commit -F <file>` (UTF-8 without BOM). Run `git log --oneline -1` after each
commit. **Do not push until step 8.**

0. **Before screenshots first, on the untouched code.** Write `scripts/screenshots-collab-merge.ts`
   (stack in AGENTS.md → Screenshots; members made by the script must `PUT /me/setup` and join
   with `POST /auth/join` and a PIN). Seed one event, one project-style collab with roles and a
   meetup, and one member with interests. It must work in both modes: with `SHOTS=before` it
   visits today's pages, without it the new ones. Output goes to
   `.screenshots/collab-merge-before/` and `…-after/`, with the same file names for the same
   scene:
   - `01-list-phone`, `02-list-desktop`, `03-start`, `04-form-event`, `05-form-project`,
     `06-event-page`, `07-project-page`, `08-profile-tab`, `09-feed-rail`, `10-phone-tabbar`
   - after only: `11-form-activity`, `12-activity-page`, `13-yours-strip`, `14-join-button-states`,
     `15-start-choices`

   Take the before set now, then commit the script.
1. **Migration + schema + shared constants** (`0032_collab_kinds.sql`, journal, `schema.ts`,
   `rules.ts`). Run `bun run typecheck` and `bun run test`; nothing should change in behaviour yet.
2. **API: collab kinds.** kind, meets, activity size, default join modes, kind switching, the
   hosting limit, slots, auto Team set, activity leaving. Tests.
3. **API: events.** co-hosts, `canManage`, Make it regular (`fromEventId`). Tests.
4. **API: the page's data.** `GET /collab`, `GET /me/collab`, `GET /members/:handle/events`, the
   intro flag. Tests.
5. **API: the sweep job + notifications + push URLs.** Tests (call the job's `run` directly after
   back-dating rows in SQL).
6. **Web: addresses, redirects, navigation, the Collab page, Start, forms, cards, join button.**
7. **Web: detail pages, profile tab, rail, feed end card, notifications, copy.** Then fix the other
   screenshot scripts that assert old paths or labels: `screenshots-phone.ts` (~L153 asserts the
   tab labels; ~L214-239 tap Events and Collabs), `screenshots-desktop.ts` (~L162 checks
   `next_events` is absent on `/events`), `screenshots-latest.ts` (~L177-178).
   `screenshots-latest` scenes: `07-events` becomes `07-collab` and `08-collabs` becomes
   `08-collab-start`; update the name list in `AGENTS.md` to match.
8. **Docs, after screenshots, then stop.**
   - Update RFC §11 (API table) with the new endpoints.
   - In `AGENTS.md`, add a rule under "Product rules that are easy to break": "**Collab is one
     place** (§10.21): three kinds, one Start, one More options fold, one join button. Don't add
     Events or Collabs back as separate tabs."
   - Mark this file's status "done".
   - Run `bun scripts/screenshots-collab-merge.ts` (after) and `bun scripts/screenshots-latest.ts`.
   - **Show the owner the before/after pairs and wait for their OK.** Then push once and run
     `curl -sI https://anti-social-opal.vercel.app/api/health`. A 502 with
     `X-Render-Routing: no-deploy` means push an empty commit (`git commit --allow-empty`).

After the build, stop the :3100 server: find every process whose command line matches
`start -p 3100` and stop it. Then run `git checkout -- apps/web/tsconfig.json` if the build edited
it.

## Tests

- New `apps/api/test/collab-merge.test.ts`:
  - Kinds and defaults.
  - `meets` required for an activity.
  - Activity with no cap and with a cap (409 `full`).
  - Kind switching: >20 refused, finished refused, call 6 values.
  - Hosting limit across both kinds, including on Recruit again.
  - Slots: a taken slot dropped on accept, a manager setting a slot.
  - Auto Team set by size and by slots; `team_full` on reopen.
  - Activity host leaving (call 4).
  - Event co-hosts: what they may and may not do (cancel).
  - Make it regular: attended first, else going; host skipped; over 20 invites allowed;
    meetup refused.
  - `GET /collab` filters, `done`, cursor and visibility (team-only meetup, hidden collab).
  - `GET /me/collab` groups.
  - `GET /members/:handle/events` hides team-only meetups from outsiders.
  - The sweep: reminder once at 3 days, expired at 7, expired at event start, quiet nudge once
    per spell for each kind.
  - Intro flag: old member false → dismissed true; new member true.
  - Visitors can't call the new writes or `GET /me/collab`.
- Update `collabs.test.ts` and `events.test.ts` where behaviour changed, and nowhere else. Keep
  `feed.test.ts`, `visitors.test.ts`, `contact.test.ts` and `setup.test.ts` passing.
- `bun run typecheck` and `bun run test` from the root. `lifecycle` and `payments` can time out
  under the full suite on a busy machine; run them on their own before calling it a failure.
- Look at the after screenshots in both themes (light by default; dark only via Settings).

## Leave alone

- The feed's rules (§10.11, §10.12, §10.15), the header (`.top`), faces (`Avatar.tsx`), pet
  drawings, consultations (§10.6, §10.18), mentions (§10.16), the lurker rule's SQL.
- `COST.xlsx`, `reports/`, `research_notes/`, `.env*`. Never commit or link them; the repo is
  public.
- No new feature that isn't listed here: no recurring events, no ranking, no "Mine" chip, no
  "+ New" in the tab bar.

## Done means

- The phone shows four tabs; `/events…` and `/collabs…` addresses land on the right new pages,
  and old notifications still open the right thing.
- A member can start each kind in three taps plus typing, and every option from before is still
  reachable through one fold.
- Every Q1–Q30 behaviour above can be seen in the app or tests.
- Typecheck and tests pass. The before/after pairs and `.screenshots/latest/` are updated, and the
  owner has said OK before the single push.
