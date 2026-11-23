import { ABOUT_LINES, BRAND_ALIASES, BRAND_NAME, FAQ, HOME_DESCRIPTION, SITE_URL } from '@/lib/about';

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
        name: BRAND_NAME,
        alternateName: BRAND_ALIASES,
        url: SITE_URL,
        logo: `${SITE_URL}/opengraph-image`,
        description: ABOUT_LINES[0],
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        // Google takes the site name shown in results from here
        name: BRAND_NAME,
        alternateName: BRAND_ALIASES,
        description: HOME_DESCRIPTION,
        inLanguage: 'en',
        publisher: { '@id': org },
      },
      {
        '@type': 'WebApplication',
        '@id': `${SITE_URL}/#app`,
        name: BRAND_NAME,
        alternateName: BRAND_ALIASES,
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
