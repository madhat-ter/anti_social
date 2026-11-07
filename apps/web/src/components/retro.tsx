'use client';
/**
 * 1-bit desktop primitives: windows with striped title bars, alert dialogs, progress bars.
 * The look: classic Mac OS meets a zine. See globals.css (.win, .win-bar, .dlg, .loading).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function Win({
  title,
  children,
  className,
  onClose,
  as: Tag = 'section',
  bodyClassName,
  dark,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  /** shows a working close box when given; otherwise the box is decorative */
  onClose?: () => void;
  as?: 'section' | 'div' | 'form' | 'article' | 'aside';
  bodyClassName?: string;
  /** inverted title bar (ink background), for emphasis */
  dark?: boolean;
}) {
  const id = useId();
  return (
    <Tag className={`win${dark ? ' win-dark' : ''}${className ? ` ${className}` : ''}`} aria-labelledby={`${id}-t`}>
      <div className="win-bar">
        {onClose ? (
          <button type="button" className="win-close" onClick={onClose} aria-label={`Close ${title}`} />
        ) : (
          <span className="win-close" aria-hidden="true" />
        )}
        <span className="win-title" id={`${id}-t`}>{title}</span>
      </div>
      <div className={`win-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>
    </Tag>
  );
}

/** The little warning triangle from the alert dialogs. */
export function AlertIcon({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" className="alert-icon">
      <path d="M16 3 L30 28 L2 28 Z" fill="var(--paper)" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
      <rect x="14.6" y="11" width="2.8" height="9.5" fill="currentColor" />
      <rect x="14.6" y="22.5" width="2.8" height="2.8" fill="currentColor" />
    </svg>
  );
}

/**
 * Modal alert built on <dialog>: focus trap, Esc to cancel, backdrop.
 * With `input`, it asks for text (replaces window.prompt).
 */
export function AlertDialog({
  open,
  title = 'ALERT',
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  danger,
  input,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string | null;
  danger?: boolean;
  input?: { label: string; placeholder?: string; maxLength?: number };
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState('');
  const id = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setValue(''); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dlg"
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-m`}
      onCancel={(e) => { e.preventDefault(); onCancel(); }}
      onClick={(e) => { if (e.target === ref.current) onCancel(); }}
    >
      <form method="dialog" className="win" onSubmit={(e) => { e.preventDefault(); onConfirm(value.trim()); }}>
        <div className="win-bar">
          <button type="button" className="win-close" onClick={onCancel} aria-label="Close" />
          <span className="win-title" id={`${id}-t`}>{title}</span>
        </div>
        <div className="win-body dlg-body">
          <AlertIcon />
          <div className="stack dlg-main">
            <div id={`${id}-m`} className="dlg-msg">{message}</div>
            {input && (
              <label className="dlg-input">
                <span className="sr-only">{input.label}</span>
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={input.placeholder}
                  maxLength={input.maxLength}
                  autoFocus
                />
              </label>
            )}
            <div className="row dlg-actions">
              {cancelLabel && <button type="button" className="btn" onClick={onCancel}>{cancelLabel}</button>}
              <button type="submit" className={`btn default${danger ? ' danger' : ''}`} autoFocus={!input}>{confirmLabel}</button>
            </div>
          </div>
        </div>
      </form>
    </dialog>
  );
}

/** Striped progress bar. `value` 0–100; omit for an indeterminate shimmer. */
export function Progress({ value, label, showValue = true }: { value?: number; label?: string; showValue?: boolean }) {
  const pct = value === undefined ? undefined : Math.max(0, Math.min(100, value));
  return (
    <div
      className={`progressbar${pct === undefined ? ' indeterminate' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <span className="progressbar-fill" style={pct === undefined ? undefined : { width: `${pct}%` }} />
      {pct !== undefined && showValue && <span className="progressbar-text">{Math.round(pct)}%</span>}
    </div>
  );
}

/** Page-level loading state: "LOADING... PLEASE BE PATIENT". */
export function Loading({ what = 'Loading' }: { what?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <p className="ui">{what}… please be patient</p>
      <Progress label="Loading" />
    </div>
  );
}

/** The red dot from the posters. Used for likes, unread markers and accents. */
export function Dot({ on = true, size = '.7em' }: { on?: boolean; size?: string }) {
  return <span className={`rdot${on ? ' on' : ''}`} style={{ width: size, height: size }} aria-hidden="true" />;
}
