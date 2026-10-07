import { useEffect, useRef, useState } from 'react';
import { useOS, type AppProps } from '../types';

const filters = [
  { name: 'Normal', css: 'none' },
  { name: 'Mono', css: 'grayscale(1) contrast(1.15)' },
  { name: 'Film', css: 'sepia(.45) saturate(1.3) contrast(1.05) hue-rotate(-8deg)' },
  { name: 'Vivid', css: 'saturate(1.9) contrast(1.1)' },
  { name: 'Cardinal', css: 'sepia(1) saturate(4) hue-rotate(-40deg) contrast(1.1)' },
  { name: 'Thermal', css: 'invert(1) hue-rotate(180deg) saturate(3)' },
  { name: 'Dream', css: 'brightness(1.1) saturate(1.4) hue-rotate(240deg) blur(.4px)' },
];

type State = 'idle' | 'starting' | 'live' | 'denied';

export default function PhotoBooth(_: AppProps) {
  const [state, setState] = useState<State>('idle');
  const [filter, setFilter] = useState(0);
  const [count, setCount] = useState(0);
  const [flash, setFlash] = useState(false);
  const [shots, setShots] = useState<string[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const os = useOS();
  const setCamera = useRef(os.setCamera);
  setCamera.current = os.setCamera;
  const alive = useRef(true);

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCamera.current(false);
  };

  useEffect(
    () => () => {
      alive.current = false;
      stop();
    },
    [],
  );

  const start = async () => {
    setState('starting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false });
      if (!alive.current) return s.getTracks().forEach((t) => t.stop());
      stream.current = s;
      setCamera.current(true);
      // the OS or browser can end the stream from outside the app (permissions, another tab)
      for (const t of s.getTracks())
        t.addEventListener('ended', () => {
          if (stream.current !== s) return;
          stop();
          if (alive.current) setState('idle');
        });
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      setState('live');
    } catch {
      setState('denied');
    }
  };

  const snap = () => {
    if (count) return;
    let n = 3;
    setCount(n);
    const tick = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCount(n);
        return;
      }
      clearInterval(tick);
      setCount(0);
      const v = video.current;
      if (!v || !v.videoWidth) return;
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext('2d')!;
      ctx.filter = filters[filter].css;
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, 0, 0);
      setFlash(true);
      setTimeout(() => setFlash(false), 380);
      setShots((s) => [c.toDataURL('image/jpeg', 0.9), ...s].slice(0, 8));
    }, 800);
  };

  return (
    <div className="booth">
      <div className="booth-stage">
        <video ref={video} playsInline muted style={{ filter: filters[filter].css }} className={state === 'live' ? 'is-on' : ''} />
        {state !== 'live' && (
          <div className="booth-idle">
            {state === 'denied' ? (
              <>
                <b>camera blocked</b>
                <p>allow camera access in your browser to take a photo. nothing ever leaves your device.</p>
                <button className="btn btn-primary" onClick={start}>
                  try again
                </button>
              </>
            ) : (
              <>
                <b>photo booth</b>
                <p>snap a selfie on josh’s computer. it stays in your browser. nothing is uploaded.</p>
                <button className="btn btn-primary" onClick={start} disabled={state === 'starting'}>
                  {state === 'starting' ? 'starting camera…' : 'turn on camera'}
                </button>
              </>
            )}
          </div>
        )}
        {count > 0 && <div className="booth-count">{count}</div>}
        <div className={`booth-flash ${flash ? 'is-on' : ''}`} />
      </div>
      <div className="booth-bar">
        <div className="booth-filters">
          {filters.map((f, i) => (
            <button key={f.name} className={i === filter ? 'is-sel' : ''} onClick={() => setFilter(i)}>
              {f.name}
            </button>
          ))}
        </div>
        <button className="booth-shutter" aria-label="Take photo" disabled={state !== 'live'} onClick={snap}>
          <span />
        </button>
      </div>
      {shots.length > 0 && (
        <div className="booth-strip">
          {shots.map((s, i) => (
            <a key={s.slice(-24) + i} href={s} download={`josh-photobooth-${i + 1}.jpg`} title="Download">
              <img src={s} alt={`Photo ${i + 1}`} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
