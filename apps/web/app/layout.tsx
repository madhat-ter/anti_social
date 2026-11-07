import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = { title: 'anti', description: 'A small, invite-only network.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">anti</Link>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
