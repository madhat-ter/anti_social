/** Dates written the way the website writes them (one source: apps/web/src/lib/hooks.ts). */
export { relativeTime, fmtDate } from '@web/lib/hooks';

/** "Today", "Yesterday", or "Tue, Nov 4" (the year only when it is not this year); as PostList.tsx */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export const firstName = (s: string) => s.split(/\s+/)[0] || s;

/** an event's time, short: "Sat, Nov 29, 6:00 PM" */
export function eventTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}
