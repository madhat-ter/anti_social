'use client';
/**
 * RFC §10.24, the File: a member's drawer of 12 pages, drawn like a filing drawer. The seven own
 * tabs stand at the back ("Me" nearest, open by default), the five tabs for cards other members
 * made stand at the front, and the open page's card lies between them. Tapping the card opens it
 * full screen: headline, a swipeable photo carousel, description; tapping a photo shows it whole,
 * as a polaroid with its caption.
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { FILE } from '@anti/shared';
import { api, errorMessage, IMAGE_MAX_BYTES, type FileCard, type FilePage, type FilePhoto, type FileView } from '@/lib/api';
import { AlertDialog, Loading, Win } from './retro';
import { Avatar } from './Avatar';
import { ErrorNote } from './ui';
import { useReadOnly } from './Visitor';

const firstName = (s: string) => s.split(/\s+/)[0] || s;
/** the back of the drawer, top to bottom: pages 1–6, then "Me" right behind the open sheet */
const BACK = [1, 2, 3, 4, 5, 6, 0];
const FRONT = [7, 8, 9, 10, 11];
/** where a page stands in the drawer, back (0) to front (11): flipping goes the way a real one does */
const DRAWER = [...BACK, ...FRONT];
const depthOf = (pos: number) => DRAWER.indexOf(pos);
/** the leaving page goes when its animation ends; this is only the fallback if that never fires */
const FLIP_MS = 1500;

export function FileDrawer({ handle, pub = false }: {
  handle: string;
  /** the public share page: no sign-in, nothing to edit, only what was made public */
  pub?: boolean;
}) {
  const readOnly = useReadOnly();
  const [file, setFile] = useState<FileView | null>(null);
  const [spare, setSpare] = useState<FileCard[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(0);
  const [full, setFull] = useState(false);
  const [editing, setEditing] = useState<{ card: FileCard | null; page: number | null; forHandle?: string; choose?: boolean } | null>(null);
  const [deleting, setDeleting] = useState<FileCard | null>(null);
  /** cards other members made for you, waiting for your yes (yours alone to see) */
  const [tray, setTray] = useState<FileCard[]>([]);
  /** cards you made for other members */
  const [made, setMade] = useState<FileCard[]>([]);
  const [viewing, setViewing] = useState<FileCard | null>(null);
  const [declining, setDeclining] = useState<FileCard | null>(null);
  const [reporting, setReporting] = useState<FileCard | null>(null);
  const [removing, setRemoving] = useState<FileCard | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /**
   * The flip between pages, like a card file: going to a page further back, the open page tips
   * forward toward you and falls away; going to one further front, the new page swings up from
   * lying toward you. `from` is the page that is leaving.
   */
  const [flip, setFlip] = useState<{ from: number; dir: 'back' | 'front'; n: number } | null>(null);
  const flipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flipTimer.current) clearTimeout(flipTimer.current); }, []);
  const flipTo = (pos: number) => {
    if (pos === open) return;
    if (flipTimer.current) clearTimeout(flipTimer.current);
    setFlip((cur) => ({ from: open, dir: depthOf(pos) < depthOf(open) ? 'back' : 'front', n: (cur?.n ?? 0) + 1 }));
    setOpen(pos);
    flipTimer.current = setTimeout(() => setFlip(null), FLIP_MS);
  };

  const load = useCallback(async () => {
    try {
      const f = pub ? await api.publicFile(handle) : await api.file(handle);
      setFile(f);
      if (f.mine) {
        const [own, waiting, mine] = await Promise.all([api.myFileCards(), api.fileTray(), api.fileMade()]);
        setSpare(own.items.filter((c) => c.page === null));
        setTray(waiting.items);
        setMade(mine.items);
      }
      setErr(null);
    } catch (e) { setErr(errorMessage(e)); }
  }, [handle, pub]);
  useEffect(() => { void load(); }, [load]);

  /** run a change, then read the File again */
  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try { await fn(); await load(); }
    catch (e) { setErr(errorMessage(e)); }
  };

  if (!file && err && pub) return <p className="file-empty">This File is not shared, or the link is wrong.</p>;
  if (!file) return err ? <ErrorNote message={err} /> : <Loading />;
  const canEdit = file.mine && !readOnly;
  const page = file.pages[open]!;
  /** a card from the tray goes on the open page if that is an empty gift page, else the first empty one */
  const putInFile = (c: FileCard) => {
    const free = page.side === 'gift' && !page.card ? page : file.pages.find((p) => p.side === 'gift' && !p.card);
    if (!free) { setErr('All five pages for cards made for you are full. Take one off first.'); return; }
    void act(async () => { await api.setFilePage(free.position, { cardId: c.id }); flipTo(free.position); });
  };
  const who = file.mine ? 'Your' : `${firstName(file.owner.displayName)}’s`;

  if (editing) {
    return (
      <CardEditor
        initial={editing.card} page={editing.page} forHandle={editing.forHandle ?? null} choose={!!editing.choose}
        onCancel={() => setEditing(null)}
        onSaved={async () => { setEditing(null); await load(); }}
      />
    );
  }

  const tab = (pos: number, i: number) => {
    const p = file.pages[pos]!;
    // an empty page opens only for its owner; "Me" always opens
    const usable = !!p.card || canEdit || pos === 0;
    const text = p.label || (canEdit && !p.card ? '+' : '');
    return (
      <div key={pos} className={`file-folder ${i % 2 ? 'r' : 'l'}`} style={{ '--depth': pos === 0 || pos >= FILE.ownPages ? 0 : BACK.length - 1 - i } as React.CSSProperties}>
        <button
          type="button" role="tab" id={`file-tab-${pos}`} aria-selected={open === pos} aria-controls="file-sheet"
          className={`file-tab${open === pos ? ' on' : ''}${p.card ? '' : ' empty'}`}
          disabled={!usable}
          aria-label={p.label ? `${p.label}${p.card ? '' : ' (empty)'}` : `Page ${pos + 1}${p.card ? '' : ' (empty)'}`}
          onClick={() => flipTo(pos)}
        >
          {text}
        </button>
      </div>
    );
  };

  return (
    <div className="stack file-page">
      <div className="row between">
        <h1 className={pub ? 'file-pub-h' : undefined}>
          {pub && <Avatar seed={file.owner.handle} gender={file.owner.gender} size={52} />}
          {who} File
        </h1>
        {canEdit && <button type="button" className="btn primary" onClick={() => setEditing({ card: null, page: null, choose: true })}>+ Make a card</button>}
        {!file.mine && !readOnly && !pub && (
          <button type="button" className="btn primary" onClick={() => setEditing({ card: null, page: null, forHandle: file.owner.handle })}>
            + Make a card for {firstName(file.owner.displayName)}
          </button>
        )}
      </div>
      <ErrorNote message={err} />
      {note && <p className="meta" role="status">{note}</p>}

      {canEdit && tray.length > 0 && (
        <Win title="made_for_you" dark bodyClassName="stack">
          <p className="muted small">
            {tray.length === 1 ? 'Someone made a card for you.' : `${tray.length} cards were made for you.`} Only you can see them here.
            Put one in your File (the last five pages), or turn it down: nobody is told either way unless you put it in.
          </p>
          <ul className="file-spare">
            {tray.map((c) => (
              <li key={c.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.photos[0] && <img src={c.photos[0].url} alt="" />}
                <span className="file-spare-h">{c.headline} <span className="muted small">by @{c.maker?.handle}</span></span>
                <button type="button" className="link-btn" onClick={() => setViewing(c)}>Look</button>
                <button type="button" className="link-btn" onClick={() => putInFile(c)}>Put in my File</button>
                <button type="button" className="link-btn danger-text" onClick={() => setDeclining(c)}>Turn down</button>
                <button type="button" className="link-btn" onClick={() => setReporting(c)}>Report</button>
              </li>
            ))}
          </ul>
        </Win>
      )}

      <div className="file" role="tablist" aria-label={`${who} File: 12 pages`}>
        <div className="file-back">{BACK.map(tab)}</div>
        <div className={`file-sheet-wrap${flip ? ` flipping flip-${flip.dir}` : ''}`}>
          {/* the page that is leaving, drawn once more while it falls (it can't be clicked) */}
          {flip && file.pages[flip.from] && (
            <div key={`leaf-${flip.n}`} className="file-sheet file-leaf-out" aria-hidden="true" inert
              onAnimationEnd={(e) => { if (e.target === e.currentTarget) setFlip(null); }}>
              <Sheet page={file.pages[flip.from]!} canEdit={canEdit} mine={file.mine} spare={spare} tray={tray}
                owner={firstName(file.owner.displayName)} onOpen={() => {}} onMake={() => {}} onPlace={() => {}} />
            </div>
          )}
          <div key={flip ? `page-${open}-${flip.n}` : `page-${open}`} className={`file-sheet${flip ? ' file-leaf-in' : ''}`}
            id="file-sheet" role="tabpanel" aria-labelledby={`file-tab-${open}`}>
            <Sheet page={page} canEdit={canEdit} mine={file.mine} spare={spare} tray={tray} owner={firstName(file.owner.displayName)}
              onOpen={() => setFull(true)}
              onMake={() => setEditing({ card: null, page: page.position })}
              onPlace={(c) => void act(() => api.setFilePage(page.position, { cardId: c.id }))} />
          </div>
        </div>
        <div className="file-front">{FRONT.map(tab)}</div>
        <div className="file-box" aria-hidden="true"><span className="file-pull"><i /><i /><i /></span></div>
      </div>

      {canEdit && (
        <PageTools
          page={page}
          onLabel={(label) => act(() => api.setFilePage(page.position, { label }))}
          onEdit={() => page.card && setEditing({ card: page.card, page: null })}
          onTakeOff={() => void act(() => api.setFilePage(page.position, { cardId: null }))}
          onDelete={() => page.card && setDeleting(page.card)}
          onMove={(by) => {
            const order = [1, 2, 3, 4, 5, 6];
            const i = order.indexOf(page.position);
            const j = i + by;
            if (i < 0 || j < 0 || j >= order.length) return;
            [order[i], order[j]] = [order[j]!, order[i]!];
            void act(async () => { await api.orderFilePages(order); flipTo(j + 1); });
          }}
        />
      )}

      {canEdit && spare.length > 0 && (
        <Win title="not_in_your_file" bodyClassName="stack">
          <p className="muted small">Cards you made that are not on a page ({spare.length} of {FILE.draftsMax}). Open an empty page of yours to put one there.</p>
          <ul className="file-spare">
            {spare.map((c) => (
              <li key={c.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.photos[0] && <img src={c.photos[0].url} alt="" />}
                <span className="file-spare-h">{c.headline}</span>
                <button type="button" className="link-btn" onClick={() => setEditing({ card: c, page: null })}>Edit</button>
                <button type="button" className="link-btn danger-text" onClick={() => setDeleting(c)}>Delete</button>
              </li>
            ))}
          </ul>
        </Win>
      )}

      {canEdit && made.length > 0 && (
        <Win title="cards_you_made_for_others" bodyClassName="stack">
          <ul className="file-spare">
            {made.map((c) => (
              <li key={c.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.photos[0] && <img src={c.photos[0].url} alt="" />}
                <span className="file-spare-h">
                  {c.headline}{' '}
                  <span className="muted small">
                    {c.state === 'draft' ? `Draft for @${c.for?.handle ?? '…'}: not sent yet`
                      : c.state === 'placed' ? `In @${c.for?.handle}’s File`
                      : `Sent to @${c.for?.handle ?? '…'}: not in their File`}
                  </span>
                </span>
                {c.state === 'draft' && <button type="button" className="link-btn" onClick={() => void act(() => api.sendFileCard(c.id))}>Send</button>}
                <button type="button" className="link-btn" onClick={() => setEditing({ card: c, page: null })}>Edit</button>
                <button type="button" className="link-btn danger-text" onClick={() => setDeleting(c)}>Delete</button>
              </li>
            ))}
          </ul>
        </Win>
      )}

      {(viewing ?? page.card) && (
        <FullCard
          card={(viewing ?? page.card)!} label={viewing ? `from @${viewing.maker?.handle ?? ''}` : page.label}
          open={full || !!viewing} onClose={() => { setFull(false); setViewing(null); }}
          onReport={pub || readOnly ? undefined : (c) => { setFull(false); setViewing(null); setReporting(c); }}
          onRemove={pub ? undefined : (c) => { setFull(false); setViewing(null); setRemoving(c); }}
        />
      )}
      {/* RFC §10.24: reports and admin removal, as for posts */}
      <AlertDialog open={!!reporting} title="Report card" confirmLabel="Report"
        message={<>Report <strong>{reporting?.headline}</strong> to the admins? Five reports hide a card until an admin decides.</>}
        input={{ label: 'Why (optional)', placeholder: 'Why (optional)', maxLength: 200 }}
        onConfirm={(reason) => {
          const c = reporting; setReporting(null);
          if (c) void act(async () => { await api.flagFileCard(c.id, reason || undefined); setNote('Reported. An admin will look at it.'); });
        }}
        onCancel={() => setReporting(null)} />
      <AlertDialog open={!!removing} title="Remove card" danger confirmLabel="Remove" focusCancel
        message={<>Remove <strong>{removing?.headline}</strong> for good? Its photos are erased and its maker is told an admin removed it.</>}
        onConfirm={() => { const c = removing; setRemoving(null); if (c) void act(async () => { await api.opsRemoveFileCard(c.id); setNote('Removed.'); }); }}
        onCancel={() => setRemoving(null)} />
      <AlertDialog open={!!declining} title="Turn down" confirmLabel="Turn it down" focusCancel
        message={<>Turn down <strong>{declining?.headline}</strong>? It leaves your tray for good. @{declining?.maker?.handle} is not told.</>}
        onConfirm={() => { const c = declining; setDeclining(null); if (c) void act(() => api.declineFileCard(c.id)); }}
        onCancel={() => setDeclining(null)} />
      <AlertDialog open={!!deleting} title="Delete card" danger confirmLabel="Delete" focusCancel
        message={<>Delete <strong>{deleting?.headline}</strong> and its photos? This cannot be undone.</>}
        onConfirm={() => { const c = deleting; setDeleting(null); if (c) void act(() => api.deleteFileCard(c.id)); }}
        onCancel={() => setDeleting(null)} />
    </div>
  );
}

/** The open page: its card as a preview you tap, or what an empty page says. */
function Sheet({ page, canEdit, mine, spare, tray, owner, onOpen, onMake, onPlace }: {
  page: FilePage; canEdit: boolean; mine: boolean; spare: FileCard[]; tray: FileCard[]; owner: string;
  onOpen: () => void; onMake: () => void; onPlace: (c: FileCard) => void;
}) {
  const c = page.card;
  if (c) {
    const n = c.photos.length;
    return (
      <button type="button" className="file-card" onClick={onOpen} aria-label={`Open the card: ${c.headline}`}>
        <span className="file-card-h">{c.headline}</span>
        <span className="file-card-body">
          <span className="file-card-pic">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {c.photos[0] && <img src={c.photos[0].url} alt="" />}
            {n > 1 && <span className="file-card-n">1 / {n}</span>}
          </span>
          <span className="file-card-text">{c.description || <span className="muted">No description.</span>}</span>
        </span>
        {c.hidden && <span className="error">Hidden after reports: other members cannot see this card until an admin decides.</span>}
        <span className="file-card-foot ui">
          {page.side === 'gift' && c.maker ? `Made by @${c.maker.handle} · ` : ''}Tap to open
        </span>
      </button>
    );
  }
  if (!canEdit) {
    return <p className="file-empty muted">{mine ? 'This page is empty.' : `${owner} has not put a card here yet.`}</p>;
  }
  if (page.side === 'gift') {
    return (
      <div className="file-empty stack">
        <p><b>Empty.</b> This page is for a card someone else made for you.</p>
        {tray.length === 0
          ? <p className="muted small">The last five pages can only hold cards other members made for you. Nothing is waiting yet.</p>
          : (
            <div className="stack" style={{ gap: '.4rem' }}>
              <p className="muted small">Waiting for your yes:</p>
              {tray.map((s) => (
                <button key={s.id} type="button" className="link-btn file-put" onClick={() => onPlace(s)}>Put “{s.headline}” by @{s.maker?.handle} here</button>
              ))}
            </div>
          )}
      </div>
    );
  }
  return (
    <div className="file-empty stack">
      <p><b>Empty.</b> {page.position === 0 ? 'This is your “Me” page: the one people see first.' : 'Add a card to this page.'}</p>
      <div className="row"><button type="button" className="btn primary" onClick={onMake}>+ Make a card for this page</button></div>
      {spare.length > 0 && (
        <div className="stack" style={{ gap: '.4rem' }}>
          <p className="muted small">Or put one you already made here:</p>
          {spare.map((s) => (
            <button key={s.id} type="button" className="link-btn file-put" onClick={() => onPlace(s)}>Put “{s.headline}” here</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The owner's tools for the open page: its name, its place in the drawer, its card. */
function PageTools({ page, onLabel, onEdit, onTakeOff, onDelete, onMove }: {
  page: FilePage; onLabel: (label: string) => Promise<void>; onEdit: () => void; onTakeOff: () => void; onDelete: () => void;
  onMove: (by: -1 | 1) => void;
}) {
  const [label, setLabel] = useState(page.label);
  useEffect(() => { setLabel(page.label); }, [page.label, page.position]);
  const nameable = page.side === 'own' && page.position !== 0;
  if (!nameable && !page.card) return null;
  return (
    <Win title="this_page" bodyClassName="stack">
      {nameable && (
        <form className="row file-label" onSubmit={(e) => { e.preventDefault(); void onLabel(label); }}>
          <label>Tab name <span className="counter">{label.length}/{FILE.labelMax}</span>
            <input value={label} maxLength={FILE.labelMax} placeholder="COFFEE" onChange={(e) => setLabel(e.target.value)} />
          </label>
          <button type="submit" className="btn" disabled={label.trim() === page.label}>Save name</button>
          <span className="row" style={{ gap: '.3rem' }}>
            <button type="button" className="btn" disabled={page.position <= 1} onClick={() => onMove(-1)} aria-label="Move this page back">← Move</button>
            <button type="button" className="btn" disabled={page.position >= FILE.ownPages - 1} onClick={() => onMove(1)} aria-label="Move this page forward">Move →</button>
          </span>
        </form>
      )}
      {page.card && (
        <div className="row">
          {page.card.mine && <button type="button" className="btn" onClick={onEdit}>Edit card</button>}
          <button type="button" className="btn" onClick={onTakeOff}>{page.side === 'gift' ? 'Take it off (back to your tray)' : 'Take it off this page'}</button>
          {page.card.mine && <button type="button" className="btn danger" onClick={onDelete}>Delete card</button>}
        </div>
      )}
    </Win>
  );
}

/** The card, full screen: headline, the carousel, the description. */
function FullCard({ card, label, open, onClose, onReport, onRemove }: {
  card: FileCard; label: string; open: boolean; onClose: () => void;
  /** offered when the viewer may report this card / is an admin who may remove it */
  onReport?: (c: FileCard) => void; onRemove?: (c: FileCard) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const id = useId();
  const [at, setAt] = useState(0);
  const [pola, setPola] = useState<FilePhoto | null>(null);
  const n = card.photos.length;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setAt(0); setPola(null); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);

  const go = (i: number) => {
    const s = strip.current;
    if (!s) return;
    const to = Math.max(0, Math.min(n - 1, i));
    s.scrollTo({ left: to * s.clientWidth, behavior: 'smooth' });
  };
  // Esc closes the polaroid first, then the card
  const back = () => { if (pola) setPola(null); else onClose(); };

  return (
    <dialog ref={ref} className="dlg file-full" aria-labelledby={`${id}-h`}
      onCancel={(e) => { e.preventDefault(); back(); }}
      onClick={(e) => { if (e.target === ref.current) back(); }}
      onKeyDown={(e) => { if (pola) return; if (e.key === 'ArrowRight') go(at + 1); if (e.key === 'ArrowLeft') go(at - 1); }}
    >
      <div className="win">
        <div className="win-bar">
          <button type="button" className="win-close" onClick={onClose} aria-label="Close card" />
          <span className="win-title">{label || 'card'}</span>
        </div>
        <div className="file-full-body">
          <h2 className="file-full-h" id={`${id}-h`}>{card.headline}</h2>
          <div className="file-full-pics">
            <div className="file-car" ref={strip} aria-roledescription="carousel" aria-label={`${n} photos`}
              onScroll={(e) => { const s = e.currentTarget; setAt(Math.round(s.scrollLeft / Math.max(1, s.clientWidth))); }}>
              {card.photos.map((p, i) => (
                <button key={p.id} type="button" className="file-car-item" onClick={() => setPola(p)}
                  aria-label={`Photo ${i + 1} of ${n}${p.caption ? `: ${p.caption}` : ''}. Open it whole.`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption} loading={i === 0 ? 'eager' : 'lazy'} />
                </button>
              ))}
            </div>
            {n > 1 && (
              <div className="file-car-bar">
                <button type="button" className="icon-btn" onClick={() => go(at - 1)} disabled={at === 0} aria-label="Previous photo">◀</button>
                <span className="file-dots" aria-hidden="true">
                  {card.photos.map((p, i) => <i key={p.id} className={i === at ? 'on' : undefined} />)}
                </span>
                <span className="ui file-count">{at + 1} / {n}</span>
                <button type="button" className="icon-btn" onClick={() => go(at + 1)} disabled={at === n - 1} aria-label="Next photo">▶</button>
              </div>
            )}
          </div>
          <div className="file-full-text">
            {card.description ? <p>{card.description}</p> : <p className="muted">No description.</p>}
            {card.maker && !card.own && <p className="meta">Made by @{card.maker.handle}</p>}
            {card.hidden && <p className="error">Hidden after reports. Only its owner, its maker and admins see it until an admin decides.</p>}
            {((card.canReport && onReport) || (card.canModerate && onRemove)) && (
              <p className="row file-full-acts">
                {card.canReport && onReport && <button type="button" className="link-btn" onClick={() => onReport(card)}>Report</button>}
                {card.canModerate && onRemove && <button type="button" className="link-btn danger-text" onClick={() => onRemove(card)}>Remove (admin)</button>}
              </p>
            )}
          </div>
        </div>
      </div>
      {pola && (
        <div className="file-pola-wrap" onClick={() => setPola(null)} role="presentation">
          <figure className="file-pola" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pola.url} alt={pola.caption} width={pola.width} height={pola.height} />
            <figcaption>{pola.caption || ' '}</figcaption>
            <button type="button" className="file-pola-x" onClick={() => setPola(null)} aria-label="Close photo">×</button>
          </figure>
        </div>
      )}
    </dialog>
  );
}

type Att = { key: string; id: string; preview: string; caption: string; status: 'uploading' | 'done' | 'error'; error?: string };

/** Make or change a card: a headline, 1–20 photos (each with an optional caption), a description. */
function CardEditor({ initial, page, forHandle, choose, onCancel, onSaved }: {
  initial: FileCard | null;
  /** a new card goes straight onto this page */
  page: number | null;
  /** a new card for this member (made from their File) */
  forHandle: string | null;
  /** a new card: ask "for me" or "for someone" */
  choose: boolean;
  onCancel: () => void; onSaved: () => Promise<void>;
}) {
  const id = useId();
  const [target, setTarget] = useState<'me' | 'someone'>(forHandle ? 'someone' : 'me');
  const [who, setWho] = useState<string | null>(forHandle ?? initial?.for?.handle ?? null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ handle: string; displayName: string }[]>([]);
  const [publicOk, setPublicOk] = useState(initial?.publicOk ?? false);
  const sendAfter = useRef(false);
  /** a card for someone else: a new one aimed at them, or an existing one of that kind */
  const gift = initial ? !initial.own : target === 'someone';
  useEffect(() => {
    if (!choose || target !== 'someone' || who) return;
    let alive = true;
    const t = setTimeout(() => { api.mentionMembers(q).then((r) => { if (alive) setFound(r.items); }, () => {}); }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [choose, target, who, q]);
  const [headline, setHeadline] = useState(initial?.headline ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [atts, setAtts] = useState<Att[]>(() => (initial?.photos ?? []).map((p) => ({ key: p.id, id: p.id, preview: p.url, caption: p.caption, status: 'done' as const })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attsRef = useRef<Att[]>([]);
  attsRef.current = atts;
  useEffect(() => () => { attsRef.current.forEach((a) => { if (a.preview.startsWith('blob:')) URL.revokeObjectURL(a.preview); }); }, []);

  const uploading = atts.some((a) => a.status === 'uploading');
  const ready = atts.filter((a) => a.status === 'done');
  const full = atts.length >= FILE.photosMax;

  function pick(files: FileList | null) {
    if (!files) return;
    setErr(null);
    const room = FILE.photosMax - atts.length;
    const chosen = Array.from(files);
    if (chosen.length > room) setErr(`A card holds up to ${FILE.photosMax} photos.`);
    for (const f of chosen.slice(0, Math.max(room, 0))) {
      if (!f.type.startsWith('image/')) { setErr(`"${f.name}" is not an image.`); continue; }
      if (f.size > IMAGE_MAX_BYTES) { setErr(`"${f.name}" is larger than 5 MB.`); continue; }
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setAtts((cur) => [...cur, { key, id: '', preview: URL.createObjectURL(f), caption: '', status: 'uploading' }]);
      api.upload(f).then(
        (im) => setAtts((cur) => cur.map((a) => (a.key === key ? { ...a, id: im.id, status: 'done' } : a))),
        (e) => setAtts((cur) => cur.map((a) => (a.key === key ? { ...a, status: 'error', error: errorMessage(e) } : a))),
      );
    }
    if (fileRef.current) fileRef.current.value = '';
  }
  const move = (i: number, by: -1 | 1) => setAtts((cur) => {
    const j = i + by;
    if (j < 0 || j >= cur.length) return cur;
    const next = [...cur];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  });
  const remove = (key: string) => setAtts((cur) => cur.filter((x) => x.key !== key));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || uploading) return;
    setBusy(true); setErr(null);
    const input = { headline, description, photos: ready.map((a) => ({ id: a.id, caption: a.caption })) };
    try {
      let saved: FileCard;
      if (initial) saved = await api.updateFileCard(initial.id, gift ? { ...input, publicOk } : input);
      else if (gift) saved = await api.createFileCard({ ...input, forHandle: who, publicOk });
      else saved = await api.createFileCard({ ...input, page });
      if (gift && sendAfter.current && saved.state === 'draft') await api.sendFileCard(saved.id);
      await onSaved();
    } catch (x) { setErr(errorMessage(x)); setBusy(false); }
    finally { sendAfter.current = false; }
  }

  return (
    <form onSubmit={submit} className="stack file-page">
      <h1>{initial ? 'Edit card' : gift && who ? `A card for @${who}` : 'Make a card'}</h1>
      <Win title={initial ? 'card/edit' : 'card/new'} as="div" bodyClassName="stack">
        {choose && !initial && (
          <fieldset className="setup-choices">
            <legend className="ui">Who is it for?</legend>
            <label className="check setup-choice">
              <input type="radio" name={`${id}-for`} checked={target === 'me'} onChange={() => setTarget('me')} />
              <span><b>For me</b> <span className="muted small">It goes in your own File.</span></span>
            </label>
            <label className="check setup-choice">
              <input type="radio" name={`${id}-for`} checked={target === 'someone'} onChange={() => setTarget('someone')} />
              <span><b>For someone</b> <span className="muted small">They decide whether it goes in their File.</span></span>
            </label>
            {target === 'someone' && (who
              ? <p className="row">For <b>@{who}</b> <button type="button" className="link-btn" onClick={() => setWho(null)}>Change</button></p>
              : (
                <div className="stack" style={{ gap: '.4rem' }}>
                  <label>Find a member
                    <input value={q} placeholder="Name or handle" onChange={(e) => setQ(e.target.value)} />
                  </label>
                  <div className="row">
                    {found.map((m) => (
                      <button key={m.handle} type="button" className="btn" onClick={() => setWho(m.handle)}>{m.displayName} @{m.handle}</button>
                    ))}
                    {found.length === 0 && <span className="muted small">No one by that name.</span>}
                  </div>
                </div>
              ))}
          </fieldset>
        )}
        {initial && gift && initial.state === 'placed' && (
          <p className="error">This card is in @{initial.for?.handle}&rsquo;s File. Saving a change takes it off until they say yes again.</p>
        )}
        <label>Headline <span className="counter">{headline.length}/{FILE.headlineMax}</span>
          <input value={headline} maxLength={FILE.headlineMax} required placeholder="Things I make on weekends" onChange={(e) => setHeadline(e.target.value)} />
        </label>
        <label>Description <span className="counter">{description.length}/{FILE.descriptionMax}</span>
          <textarea value={description} maxLength={FILE.descriptionMax} rows={6} placeholder="What this card is about." onChange={(e) => setDescription(e.target.value)} />
        </label>

        <section className="stack" aria-labelledby={`${id}-ph`}>
          <div className="row between">
            <h2 id={`${id}-ph`} className="pf-sec-h">Photos</h2>
            <span className="counter">{atts.length}/{FILE.photosMax}</span>
          </div>
          <p className="muted small">At least one. People swipe through them in this order; the first is the one on the page. Each can have its own caption.</p>
          {atts.length > 0 && (
            <ol className="pj-atts file-atts">
              {atts.map((a, i) => (
                <li key={a.key} className={`pj-att ${a.status}`}>
                  <div className="pj-att-pic">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.preview} alt={`Photo ${i + 1}`} />
                    {a.status === 'uploading' && <span className="spinner" role="status" aria-label="Uploading" />}
                    {a.status === 'error' && <span className="thumb-err" title={a.error}>Failed</span>}
                  </div>
                  <div className="pj-att-fields">
                    <label>Caption for photo {i + 1} (optional)
                      <input value={a.caption} maxLength={FILE.captionMax} placeholder="Where, when, who" onChange={(e) => setAtts((cur) => cur.map((x) => (x.key === a.key ? { ...x, caption: e.target.value } : x)))} />
                    </label>
                    <div className="row">
                      <button type="button" className="icon-btn" aria-label={`Move photo ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                      <button type="button" className="icon-btn" aria-label={`Move photo ${i + 1} later`} disabled={i === atts.length - 1} onClick={() => move(i, 1)}>↓</button>
                      <button type="button" className="link-btn danger-text" onClick={() => remove(a.key)}>Remove</button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="row">
            <input ref={fileRef} id={`${id}-file`} type="file" accept="image/*" multiple className="sr-only" disabled={full} onChange={(e) => pick(e.target.files)} />
            <label htmlFor={`${id}-file`} className={`btn attach${full ? ' disabled' : ''}`} aria-disabled={full}>+ Photos</label>
          </div>
        </section>
        {gift && (
          <label className="check">
            <input type="checkbox" checked={publicOk} onChange={(e) => setPublicOk(e.target.checked)} />
            They may show this card on their public share link (outside anti)
          </label>
        )}
        <ErrorNote message={err} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className={gift && (!initial || initial.state === 'draft') ? 'btn' : 'btn primary'}
            disabled={busy || uploading || !headline.trim() || ready.length === 0 || (gift && !who)}>
            {busy ? 'Saving…' : uploading ? 'Uploading…' : gift ? (initial && initial.state !== 'draft' ? 'Save card' : 'Save as draft') : initial ? 'Save card' : page !== null ? 'Add to this page' : 'Save card'}
          </button>
          {gift && (!initial || initial.state === 'draft') && (
            <button type="submit" className="btn primary" onClick={() => { sendAfter.current = true; }}
              disabled={busy || uploading || !headline.trim() || ready.length === 0 || !who}>
              Send to @{who ?? '…'}
            </button>
          )}
        </div>
      </Win>
    </form>
  );
}
