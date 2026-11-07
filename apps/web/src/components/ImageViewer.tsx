'use client';
/**
 * Image viewer: each image opens in its own window, like the "Img_012" windows on the old
 * desktop. Built on <dialog> (focus trap, Esc). Arrow keys move between a post's images.
 */
import { useEffect, useId, useRef } from 'react';
import type { Image } from '@/lib/api';

export function ImageViewer({ images, index, onIndex, onClose, alt }: {
  images: Image[];
  /** null = closed */
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  alt: (i: number) => string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const open = index !== null;
  const i = index ?? 0;
  const im = images[i];
  const many = images.length > 1;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open || !many) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') onIndex((i + 1) % images.length);
      if (e.key === 'ArrowLeft') onIndex((i - 1 + images.length) % images.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, many, i, images.length, onIndex]);

  const name = `IMG_${String(i + 1).padStart(3, '0')}.webp`;
  return (
    <dialog
      ref={ref}
      className="dlg viewer"
      aria-labelledby={`${id}-t`}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {im && (
        <div className="win">
          <div className="win-bar">
            <button type="button" className="win-close" onClick={onClose} aria-label="Close image" />
            <span className="win-title" id={`${id}-t`}>{name}</span>
          </div>
          <div className="viewer-body">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={im.url} alt={alt(i)} width={im.width} height={im.height} />
          </div>
          <div className="viewer-bar">
            {many ? (
              <div className="row">
                <button type="button" className="btn" onClick={() => onIndex((i - 1 + images.length) % images.length)} aria-label="Previous image">◀</button>
                <span className="ui">{i + 1} of {images.length}</span>
                <button type="button" className="btn" onClick={() => onIndex((i + 1) % images.length)} aria-label="Next image">▶</button>
              </div>
            ) : <span className="ui muted">{im.width} × {im.height}</span>}
            <a className="btn" href={im.url} target="_blank" rel="noopener noreferrer">Open original</a>
          </div>
        </div>
      )}
    </dialog>
  );
}
