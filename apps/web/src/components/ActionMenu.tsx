'use client';
/**
 * The "⋯" menu: every action a screen offers beyond its one primary button lives here, so a
 * page never shows a row of five equal buttons. Same look as the post menu (.menu-pop).
 * Closes on a choice, a click outside, or Escape.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export type ActionItem = {
  label: ReactNode;
  onSelect: () => void;
  /** red text: destructive or rare */
  danger?: boolean;
  disabled?: boolean;
  title?: string;
};

export function ActionMenu({ items, label = 'More actions', className }: { items: (ActionItem | false | null | undefined)[]; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = items.filter((i): i is ActionItem => !!i);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);

  if (list.length === 0) return null;
  return (
    <div className={`menu action-menu${className ? ` ${className}` : ''}`} ref={ref}>
      <button type="button" className="icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>⋯</button>
      {open && (
        <div className="menu-pop" role="menu">
          {list.map((i, n) => (
            <button key={n} type="button" role="menuitem" className={i.danger ? 'danger-text' : undefined} disabled={i.disabled} title={i.title}
              onClick={() => { setOpen(false); i.onSelect(); }}>
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
