import { ABOUT_LINES, FAQ, HOME_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/about';

/**
 * RFC §10.29: Schema.org structured data for the landing page (JSON-LD). It is data, not a script
 * the browser runs, so the CSP (proxy.ts) doesn't touch it. Every claim here is also on the page.
 * No SearchAction: there is no public search (the only search is on Members, behind sign-in).
 */
export function homeJsonLd() {
  const org = `${SITE_URL}/#org`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': org,
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/opengraph-image`,
        description: ABOUT_LINES[0],
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        alternateName: 'tryanti.social',
        description: HOME_DESCRIPTION,
        inLanguage: 'en',
        publisher: { '@id': org },
      },
      {
        '@type': 'WebApplication',
        '@id': `${SITE_URL}/#app`,
        name: SITE_NAME,
        url: SITE_URL,
        description: ABOUT_LINES.join(' '),
        applicationCategory: 'SocialNetworkingApplication',
        operatingSystem: 'Any (runs in a web browser)',
        browserRequirements: 'Requires JavaScript',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free to join, by invite or by asking for a seat.' },
        publisher: { '@id': org },
      },
      {
        '@type': 'FAQPage',
        '@id': `${SITE_URL}/#faq`,
        mainEntity: FAQ.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      },
    ],
  };
}

export function HomeJsonLd() {
  // "<" escaped so no text in it can ever close the <script> early
  const json = JSON.stringify(homeJsonLd()).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
