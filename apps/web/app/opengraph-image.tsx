import { ImageResponse } from 'next/og';

/**
 * RFC §10.29: the picture shown when someone shares a link to anti (Open Graph and, through
 * twitter-image.tsx, X/Twitter). Made once at build time. Ink on paper, like the landing page; its
 * colours are fixed because it is an image, not part of the page's light/dark theme.
 */
export const alt = 'Anti Social: a small community for when you feel alone';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#ffffff', color: '#000000', padding: '64px 72px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', fontSize: 150, fontWeight: 900, letterSpacing: -5, lineHeight: 1 }}>
          ANTI SOCIAL
          <div style={{ width: 28, height: 28, background: '#e8412c' /* --signal */, marginLeft: 8, marginBottom: 18 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 46, lineHeight: 1.25 }}>
          <div style={{ display: 'flex' }}>But you’re not the only one feeling this.</div>
          <div style={{ display: 'flex', fontWeight: 700 }}>We have each other.</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 28, borderTop: '4px solid #000000', paddingTop: 20 }}>
          <div style={{ display: 'flex' }}>A small community of 100 seats</div>
          <div style={{ display: 'flex' }}>tryanti.social</div>
        </div>
      </div>
    ),
    size,
  );
}
