import type { Metadata } from 'next';
import Link from 'next/link';
import { Archivo, Pixelify_Sans } from 'next/font/google';
import { Clock } from '@/components/Clock';
import './globals.css';

/** One family on its width axis: ultra-condensed black for posters, normal width for reading. */
const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--f-archivo', display: 'swap' });
/** Bitmap-style face for the OS chrome: windows, menus, buttons. */
const pixel = Pixelify_Sans({ subsets: ['latin'], variable: '--f-pixel', display: 'swap' });

export const metadata: Metadata = { title: 'anti', description: 'A small, invite-only network. One hundred seats.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${pixel.variable}`}>
      <body>
        <header className="top">
          <div className="top-inner">
            <Link href="/" className="brand" aria-label="anti, home">anti</Link>
            <span className="top-clock"><Clock /></span>
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
