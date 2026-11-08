import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Archivo, Shantell_Sans, Space_Mono, Tiny5 } from 'next/font/google';
import './globals.css';

/** One family on its width axis: ultra-condensed black for posters, normal width for reading. */
const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--f-archivo', display: 'swap' });
/**
 * Portfolio typeface choices (see "the look" in globals.css). next/font copies the files at build
 * time and serves them from here, so a visitor's browser never contacts Google.
 */
const mono = Space_Mono({ weight: ['400', '700'], subsets: ['latin'], variable: '--f-mono', display: 'swap' });
const hand = Shantell_Sans({ subsets: ['latin'], variable: '--f-hand', display: 'swap' });
/**
 * Bitmap face for the OS chrome: windows, menus, buttons. Tiny5, not Pixelify Sans: Pixelify's
 * 5 reads as an 8 ("$5.00" looked like "$8.00" on the pay button). See scripts/font-compare.ts.
 */
const pixel = Tiny5({ weight: '400', subsets: ['latin'], variable: '--f-pixel', display: 'swap' });

export const metadata: Metadata = { title: 'anti', description: 'A small, invite-only network. One hundred seats.' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // render per request: the CSP nonce (proxy.ts) is new every time, so pages can't be prebuilt
  await connection();
  return (
    <html lang="en" className={`${archivo.variable} ${pixel.variable} ${mono.variable} ${hand.variable}`}>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <header className="top">
          <div className="top-inner">
            <Link href="/" className="brand" aria-label="anti, home">anti</Link>
            {/* phones: the seated shell puts the notifications bell here (PhoneBar.tsx); wide screens show nothing else */}
            <span className="top-actions" id="top-actions" />
          </div>
        </header>
        <main className="wrap" id="main" tabIndex={-1}>{children}</main>
      </body>
    </html>
  );
}
