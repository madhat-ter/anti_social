import { ImageResponse } from 'next/og';

/**
 * RFC §10.31: the Home Screen icon on iPhone (iOS rounds the corners itself). The same condensed
 * black A with the red dot as app/icon.svg, on white. Made once at build time.
 */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

const A = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M15 52 L26 12 H38 L49 52 H39.5 L37.4 43 H26.6 L24.5 52 Z M28.4 35.5 H35.6 L32 19.5 Z" fill="#000"/><circle cx="51" cy="47" r="6" fill="#e8412c"/></svg>';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/svg+xml;base64,${Buffer.from(A).toString('base64')}`} width={150} height={150} alt="" />
      </div>
    ),
    size,
  );
}
