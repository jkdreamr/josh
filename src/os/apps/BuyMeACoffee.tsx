import { useMemo } from 'react';
import QRCode from 'qrcode';
import { siBuymeacoffee } from 'simple-icons';
import { links } from '../data';
import { openExternal } from '../util';
import type { AppProps } from '../types';

export default function BuyMeACoffee({ args }: AppProps) {
  void args;
  const qr = useMemo(() => QRCode.create(links.coffee, { errorCorrectionLevel: 'H' }), []);
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
    <div className="coffee">
      <div className="coffee-header" data-drag />
      <div className="coffee-content">
        <div className="coffee-profile">
          <div className="coffee-avatar">
            <svg viewBox="0 0 24 24" fill="#000" aria-hidden="true">
              <path d={siBuymeacoffee.path} />
            </svg>
          </div>
          <div className="coffee-identity">
            <div className="coffee-name">Joshua Koo</div>
            <div className="coffee-handle">buymeacoffee.com/joshuakoo</div>
          </div>
        </div>
        <div className="coffee-qr-wrap">
          <div className="coffee-qr-card">
            <svg viewBox={`0 0 ${viewSize} ${viewSize}`} shapeRendering="crispEdges" role="img" aria-label="QR code for buymeacoffee.com/joshuakoo">
              <path d={path} fill="#000" />
            </svg>
            <span className="coffee-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="#000">
                <path d={siBuymeacoffee.path} />
              </svg>
            </span>
          </div>
          <div className="coffee-caption">Scan To Buy Me A Coffee</div>
        </div>
        <p className="coffee-tagline">if you enjoy the site, a coffee goes a long way.</p>
        <div className="coffee-actions">
          <button onClick={() => openExternal(links.coffee)}>Buy Me A Coffee</button>
        </div>
      </div>
    </div>
  );
}
