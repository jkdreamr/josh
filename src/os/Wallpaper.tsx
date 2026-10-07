import { useEffect, useMemo, useRef, useState } from 'react';
import { pacificHour, useNow } from './hooks';

type Phase = 'dawn' | 'day' | 'dusk' | 'night';
const PHASES: Phase[] = ['dawn', 'day', 'dusk', 'night'];

/** Part of the Palo Alto day the photo is graded for. */
function phaseFor(h: number): Phase {
  if (h >= 5 && h < 7.5) return 'dawn';
  if (h >= 7.5 && h < 16.5) return 'day';
  if (h >= 16.5 && h < 19.5) return 'dusk';
  return 'night';
}

/**
 * Stanford Memorial Church from the Main Quad. Photo by Clementp1986, CC BY-SA 4.0, cropped:
 * https://commons.wikimedia.org/wiki/File:Stanford_University_-_Universit%C3%A9_Stanford_-_Memorial_Church.jpg
 */
const BASE = '/wallpapers/memorial-church';
const WIDTHS = [1280, 1920, 2880];
const RATIO = 5234 / 3965;
const srcSet = (ext: string) => WIDTHS.map((w) => `${BASE}-${w}.${ext} ${w}w`).join(', ');
const AVIF = srcSet('avif');
const WEBP = srcSet('webp');

function isPhone() {
  const ipadOS = navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent);
  const touch = ipadOS || window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const w = window.innerWidth;
  const h = window.innerHeight;
  return touch ? Math.min(w, h) < 600 : w <= 760;
}

/** CSS px the photo is drawn at (object-fit: cover). Phones are capped so a 3x screen doesn't pull the largest file. */
function drawnWidth(w: number, h: number) {
  const px = Math.ceil(Math.max(w, h * RATIO));
  return isPhone() ? Math.min(px, 640) : px;
}

/** Best guess before the screen exists: the laptop screen is ~60% of the window, handhelds fill it. */
function guessWidth() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const touch = window.matchMedia('(hover: none) and (pointer: coarse)').matches || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  return touch || isPhone() ? drawnWidth(w, h) : Math.min(1240, Math.round(w * 0.6));
}

let initial = 0;
let ready = false;

/** Start fetching and decoding during boot so the photo is there when the desktop appears. */
function preload() {
  if (typeof window === 'undefined' || initial) return;
  initial = guessWidth();
  const picture = document.createElement('picture');
  for (const [type, set] of [
    ['image/avif', AVIF],
    ['image/webp', WEBP],
  ]) {
    const source = document.createElement('source');
    source.type = type;
    source.srcset = set;
    source.sizes = `${initial}px`;
    picture.append(source);
  }
  const img = document.createElement('img');
  img.decoding = 'async';
  img.sizes = `${initial}px`;
  img.srcset = WEBP;
  picture.append(img);
  new Image().src = `${BASE}-sky.png`;
  img
    .decode()
    .then(() => (ready = true))
    .catch(() => {});
}
preload();

const starField = Array.from({ length: 110 }, (_, i) => {
  const r = (n: number) => {
    const x = Math.sin(i * 9301 + n * 49297) * 233280;
    return x - Math.floor(x);
  };
  return { x: r(1) * 100, y: r(2) * 58, s: 0.6 + r(3) * 1.5, d: r(4) * 4 };
});

export default function Wallpaper() {
  const now = useNow(60_000);
  const phase = useMemo(() => phaseFor(pacificHour(now)), [now]);
  const rootRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(ready);
  const [width, setWidth] = useState(() => initial || guessWidth());

  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth) setLoaded(true);
    const el = rootRef.current;
    if (!el) return;
    // only ever grow, so resizing never swaps in a smaller file
    const measure = () => setWidth((cur) => Math.max(cur, drawnWidth(el.offsetWidth, el.offsetHeight)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sizes = `${width}px`;
  return (
    <div ref={rootRef} className={`wallpaper wp-${phase} ${loaded ? 'is-loaded' : ''}`} aria-hidden="true">
      <div className="wp-scene">
        <picture>
          <source type="image/avif" srcSet={AVIF} sizes={sizes} />
          <source type="image/webp" srcSet={WEBP} sizes={sizes} />
          <img ref={imgRef} className="wp-photo" src={`${BASE}-1920.webp`} alt="" decoding="async" draggable={false} onLoad={() => setLoaded(true)} />
        </picture>
      </div>
      {PHASES.map((p) => (
        <div key={p} className={`wp-grade wp-grade-${p} ${p === phase ? 'is-on' : ''}`}>
          {p !== 'day' && (
            <>
              <i className="wp-tint" />
              <i className="wp-sky" />
              <i className="wp-glow" />
            </>
          )}
          {p === 'night' && (
            <div className="wp-stars">
              {starField.map((s, i) => (
                <i key={i} style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, animationDelay: `${s.d}s` }} />
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="wp-vignette" />
    </div>
  );
}
