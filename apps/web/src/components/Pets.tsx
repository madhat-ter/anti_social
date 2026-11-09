'use client';
/**
 * RFC §10.17: Pet Corner. A pet is a content identity owned by one member; it writes posts as
 * itself ("Max • pet of @mira"). The right rail shows the newest pet posts, /pets is the same feed
 * on narrow screens, and /pet/<id> is a pet's own page.
 */
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { api, errorMessage, type Author, type Me, type Pet, type PetPost, type PetSpecies } from '@/lib/api';
import { relativeTime } from '@/lib/hooks';
import { Avatar } from './Avatar';
import { PetAvatar } from './PetAvatar';
import { Composer } from './Composer';
import { ErrorNote } from './ui';
import { Loading, Win } from './retro';

const SPECIES: { key: PetSpecies; label: string }[] = [
  { key: 'dog', label: 'Dog' },
  { key: 'cat', label: 'Cat' },
  { key: 'bird', label: 'Bird' },
];
const LABELS = { everyday: 'Everyday', advice: 'Advice', health: 'Health', help: 'Help' } as const;

export function PetLabelTag({ label }: { label: PetPost['label'] }) {
  return <span className={`tag pet-label ${label}`}>{LABELS[label]}</span>;
}

/* ─── a card in the feed ─────────────────────────────────────────────────── */

export function PetCard({ post, onChanged, full = false }: {
  post: PetPost; onChanged?: (p: PetPost) => void; full?: boolean;
}) {
  const [liked, setLiked] = useState(post.likedByMe);
  const [count, setCount] = useState(post.likeCount);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const href = `/pet/${post.pet.id}`;

  async function toggleLike() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = liked ? await api.unlike(post.id) : await api.like(post.id);
      setLiked(r.likedByMe); setCount(r.likeCount);
      onChanged?.({ ...post, likedByMe: r.likedByMe, likeCount: r.likeCount });
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <article className={`pet-card${full ? ' full' : ''}`}>
      <header className="pet-head">
        <Link href={href} className="pet-face-link"><PetAvatar pet={post.pet} size={full ? 44 : 34} label={`${post.pet.name}, a ${post.pet.species}`} /></Link>
        <div className="pet-who">
          <Link href={href} className="pet-name">{post.pet.name}</Link>
          <span className="meta">pet of <Link href={`/u/${post.pet.owner.handle}`}>@{post.pet.owner.handle}</Link></span>
        </div>
        <PetLabelTag label={post.label} />
      </header>
      {/* a photo post reads like the feed's photo cards: the picture first, the words under it */}
      {post.images.length > 0 && (
        <div className={`pet-imgs n${Math.min(post.images.length, 4)}`}>
          {post.images.slice(0, full ? 4 : 1).map((img) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={img.id} src={img.url} alt="" width={img.width} height={img.height} />
          ))}
        </div>
      )}
      {post.body && <p className="body pet-body">{post.body}</p>}
      <footer className="pet-foot">
        <button type="button" className={`link-btn like${liked ? ' on' : ''}`} onClick={() => void toggleLike()} disabled={busy} aria-pressed={liked}>
          {liked ? '♥' : '♡'} {count !== null ? count : 'Like'}
        </button>
        <Link href={href} className="link-btn">{post.replyCount ? `${post.replyCount} ${post.replyCount === 1 ? 'reply' : 'replies'}` : 'Reply'}</Link>
        <span className="grow" />
        <time className="meta" dateTime={post.createdAt}>{relativeTime(post.createdAt)}</time>
      </footer>
      {err && <ErrorNote message={err} />}
    </article>
  );
}

/* ─── the right rail ─────────────────────────────────────────────────────── */

export function PetCorner({ me }: { me: Me }) {
  const [items, setItems] = useState<PetPost[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api.pets(null, 4).then(
      (r) => { if (alive) setItems(r.items); },
      (e) => { if (alive) setErr(errorMessage(e)); },
    );
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <Win title="pet_corner" as="section" bodyClassName="stack pet-corner">
      {err && <ErrorNote message={err} />}
      {items === null ? <p className="ui muted">Loading…</p>
        : items.length === 0 ? (
          <p className="muted small">
            No pets yet. <Link href={`/u/${me.handle}`}>Add yours on your profile</Link>.
          </p>
        ) : (
          <ul className="pet-list">
            {items.map((p) => <li key={p.id}><PetCard post={p} /></li>)}
          </ul>
        )}
      <Link className="ui" href="/pets">All pets</Link>
    </Win>
  );
}

/* ─── the full feed (phones and its own page) ────────────────────────────── */

export function PetsIndex() {
  const [items, setItems] = useState<PetPost[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let alive = true;
    api.pets().then(
      (r) => { if (alive) { setItems(r.items); setCursor(r.nextCursor); } },
      (e) => { if (alive) setErr(errorMessage(e)); },
    );
    return () => { alive = false; };
  }, []);

  async function loadMore() {
    setMore(true); setErr(null);
    try {
      const r = await api.pets(cursor);
      setItems((cur) => [...(cur ?? []), ...r.items]);
      setCursor(r.nextCursor);
    } catch (e) { setErr(errorMessage(e)); } finally { setMore(false); }
  }

  if (err && !items) return <ErrorNote message={err} />;
  if (!items) return <Loading />;
  return (
    <>
      <h1>Pet Corner</h1>
      <p className="meta">The room's pets, newest first. Every pet belongs to a member; the member is shown under its name.</p>
      <ErrorNote message={err} />
      {items.length === 0
        ? <p className="empty">No pets yet. Add one on your profile.</p>
        : <ul className="pet-grid">{items.map((p) => <li key={p.id}><PetCard post={p} full /></li>)}</ul>}
      {cursor && <div className="row"><button type="button" className="btn" onClick={() => void loadMore()} disabled={more}>{more ? 'Loading…' : 'More pets'}</button></div>}
    </>
  );
}

/* ─── add / edit a pet ───────────────────────────────────────────────────── */

function randomVariant() { return Math.floor(Math.random() * 1_000_000); }

export function PetDialog({ open, initial, onClose, onSaved }: {
  open: boolean;
  /** present = edit that pet; absent = add one */
  initial?: Pet | null;
  onClose: () => void;
  onSaved: (pet: Pet) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [species, setSpecies] = useState<PetSpecies>('dog');
  const [variant, setVariant] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // reset the form each time the window opens
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setSpecies(initial?.species ?? 'dog');
    setVariant(initial?.avatar.variant ?? randomVariant());
    setAvatarUrl(initial?.avatar.url ?? null);
    setAvatarId(null);
    setRemoveAvatar(false);
    setPreview(null);
    setErr(null);
  }, [open, initial]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function pick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    if (!file.type.startsWith('image/')) { setErr('Choose an image.'); return; }
    const local = URL.createObjectURL(file);
    setPreview(local); setRemoveAvatar(false);
    setBusy(true);
    api.upload(file).then(
      (img) => { setAvatarId(img.id); setAvatarUrl(img.url); },
      (e) => { setErr(errorMessage(e)); setPreview(null); },
    ).finally(() => setBusy(false));
  }

  async function save() {
    if (busy) return;
    if (!name.trim()) { setErr('Give the pet a name.'); return; }
    setBusy(true); setErr(null);
    try {
      const body = {
        name: name.trim(), species,
        ...(avatarId ? { avatarId } : {}),
        ...(!avatarId && (removeAvatar || !avatarUrl) ? { avatarVariant: variant } : {}),
        ...(removeAvatar ? { removeAvatar: true } : {}),
      };
      const pet = initial ? await api.updatePet(initial.id, body) : await api.createPet(body);
      onSaved(pet);
      onClose();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  const shownUrl = preview ?? (removeAvatar ? null : avatarUrl);
  const previewPet = { species, avatar: { variant, url: shownUrl }, name };

  return (
    <dialog ref={ref} className="dlg" aria-labelledby={`${id}-t`}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="win pet-dialog">
        <div className="win-bar">
          <button type="button" className="win-close" onClick={onClose} aria-label="Close" />
          <span className="win-title" id={`${id}-t`}>{initial ? `edit_${initial.name.toLowerCase()}.txt` : 'add_pet.txt'}</span>
        </div>
        <div className="win-body stack">
          <div className="pet-preview">
            <PetAvatar pet={previewPet} size={96} label="The pet's face" />
            <div className="stack">
              <button type="button" className="link-btn" onClick={() => { setVariant(randomVariant()); setRemoveAvatar(true); setPreview(null); }}>
                Another look
              </button>
              <input ref={fileRef} id={`${id}-photo`} type="file" accept="image/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
              <label htmlFor={`${id}-photo`} className="link-btn">{shownUrl ? 'Change photo' : 'Add a photo'}</label>
              {shownUrl && <button type="button" className="link-btn" onClick={() => { setPreview(null); setAvatarId(null); setAvatarUrl(null); setRemoveAvatar(true); }}>Use a drawn face</button>}
            </div>
          </div>
          <label>Name
            <input value={name} maxLength={40} placeholder="Max" onChange={(e) => setName(e.target.value)} autoFocus required />
          </label>
          <fieldset className="pet-species">
            <legend>What are they?</legend>
            <div className="kinds">
              {SPECIES.map((s) => (
                <button key={s.key} type="button" role="radio" aria-checked={species === s.key}
                  className={`kind-opt${species === s.key ? ' on' : ''}`} onClick={() => setSpecies(s.key)}>
                  <span className="pet-kind-icon"><PetAvatar pet={{ species: s.key, avatar: { variant, url: null } }} size={40} /></span>
                  {s.label}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="muted small">Endless drawn faces per species; a photo replaces the drawing. Pets do not take a seat and cannot sign in.</p>
          <ErrorNote message={err} />
          <div className="row dlg-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => void save()} disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : initial ? 'Save' : 'Add pet'}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

/** The pets on a profile, with Add Pet for the owner (RFC §10.17). */
export function PetsRow({ pets, mine, onChange }: { pets: Pet[]; mine: boolean; onChange: (pets: Pet[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pf-hero-side">
      {pets.length > 0 && (
        <ul className="pet-row" aria-label="Pets">
          {pets.map((p) => (
            <li key={p.id}>
              <Link href={`/pet/${p.id}`} title={`${p.name}, pet of @${p.owner.handle}`}>
                <PetAvatar pet={p} size={44} label={`${p.name}, a ${p.species}`} />
                <span>{p.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {mine && <button type="button" className="btn pet-add" onClick={() => setOpen(true)}>+ Add pet</button>}
      <PetDialog open={open} onClose={() => setOpen(false)} onSaved={(pet) => onChange([...pets, pet])} />
    </div>
  );
}

/* ─── a pet's own page ───────────────────────────────────────────────────── */

function PetReplies({ post, onCount }: { post: PetPost; onCount: (n: number) => void }) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<{ id: string; body: string; createdAt: string; author: Author | null }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.thread(post.id).then(
      (t) => { if (alive) setReplies(t.replies.map((r) => ({ id: r.id, body: r.body, createdAt: r.createdAt, author: r.author }))) },
      (e) => { if (alive) setErr(errorMessage(e)); },
    );
    return () => { alive = false; };
  }, [open, post.id, post.replyCount]);

  return (
    <div className="pet-replies">
      <button type="button" className="link-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {post.replyCount ? `${post.replyCount} ${post.replyCount === 1 ? 'reply' : 'replies'}` : 'Reply'}
      </button>
      {open && (
        <div className="pet-thread">
          {err && <ErrorNote message={err} />}
          {replies?.map((r) => (
            <div key={r.id} className="pet-reply">
              {r.author ? <Avatar seed={r.author.handle} gender={r.author.gender} size={24} /> : <span className="avatar blank" />}
              <div className="stack">
                <span className="meta">
                  {r.author ? <Link href={`/u/${r.author.handle}`}>@{r.author.handle}</Link> : 'deleted user'} · {relativeTime(r.createdAt)}
                </span>
                <p className="body">{r.body}</p>
              </div>
            </div>
          ))}
          <Composer parentId={post.id} placeholder={`Reply to ${post.pet.name}...`} submitLabel="Reply"
            onCreated={(p) => { setReplies((cur) => [...(cur ?? []), { id: p.id, body: p.body, createdAt: p.createdAt, author: p.author }]); onCount(post.replyCount + 1); }} />
        </div>
      )}
    </div>
  );
}

export function PetPage({ id, me }: { id: string; me: Me }) {
  const [pet, setPet] = useState<Pet | null>(null);
  const [posts, setPosts] = useState<PetPost[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let alive = true;
    api.pet(id).then(
      (r) => { if (alive) { setPet(r.pet); setPosts(r.posts); } },
      (e) => { if (alive) setErr(errorMessage(e)); },
    );
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    const d = confirmRef.current;
    if (!d) return;
    if (confirm && !d.open) d.showModal();
    if (!confirm && d.open) d.close();
  }, [confirm]);

  if (err) return <ErrorNote message={err} />;
  if (!pet || !posts) return <Loading />;
  const mine = pet.owner.handle.toLowerCase() === me.handle.toLowerCase();

  async function removePet() {
    setBusy(true); setErr(null);
    try { await api.deletePet(pet!.id); window.location.assign(`/u/${pet!.owner.handle}`); }
    catch (e) { setErr(errorMessage(e)); setBusy(false); }
  }

  return (
    <>
      <Win title={`${pet.name.toLowerCase().replace(/\s+/g, '_')}.pet`} as="article" bodyClassName="stack pet-page-head">
        <div className="pet-hero">
          <PetAvatar pet={pet} size={112} label={`${pet.name}, a ${pet.species}`} />
          <div className="stack grow">
            <h1>{pet.name}</h1>
            <p className="meta">
              {pet.species} · pet of <Link href={`/u/${pet.owner.handle}`}>@{pet.owner.handle}</Link>
            </p>
          </div>
          {mine && (
            <div className="row pet-actions">
              <button type="button" className="btn" onClick={() => setEdit(true)}>Edit</button>
              <button type="button" className="btn" onClick={() => setConfirm(true)}>Delete</button>
            </div>
          )}
        </div>
      </Win>

      {mine && posts.length === 0 && (
        <p className="meta">Say hello for {pet.name}: post their first update below.</p>
      )}
      {mine && (
        <Composer pet={pet} onCreated={() => {
          // the API returns the member-shaped post; reload the pet's list to get the pet card
          api.pet(id).then((r) => { setPet(r.pet); setPosts(r.posts); }, () => {});
        }} />
      )}

      {posts.length === 0
        ? <p className="empty">{mine ? 'Nothing from this pet yet.' : `No updates from ${pet.name} yet.`}</p>
        : <ul className="pet-page-list">{posts.map((p) => (
          <li key={p.id}>
            <PetCard post={p} full onChanged={(np) => setPosts((cur) => cur?.map((x) => x.id === np.id ? np : x) ?? null)} />
            <div className="pet-under">
              <PetReplies post={p} onCount={(n) => setPosts((cur) => cur?.map((x) => x.id === p.id ? { ...x, replyCount: n } : x) ?? null)} />
              {mine && (
                <button type="button" className="link-btn" onClick={async () => {
                  try { await api.deletePost(p.id); setPosts((cur) => cur?.filter((x) => x.id !== p.id) ?? null); }
                  catch (e) { setErr(errorMessage(e)); }
                }}>Delete post</button>
              )}
              {!mine && p.canReport && (
                <button type="button" className="link-btn" onClick={async () => {
                  try { await api.flagPost(p.id); setErr('Reported. An admin will look.'); }
                  catch (e) { setErr(errorMessage(e)); }
                }}>Report</button>
              )}
            </div>
          </li>
        ))}</ul>}

      <PetDialog open={edit} initial={pet} onClose={() => setEdit(false)} onSaved={setPet} />

      <dialog ref={confirmRef} className="dlg" aria-labelledby={`${id}-del`}
        onCancel={(e) => { e.preventDefault(); setConfirm(false); }}
        onClick={(e) => { if (e.target === confirmRef.current) setConfirm(false); }}>
        <div className="win">
          <div className="win-bar"><span className="win-title" id={`${id}-del`}>delete_pet.txt</span></div>
          <div className="win-body stack">
            <p>Delete <strong>{pet.name}</strong> and all {posts.length} of their posts? This cannot be undone.</p>
            <ErrorNote message={err} />
            <div className="row dlg-actions">
              <button type="button" className="btn" onClick={() => setConfirm(false)}>Keep {pet.name}</button>
              <button type="button" className="btn primary" onClick={() => void removePet()} disabled={busy}>{busy ? 'Deleting…' : 'Delete pet'}</button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
