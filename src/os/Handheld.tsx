import { useEffect, useState, type CSSProperties, type ReactNode, type Ref } from 'react';

export type HandheldKind = 'phone' | 'tablet';

/** Front-face geometry in CSS px: iPhone 16 Pro (402×874 pt) and iPad Air 11" (820×1180 pt). */
const SPEC = {
  phone: { w: 402, h: 874, band: 5, bezel: 9, radius: 55 },
  tablet: { w: 820, h: 1180, band: 4, bezel: 36, radius: 18 },
} as const;

type Side = 'l' | 'r' | 't';
type Btn = { cls: string; side: Side; at: number; len: number };

/** Hardware buttons, measured on the portrait device from its top-left corner. */
const BUTTONS: Record<HandheldKind, Btn[]> = {
  phone: [
    { cls: 'action', side: 'l', at: 152, len: 30 },
    { cls: 'vol', side: 'l', at: 222, len: 60 },
    { cls: 'vol', side: 'l', at: 294, len: 60 },
    { cls: 'power', side: 'r', at: 248, len: 96 },
    { cls: 'camctl', side: 'r', at: 540, len: 58 },
  ],
  tablet: [
    { cls: 'power', side: 't', at: 760, len: 62 },
    { cls: 'vol', side: 'r', at: 96, len: 56 },
    { cls: 'vol', side: 'r', at: 162, len: 56 },
  ],
};

type Props = {
  kind: HandheldKind;
  landscape: boolean;
  onWake: () => void;
  sceneRef: Ref<HTMLDivElement>;
  screenRef: Ref<HTMLDivElement>;
  children: ReactNode;
};

export default function Handheld({ kind, landscape, onWake, sceneRef, screenRef, children }: Props) {
  const s = SPEC[kind];
  const edge = s.band + s.bezel;
  const pw = s.w + 2 * edge;
  const ph = s.h + 2 * edge;
  const fw = landscape ? ph : pw;
  const fh = landscape ? pw : ph;
  const [fit, setFit] = useState({ k: 0.4, gap: 0 });

  useEffect(() => {
    const measure = () => {
      const caption = window.innerWidth > 760;
      const k = Math.min((window.innerWidth - (caption ? 64 : 28)) / fw, (window.innerHeight - (caption ? 150 : 40)) / fh, 1);
      setFit({ k, gap: caption ? 64 : 0 });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [fw, fh]);

  // A portrait device turned counter-clockwise: left edge → bottom, right edge → top, top edge → left.
  const place = (b: Btn): CSSProperties => {
    if (!landscape) return b.side === 't' ? { top: -2, left: b.at, width: b.len } : { [b.side === 'l' ? 'left' : 'right']: -2, top: b.at, height: b.len };
    if (b.side === 't') return { left: -2, top: pw - b.at - b.len, height: b.len };
    return { [b.side === 'l' ? 'bottom' : 'top']: -2, left: b.at, width: b.len };
  };

  const vars = { width: fw, height: fh, transform: `scale(${fit.k})`, '--band': `${s.band}px`, '--edge': `${edge}px`, '--sr': `${s.radius}px` } as CSSProperties;

  return (
    <div className={`hh hh-${kind} ${landscape ? 'is-land' : 'is-port'}`} ref={sceneRef} style={{ width: fw * fit.k, height: fh * fit.k, marginBottom: fit.gap }} onClick={onWake}>
      <div className="hh-device" style={vars}>
        <span className="hh-shadow" aria-hidden="true" />
        {BUTTONS[kind].map((b, i) => (
          <i key={i} className={`hh-btn hh-${b.cls} ${b.side === 't' ? (landscape ? 'is-v' : 'is-h') : landscape ? 'is-h' : 'is-v'}`} style={place(b)} aria-hidden="true" />
        ))}
        <div className="hh-body">
          <div className="hh-glass">
            <div className="screen" ref={screenRef}>
              {children}
            </div>
            <span className={kind === 'phone' ? 'hh-island' : 'hh-cam'} aria-hidden="true" />
            <span className="hh-sheen" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}
