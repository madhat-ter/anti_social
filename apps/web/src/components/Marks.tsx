/**
 * Marks by a name (RFC §10.7): the OG mark for admins (two interlocking rings, the O and the G)
 * and the verified badge (a seal with a tick) for members an admin has checked. Both are drawn
 * here as vectors in the ink colour, sized to the text around them.
 */

/** The OG mark: an O ring linked through a G ring. */
export function OgMark({ size = '1.05em' }: { size?: string }) {
  return (
    <span className="mark og-mark" role="img" aria-label="admin" title="Runs the room">
      <svg viewBox="0 0 64 40" width={`calc(${size} * 1.6)`} height={size} aria-hidden="true" focusable="false">
        {/* the O, behind the G where they cross at the bottom */}
        <circle cx="22" cy="20" r="14.5" fill="none" stroke="currentColor" strokeWidth="6" />
        {/* the G: a ring open at the upper right, with its bar */}
        <path d="M54.6 13.2 A14.5 14.5 0 1 0 56.5 20 H43.5" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="butt" />
        {/* the O passes over the G at the top: redraw that crossing on top, with a paper gap */}
        <path d="M30.2 8.2 A14.5 14.5 0 0 1 35.9 15.6" fill="none" stroke="var(--mark-bg, var(--paper))" strokeWidth="10" />
        <path d="M30.2 8.2 A14.5 14.5 0 0 1 35.9 15.6" fill="none" stroke="currentColor" strokeWidth="6" />
      </svg>
    </span>
  );
}

/** The verified badge: a scalloped seal with a tick in it. */
export function VerifiedBadge({ size = '1.05em' }: { size?: string }) {
  return (
    <span className="mark verified-badge" role="img" aria-label="verified" title="Verified by an admin">
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M12 1.5l2.2 1.9 2.9-.4 1.1 2.7 2.7 1.1-.4 2.9 1.9 2.3-1.9 2.2.4 2.9-2.7 1.1-1.1 2.7-2.9-.4L12 22.5l-2.2-1.9-2.9.4-1.1-2.7-2.7-1.1.4-2.9L1.6 12l1.9-2.2-.4-2.9 2.7-1.1 1.1-2.7 2.9.4z" />
        <path d="M7.4 12.3l3 3 6.2-6.4" fill="none" stroke="var(--mark-bg, var(--paper))" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** What goes right after a name: the OG mark for admins, then the badge if verified. */
export function NameMarks({ admin, verified, size }: { admin?: boolean; verified?: boolean; size?: string }) {
  if (!admin && !verified) return null;
  return (
    <span className="name-marks">
      {admin && <OgMark size={size} />}
      {verified && <VerifiedBadge size={size} />}
    </span>
  );
}
