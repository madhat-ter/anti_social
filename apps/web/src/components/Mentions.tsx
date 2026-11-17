'use client';
/**
 * RFC §10.16: typing @ opens the members list under the box. No mention button: the list is the
 * only way in, and an @word that matches nobody stays plain text. Shared by the post box and a
 * monologue's note, so every place you write works the same way.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Gender } from '@anti/shared';
import { api } from '@/lib/api';
import { Avatar } from './Avatar';

type MentionItem = { handle: string; displayName: string; gender: Gender | null };

export function useMentions(value: string, setValue: (v: string) => void, listId: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ at: number; query: string } | null>(null);
  const [items, setItems] = useState<MentionItem[]>([]);
  const [at, setAt] = useState(0);

  useEffect(() => {
    if (!mention) { setItems([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.mentionMembers(mention.query).then(
        (r) => { if (alive) { setItems(r.items); setAt(0); } },
        () => { if (alive) setItems([]); },
      );
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [mention]);

  /** where the caret is, is there an unfinished @word right before it? */
  function track(v: string, caret: number) {
    const open = v.slice(0, caret).match(/(^|[^\w@])@([a-zA-Z0-9_]{0,19})$/);
    if (!open) return setMention(null);
    setMention({ at: caret - open[2]!.length - 1, query: open[2]! });
  }

  function choose(item: MentionItem) {
    const ta = ref.current;
    if (!ta || !mention) return;
    const caret = ta.selectionStart ?? value.length;
    setValue(`${value.slice(0, mention.at)}@${item.handle} ${value.slice(caret)}`);
    setMention(null);
    setItems([]);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = mention.at + item.handle.length + 2;
      ta.setSelectionRange(pos, pos);
    });
  }

  const open = !!mention && items.length > 0;
  /** true when the key was the list's (arrows, Enter/Tab to choose, Escape to close) */
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!open) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => (i + 1) % items.length); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => (i - 1 + items.length) % items.length); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(items[at]!); return true; }
    if (e.key === 'Escape') { e.preventDefault(); setMention(null); return true; }
    return false;
  }

  /* a text box with a suggestion list (the @ member list) is a combobox; aria-expanded needs that role */
  const boxProps = {
    ref,
    role: 'combobox' as const,
    'aria-autocomplete': 'list' as const,
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': open,
    'aria-controls': listId,
    onBlur: () => { setTimeout(() => setMention(null), 100); },
  };

  const list = open ? (
    <ul className="mention-list" id={listId} role="listbox" aria-label="Mention a member">
      {items.map((item, i) => (
        <li key={item.handle} role="option" aria-selected={i === at}>
          <button
            type="button"
            tabIndex={-1}
            className={i === at ? 'on' : undefined}
            onMouseDown={(e) => { e.preventDefault(); choose(item); }}
          >
            <Avatar seed={item.handle} gender={item.gender} size={24} />
            <span className="mention-name">{item.displayName}</span>
            <span className="mention-handle">@{item.handle}</span>
          </button>
        </li>
      ))}
    </ul>
  ) : null;

  return { boxProps, track, onKeyDown, list };
}
