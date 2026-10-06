import { useMemo } from 'react';
import { pacificHour, useNow } from './hooks';

type Sky = { name: string; top: string; mid: string; low: string; glow: string; hills: [string, string, string]; stars: number; sun: { x: number; y: number; color: string } };

/** Palette per part of the Palo Alto day. */
function skyFor(h: number): Sky {
  if (h >= 5 && h < 7.5)
    return { name: 'dawn', top: '#2b2f6b', mid: '#b0629a', low: '#ffb38a', glow: '#ffd6a0', hills: ['#5a3a6e', '#3b2752', '#24183a'], stars: 0.25, sun: { x: 70, y: 74, color: '#ffd29a' } };
  if (h >= 7.5 && h < 16.5)
    return { name: 'day', top: '#3d7be0', mid: '#79b2f2', low: '#d7ecff', glow: '#fff6dc', hills: ['#6f9fc9', '#4f7fb0', '#345f8f'], stars: 0, sun: { x: 74, y: 22, color: '#fff3cf' } };
  if (h >= 16.5 && h < 19.5)
    return { name: 'dusk', top: '#29234f', mid: '#c4567a', low: '#ffa25c', glow: '#ffcf7a', hills: ['#6a3a63', '#432445', '#24132b'], stars: 0.15, sun: { x: 28, y: 70, color: '#ffc47a' } };
  return { name: 'night', top: '#05060f', mid: '#12163a', low: '#2a2360', glow: '#8f8cff', hills: ['#1d1d45', '#141433', '#0b0b1f'], stars: 1, sun: { x: 78, y: 20, color: '#e9ecff' } };
}

const starField = Array.from({ length: 90 }, (_, i) => {
  const r = (n: number) => {
    const x = Math.sin(i * 9301 + n * 49297) * 233280;
    return x - Math.floor(x);
  };
  return { x: r(1) * 100, y: r(2) * 62, s: 0.6 + r(3) * 1.6, d: r(4) * 4 };
});

export default function Wallpaper() {
  const now = useNow(60_000);
  const sky = useMemo(() => skyFor(pacificHour(now)), [now]);
  return (
    <div className={`wallpaper sky-${sky.name}`} aria-hidden="true">
      <div className="wp-sky" style={{ background: `linear-gradient(180deg, ${sky.top} 0%, ${sky.mid} 52%, ${sky.low} 100%)` }} />
      <div className="wp-aurora wp-a1" style={{ background: `radial-gradient(closest-side, ${sky.glow}66, transparent)` }} />
      <div className="wp-aurora wp-a2" style={{ background: `radial-gradient(closest-side, ${sky.mid}aa, transparent)` }} />
      <div
        className="wp-sun"
        style={{ left: `${sky.sun.x}%`, top: `${sky.sun.y}%`, background: `radial-gradient(circle, ${sky.sun.color} 0 22%, ${sky.sun.color}55 36%, transparent 70%)` }}
      />
      {sky.stars > 0 && (
        <div className="wp-stars" style={{ opacity: sky.stars }}>
          {starField.map((s, i) => (
            <i key={i} style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, animationDelay: `${s.d}s` }} />
          ))}
        </div>
      )}
      <svg className="wp-hills" viewBox="0 0 1600 420" preserveAspectRatio="none">
        <path d="M0 250 C 180 190, 330 210, 480 235 S 820 170, 1010 205 S 1380 160, 1600 210 V420 H0 Z" fill={sky.hills[0]} />
        <path d="M0 300 C 220 255, 420 275, 640 290 S 1040 245, 1240 270 S 1500 250, 1600 262 V420 H0 Z" fill={sky.hills[1]} />
        <g fill={sky.hills[2]}>
          {/* Hoover Tower */}
          <rect x="1092" y="190" width="30" height="130" />
          <rect x="1088" y="182" width="38" height="12" />
          <path d="M1094 182 Q1107 150 1120 182 Z" />
          <rect x="1105.5" y="140" width="3" height="16" />
          {/* the Dish */}
          <path d="M330 262 q34 -38 68 0 z" />
          <rect x="361" y="260" width="6" height="22" />
          <path d="M0 340 C 260 300, 520 320, 780 330 S 1300 300, 1600 318 V420 H0 Z" />
        </g>
      </svg>
      <div className="wp-grain" />
    </div>
  );
}
