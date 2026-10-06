import { useId, type CSSProperties, type ReactNode } from 'react';
import * as logos from './logos';
import type { Logo } from './logos';

type Shape = 'circle' | 'rect' | 'hex';

type StickerProps = {
  shape: Shape;
  w?: number;
  h?: number;
  bg: string;
  children: ReactNode;
};

const BORDER = 5;

/** Die-cut vinyl sticker: white border, coloured face, clipped artwork and a gloss pass. */
function Art({ shape, w = 100, h = 100, bg, children }: StickerProps) {
  const id = useId().replace(/:/g, '');
  const outer = (fill: string) =>
    shape === 'circle' ? (
      <circle cx={w / 2} cy={h / 2} r={w / 2} fill={fill} />
    ) : shape === 'hex' ? (
      <polygon points={hex(w, h, 0)} fill={fill} />
    ) : (
      <rect width={w} height={h} rx={Math.min(w, h) * 0.16} fill={fill} />
    );
  const inner =
    shape === 'circle' ? (
      <circle cx={w / 2} cy={h / 2} r={w / 2 - BORDER} />
    ) : shape === 'hex' ? (
      <polygon points={hex(w, h, BORDER)} />
    ) : (
      <rect x={BORDER} y={BORDER} width={w - BORDER * 2} height={h - BORDER * 2} rx={Math.min(w, h) * 0.11} />
    );
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="sticker-art">
      <defs>
        <clipPath id={`c${id}`}>{inner}</clipPath>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset=".42" stopColor="#fff" stopOpacity=".08" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".1" />
        </linearGradient>
      </defs>
      {outer('#fbfbfd')}
      <g clipPath={`url(#c${id})`}>
        <rect width={w} height={h} fill={bg} />
        {children}
      </g>
      {outer(`url(#g${id})`)}
    </svg>
  );
}

function hex(w: number, h: number, inset: number) {
  const cx = w / 2;
  const cy = h / 2;
  const r = w / 2 - inset;
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a) * (h / w)).toFixed(2)}`;
  }).join(' ');
}

const font = 'Inter, -apple-system, sans-serif';

function Mark({ logo, x, y, w, h, fill = '#fff' }: { logo: Logo; x: number; y: number; w: number; h: number; fill?: string }) {
  return <svg x={x} y={y} width={w} height={h} viewBox={logo.viewBox} dangerouslySetInnerHTML={{ __html: logo.body.replaceAll('FILL', fill) }} />;
}

const Cognition = () => (
  <Art shape="rect" w={244} h={84} bg="#0b0b0c">
    <Mark logo={logos.cognition} x={18} y={16} w={52} h={52} />
    <text x="82" y="54" fill="#fff" fontFamily={font} fontWeight="600" fontSize="30" letterSpacing="-0.6">
      Cognition
    </text>
  </Art>
);

const Crv = () => (
  <Art shape="circle" bg="#000">
    <Mark logo={logos.crv} x={20} y={38} w={60} h={24} />
  </Art>
);

const Stanford = () => (
  <Art shape="rect" w={220} h={80} bg="#8c1515">
    <Mark logo={logos.stanfordWord} x={22} y={18} w={176} h={46} />
  </Art>
);

const StanfordS = () => (
  <Art shape="rect" w={120} h={150} bg="#fff">
    <Mark logo={logos.stanfordS} x={18} y={12} w={84} h={126} />
  </Art>
);

const Near = () => (
  <Art shape="circle" bg="#000">
    <Mark logo={logos.nearMark} x={25} y={25} w={50} h={50} />
  </Art>
);

function Trigram({ bars, x, y, rot }: { bars: [number, number, number]; x: number; y: number; rot: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`} fill="#111">
      {bars.map((solid, i) =>
        solid ? (
          <rect key={i} x={-12} y={-11 + i * 8} width={24} height={5} />
        ) : (
          <g key={i}>
            <rect x={-12} y={-11 + i * 8} width={10.5} height={5} />
            <rect x={1.5} y={-11 + i * 8} width={10.5} height={5} />
          </g>
        ),
      )}
    </g>
  );
}

const KoreaFlag = () => (
  <Art shape="rect" w={150} h={100} bg="#fff">
    <g transform="translate(75 50) rotate(33.7)">
      <path d="M-24 0a24 24 0 0 1 48 0a12 12 0 0 1-24 0a12 12 0 0 0-24 0z" fill="#cd2e3a" />
      <path d="M24 0a24 24 0 0 1-48 0a12 12 0 0 1 24 0a12 12 0 0 0 24 0z" fill="#0047a0" />
    </g>
    <Trigram bars={[1, 1, 1]} x={32} y={24} rot={-56.3} />
    <Trigram bars={[0, 0, 0]} x={118} y={76} rot={-56.3} />
    <Trigram bars={[1, 0, 1]} x={32} y={76} rot={56.3} />
    <Trigram bars={[0, 1, 0]} x={118} y={24} rot={56.3} />
  </Art>
);

const UsaFlag = () => (
  <Art shape="rect" w={152} h={100} bg="#fff">
    {Array.from({ length: 7 }, (_, i) => (
      <rect key={i} y={i * (200 / 13)} width={152} height={100 / 13} fill="#b22234" />
    ))}
    <rect width={68} height={54} fill="#3c3b6e" />
    {Array.from({ length: 5 }, (_, r) =>
      Array.from({ length: r % 2 ? 5 : 6 }, (_, c) => <circle key={`${r}-${c}`} cx={(r % 2 ? 13 : 7) + c * 11} cy={9 + r * 9.5} r={2.3} fill="#fff" />),
    )}
  </Art>
);

type Placed = { key: string; label: string; el: ReactNode; left: string; top: string; width: string; rot: number; onClick?: () => void };

function Place({ s, interactive }: { s: Placed; interactive?: boolean }) {
  const style = { left: s.left, top: s.top, width: s.width, '--r': `${s.rot}deg` } as CSSProperties;
  return interactive ? (
    <button
      className="sticker is-live"
      style={style}
      aria-label={s.label}
      title={s.label}
      onClick={(e) => {
        e.stopPropagation();
        s.onClick?.();
      }}
    >
      {s.el}
    </button>
  ) : (
    <span className="sticker" style={style}>
      {s.el}
    </span>
  );
}

export const lidStickers: Placed[] = [
  { key: 'stanford', label: 'Stanford', el: <Stanford />, left: '8%', top: '10%', width: '24%', rot: -7 },
  { key: 'near', label: 'NEAR Protocol', el: <Near />, left: '73%', top: '9%', width: '11%', rot: 8 },
  { key: 'stanford-s', label: 'Stanford Cardinal', el: <StanfordS />, left: '14%', top: '40%', width: '8%', rot: 9 },
  { key: 'korea', label: 'Korea', el: <KoreaFlag />, left: '12%', top: '68%', width: '15%', rot: -9 },
  { key: 'usa', label: 'USA', el: <UsaFlag />, left: '71%', top: '62%', width: '15%', rot: 7 },
];

export function LidStickers() {
  return (
    <div className="stickers stickers-lid" aria-hidden="true">
      {lidStickers.map((s) => (
        <Place key={s.key} s={s} />
      ))}
    </div>
  );
}

/** Palm-rest stickers for the WebGL laptop: art plus placement on the deck in cm (x from centre, z towards the front). */
export const palmStickers = [
  { key: 'crv', label: 'CRV — open Work folder', el: <Crv />, x: -11.3, z: 5.6, w: 2.7, rot: -10 },
  { key: 'cognition', label: 'Cognition — open Work folder', el: <Cognition />, x: 11.1, z: 6.1, w: 5.3, rot: 5 },
] as const;

export function PalmStickers({ onCrv, onCognition }: { onCrv: () => void; onCognition: () => void }) {
  const palm: Placed[] = [
    { key: 'crv', label: 'CRV — open Work folder', el: <Crv />, left: '9%', top: '58%', width: '8.5%', rot: -10, onClick: onCrv },
    { key: 'cognition', label: 'Cognition — open Work folder', el: <Cognition />, left: '75%', top: '61%', width: '16.5%', rot: 5, onClick: onCognition },
  ];
  return (
    <div className="stickers stickers-palm">
      {palm.map((s) => (
        <Place key={s.key} s={s} interactive />
      ))}
    </div>
  );
}
