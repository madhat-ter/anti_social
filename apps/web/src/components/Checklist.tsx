'use client';
/**
 * "Finish your profile" (RFC §10.3, Q9/Q17): six things that make this place yours. Inviting is
 * deliberately not one of them: the room stays small and hand-picked. Items tick
 * themselves from what you have actually done; the window nudges, it never blocks. It appears
 * after the house-rules welcome is closed, and closing it is saved to your account.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type ChecklistItem, type ChecklistState, type Me } from '@/lib/api';
import { SuggestDialog } from './Picks';
import { Win } from './retro';

type Item = { key: ChecklistItem; label: string; hint: string; href?: (handle: string) => string; action?: 'pick' | 'post' };
const ITEMS: Item[] = [
  { key: 'headline', label: 'Add a headline', hint: 'One line under your name, like "Industrial designer".', href: (h) => `/u/${h}` },
  { key: 'skills', label: 'Add your skills', hint: 'A few tags for what you are good at.', href: (h) => `/u/${h}` },
  { key: 'project', label: 'Publish a first project', hint: 'Something you made, with pictures.', href: (h) => `/u/${h}/work/new` },
  { key: 'post', label: 'Write a first post', hint: 'Say hello. Everyone reads the same feed.', action: 'post' },
  { key: 'pick', label: 'Suggest a pick', hint: 'A movie, a book, a place or something to eat.', action: 'pick' },
  { key: 'interests', label: 'Pick your interests', hint: 'So people with the same ones can find you for collabs.', href: () => '/settings#interests' },
];

/** `refreshKey` changes when the page knows something got done (a post was written). */
export function Checklist({ me, refreshKey = 0 }: { me: Me; refreshKey?: number }) {
  const [c, setC] = useState<ChecklistState | null>(null);
  const [asking, setAsking] = useState(false);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => { api.checklist().then(setC, () => setC(null)); }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (!c || c.dismissed) return null;
  const done = ITEMS.filter((i) => c.items[i.key]).length;
  if (done === ITEMS.length) return null;

  async function hide() {
    setC((cur) => (cur ? { ...cur, dismissed: true } : cur));
    try { await api.dismissChecklist(); } catch { /* it simply comes back next time */ }
  }
  const writePost = () => {
    const ta = document.querySelector<HTMLTextAreaElement>('#compose textarea');
    ta?.scrollIntoView({ block: 'center' });
    ta?.focus();
  };

  return (
    <Win title="checklist.txt" as="aside" className={`checklist${open ? ' open' : ''}`} onClose={() => void hide()} bodyClassName="stack">
      <div className="row between">
        <h2>Finish your profile</h2>
        <span className="row ck-head">
          <span className="meta">{done} of {ITEMS.length} done</span>
          {/* phones: the list is folded away until asked for (CSS shows this button only there) */}
          <button type="button" className="link-btn ck-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Less' : 'Show'}</button>
        </span>
      </div>
      <ul className="checklist-items">
        {ITEMS.map((i) => {
          const ok = c.items[i.key];
          return (
            <li key={i.key} className={ok ? 'done' : undefined}>
              <span className={`ck${ok ? ' on' : ''}`} aria-hidden="true" />
              <span className="checklist-text">
                <span className="sr-only">{ok ? 'Done: ' : 'To do: '}</span>
                {ok ? <s>{i.label}</s>
                  : i.action === 'pick' ? <button type="button" className="link-btn" onClick={() => setAsking(true)}>{i.label}</button>
                  : i.action === 'post' ? <button type="button" className="link-btn" onClick={writePost}>{i.label}</button>
                  : <Link href={i.href!(me.handle)}>{i.label}</Link>}
                <span className="muted small">{i.hint}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="row dlg-actions">
        <button type="button" className="btn" onClick={() => void hide()}>Hide for good</button>
      </div>
      <SuggestDialog open={asking} onClose={() => setAsking(false)} onCreated={() => { setAsking(false); load(); }} />
    </Win>
  );
}
