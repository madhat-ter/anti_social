import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { cookies } from 'next/headers';
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
 * Bangla: Li Golesta Borno (Unicode) by Lipighor, chosen by the owner (2026-11-09). Lipighor's
 * licence (fonts/golesta-borno/LICENSE-Readme.txt) allows web use only with their emailed
 * permission and a "Web font: lipighor.com" backlink in the landing page footer (page.tsx); the
 * files must not be re-uploaded elsewhere. It covers only the Bengali block, so it sits after every
 * other face in each stack and the browser uses it, and downloads it, only for Bangla characters.
 */
const bangla = localFont({
  src: [
    { path: './fonts/golesta-borno/LiGolestaBornoUnicode-Regular.ttf', weight: '400', style: 'normal' },
    { path: './fonts/golesta-borno/LiGolestaBornoUnicode-Italic.ttf', weight: '400', style: 'italic' },
  ],
  variable: '--f-bangla',
  display: 'swap',
  adjustFontFallback: false,
  declarations: [
    { prop: 'unicode-range', value: 'U+0951-0952, U+0964-0965, U+0980-09FE, U+200C-200D, U+20B9, U+25CC' },
    // Golesta Borno draws a little small for its size; this matches its letters to the English beside them
    { prop: 'size-adjust', value: '108%' },
  ],
});

export const metadata: Metadata = { title: 'anti', description: 'A small, invite-only network. One hundred seats.' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // render per request: the CSP nonce (proxy.ts) is new every time, so pages can't be prebuilt
  await connection();
  // RFC §10.14: dark only for a signed-in member who chose it (the cookie mirrors their setting), so
  // the first frame is already dark; signed-out pages and visitors stay light; the device is ignored
  const jar = await cookies();
  const dark = jar.get('anti_theme')?.value === 'dark' && jar.has('anti_session');
  return (
    <html lang="en" data-theme={dark ? 'dark' : undefined} suppressHydrationWarning
      className={`${archivo.variable} ${pixel.variable} ${mono.variable} ${hand.variable} ${bangla.variable}`}>
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
