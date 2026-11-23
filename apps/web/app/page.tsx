/**
 * The home address. Signed in: the feed (home.tsx, as before). Not signed in: the landing page,
 * sent fully written out by the server (RFC §10.29). Before, everyone got a "Loading…" shell and the
 * landing appeared only after a script asked the API who you are, so search engines saw an empty
 * page. A stale session cookie still works: home.tsx shows the landing when /me says nobody.
 */
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Home, { Landing } from './home';
import { HomeJsonLd } from '@/components/HomeJsonLd';
import { HOME_DESCRIPTION, HOME_TITLE, SITE_NAME, SITE_URL } from '@/lib/about';

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: '/' },
  // the one page meant to be found: everything else is noindex (layout.tsx)
  robots: { index: true, follow: true },
  openGraph: { type: 'website', url: SITE_URL, siteName: SITE_NAME, title: HOME_TITLE, description: HOME_DESCRIPTION, locale: 'en' },
  twitter: { card: 'summary_large_image', title: HOME_TITLE, description: HOME_DESCRIPTION },
};

export default async function Page() {
  const jar = await cookies();
  if (jar.has('anti_session')) return <Home />;
  return (
    <>
      <HomeJsonLd />
      <Landing />
    </>
  );
}
