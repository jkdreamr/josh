import { useMemo } from 'react';
import QRCode from 'qrcode';
import { links } from '../data';
import { venmoV } from '../icons';
import { openExternal } from '../util';
import type { AppProps } from '../types';

export default function Venmo({ args }: AppProps) {
  void args;
  const qr = useMemo(() => QRCode.create(links.venmo, { errorCorrectionLevel: 'H' }), []);
  const path = useMemo(() => {
    const modules: string[] = [];
    for (let row = 0; row < qr.modules.size; row += 1) {
      for (let col = 0; col < qr.modules.size; col += 1) {
        if (qr.modules.get(row, col)) modules.push(`M${col + 2} ${row + 2}h1v1h-1z`);
      }
    }
    return modules.join('');
  }, [qr]);
  const viewSize = qr.modules.size + 4;

  return (
    <div className="venmo">
      <div className="venmo-header" data-drag />
      <div className="venmo-content">
        <div className="venmo-profile">
          <div className="venmo-avatar">JK</div>
          <div className="venmo-identity">
            <div className="venmo-name">Joshua Koo</div>
            <div className="venmo-handle">@josdreamr</div>
          </div>
        </div>
        <div className="venmo-qr-wrap">
          <div className="venmo-qr-card">
            <svg viewBox={`0 0 ${viewSize} ${viewSize}`} shapeRendering="crispEdges" role="img" aria-label="QR code for venmo.com/u/josdreamr">
              <path d={path} fill="#008CFF" />
            </svg>
            <span className="venmo-mark" aria-hidden="true">
              <svg viewBox={venmoV.viewBox} fill="#008CFF">
                <path d={venmoV.path} />
              </svg>
            </span>
          </div>
          <div className="venmo-caption">Scan to pay @josdreamr</div>
        </div>
        <p className="venmo-tagline">buy me a coffee, split a dinner, or just say hi.</p>
        <div className="venmo-actions">
          <button onClick={() => openExternal(links.venmo)}>Pay</button>
          <button onClick={() => openExternal(links.venmo)}>Request</button>
        </div>
      </div>
    </div>
  );
}
