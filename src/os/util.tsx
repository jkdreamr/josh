import { useState } from 'react';

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** Personal Vercel deployments ship without a favicon; asking Google for one only produces a 404. */
const hasFavicon = (url: string) => !hostOf(url).endsWith('.vercel.app');

export const faviconOf = (url: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(url))}&sz=128`;

const palette = ['#ff7a59', '#7c5cff', '#18b37e', '#ff4f8b', '#2f8cff', '#f2b134', '#00a3a3'];

export function Favicon({ url, name, size = 40, radius = 10 }: { url?: string; name: string; size?: number; radius?: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = !!url && (!hasFavicon(url) || failedUrl === url);
  const color = palette[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length];
  return (
    <span className="favicon" style={{ width: size, height: size, borderRadius: radius, background: url && !failed ? '#fff' : color }}>
      {url && !failed ? (
        <img src={faviconOf(url)} alt="" width={size * 0.6} height={size * 0.6} loading="lazy" onError={() => setFailedUrl(url)} />
      ) : (
        <b style={{ fontSize: size * 0.42 }}>{name.replace(/^@/, '').charAt(0).toUpperCase()}</b>
      )}
    </span>
  );
}

export function ExternalIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

export const openExternal = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
