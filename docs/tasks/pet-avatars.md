# Open task: draw the pet avatars

**For Claude.** Pet Corner (RFC §10.17) is built, tested and on `main`. The owner is not happy
with one part only: **the drawn pet faces**. Everything else is finished; do not redesign it.

## The job

Replace or tune the generated pet faces so they feel like the owner's reference doodles: loose,
hand-drawn black ink on paper, big rounded heads, wobbly outlines, floppy or pointed ears, dot or
dash eyes, a filled nose, the odd tongue, occasional sparkles; some pets drawn full-body (legs and
tail), some just heads. A dog must read as a dog, a cat as a cat, a bird as a bird at 40 px.
**Every pet should look different**; near-duplicates are the complaint.

The owner has 11 reference doodles in the chat (dogs, cats, birds). Ask for them if they are not
attached; do not invent a different art direction.

## Where it lives

- `apps/web/src/components/PetAvatar.tsx` — the generator: `dog(r)`, `cat(r)`, `bird(r)` and the
  exported `<PetAvatar pet={…} size label />`. Pure SVG, deterministic from `species:variant`.
- `apps/web/app/dev/pets/page.tsx` — the review sheet: 120 spaced variants per species.
- `apps/web/src/components/Avatar.tsx` and `/dev/faces` — the human faces. Match their ink
  language (currentColor, round caps, slight tilt, paper fill), not their geometry.
- `apps/web/src/components/Pets.tsx` — sizes in use: 24–44 px in cards, 96 px in the add window,
  112 px on a pet's page.

## Hard constraints

- SVG only: `currentColor` ink, `var(--paper)` fill, no image assets, no canvas, no libraries.
- Deterministic: the same `species + variant` always draws the same face. Variants go 0…1,000,000.
- Readable at 34 px, good at 112 px; 360 faces render together on `/dev/pets` without lag.
- Keep the component's API, and keep an uploaded photo winning over the drawing.
- Light and dark themes both work (no hard-coded colours).

## What is wrong now

- Too many looks read as abstract blobs rather than a dog/cat/bird.
- Feature combinations repeat; a few shapes dominate the sheet.
- Heads, ears, muzzles and bodies meet awkwardly; the line feels geometric, not inked by hand.

## Acceptance

- `/dev/pets`: 120 per species, visibly varied, no near-duplicates.
- Species is nameable at 40 px without the caption.
- Matches the reference vibe.
- `bun run typecheck`; `cd apps/api; bun test test/pets.test.ts` still passes.
- Before/after screenshots of the three sheets and one pet page, put in `.screenshots/pets/`, and
  **shown to the owner before pushing** (their rule).

## Verify

- Plain dev: `bun run dev`, open http://localhost:3000/dev/pets.
- Screenshot stack: follow AGENTS.md → "Screenshots" (in-process API on :3101, production web build
  on :3100), then capture `/dev/pets` and `/pet/<id>`.

## Leave alone

- The pet data model, labels (Everyday / Advice / Health / Help), Pet Corner feed, profile row,
  notifications, deletion, and the human `Avatar` generator. Only the pet drawing is in scope.
