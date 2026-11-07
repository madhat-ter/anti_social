'use client';
import { useEffect, useState } from 'react';

/** Menu-bar clock, "4:20 PM". Renders nothing until mounted to avoid a hydration mismatch. */
export function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <span aria-hidden="true">--:--</span>;
  return <time dateTime={now.toISOString()}>{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time>;
}
