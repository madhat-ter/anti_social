import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Archivo, Shantell_Sans, Space_Mono, Tiny5 } from 'next/font/google';
import localFont from 'next/font/local';
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
/**
 * Bangla (2026-11-09): Kalpurush by Tanbin Islam Siyam, SIL OFL 1.1 (app/fonts/kalpurush/OFL.txt),
 * served unmodified from here. It covers only the Bengali block, so it sits after every other face
 * in each stack and the browser uses it, and downloads it, only for Bangla characters.
 */
const bangla = localFont({
  src: './fonts/kalpurush/Kalpurush.ttf',
  weight: '400',
  variable: '--f-bangla',
  display: 'swap',
  adjustFontFallback: false,
  declarations: [
    { prop: 'unicode-range', value: 'U+0951-0952, U+0964-0965, U+0980-09FE, U+200C-200D, U+20B9, U+25CC' },
    // Kalpurush draws small for its size; this matches its letters to the English beside them
    { prop: 'size-adjust', value: '115%' },
  ],
});

export const metadata: Metadata = { title: 'anti', description: 'A small, invite-only network. One hundred seats.' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // render per request: the CSP nonce (proxy.ts) is new every time, so pages can't be prebuilt
  await connection();
  return (
    <html lang="en" className={`${archivo.variable} ${pixel.variable} ${mono.variable} ${hand.variable} ${bangla.variable}`}>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <header className="top">
          <div className="top-inner">
            <Link href="/" className="brand" aria-label="anti, home">anti</Link>
            {/* the centre: a member's screen-time timer (ScreenTime.tsx) */}
            <span className="top-center" id="top-center" />
            {/* phones: the seated shell puts the notifications bell here (PhoneBar.tsx); wide screens show nothing else */}
            <span className="top-actions" id="top-actions" />
          </div>
        </header>
        <main className="wrap" id="main" tabIndex={-1}>{children}</main>
      </body>
    </html>
  );
}
