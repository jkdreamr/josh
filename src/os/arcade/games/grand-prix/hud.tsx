// Heads-up display, one per local driver. Fast-changing numbers are written straight into the DOM every frame
// (no React renders at 60 Hz); the timing tower re-renders a few times a second.
import { useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { SPEC, kmh, revBand, tempGrip } from './car.ts';
import { gapLeader, liveDelta, type Race } from './race.ts';
import { TEAMS, codeOf } from './teams.ts';
import type { Circuit } from './track.ts';

export const fmtLap = (ms: number) => {
  if (!Number.isFinite(ms) || ms < 0) return '-:--.---';
  const t = Math.round(ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const r = t % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
};
export const fmtSec = (s: number) => fmtLap(s * 1000);
const fmtGap = (s: number | null) => (s === null ? 'Leader' : s < 0 ? `+${-s} Lap${s < -1 ? 's' : ''}` : `+${s.toFixed(3)}`);

export type HudApi = { update: (r: Race, idx: number, ref: Float32Array | null) => void; flash: (text: string, tone?: 'warn' | 'good' | 'purple' | 'info') => void };

type Props = { circuit: Circuit; split: boolean; tower: boolean; touch: boolean; apiRef: Ref<HudApi> };

const LEDS = 15;

export function Hud({ circuit, split, tower, touch, apiRef }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const q = (sel: string) => el.current?.querySelector<HTMLElement>(sel) ?? null;
  const [rows, setRows] = useState<{ pos: number; code: string; color: string; gap: string; me: boolean; fin: boolean }[]>([]);
  const lastTower = useRef(0);
  const msgTimer = useRef(0);
  const path = useMemo(() => miniPath(circuit), [circuit]);
  const dotsRef = useRef<SVGGElement>(null);

  useImperativeHandle(apiRef, () => ({
    update(r, idx, ref) {
      const rn = r.runners[idx];
      if (!rn || !el.current) return;
      const car = rn.car;
      const set = (sel: string, text: string) => {
        const n = q(sel);
        if (n && n.textContent !== text) n.textContent = text;
      };
      set('.g-grand-prix-speed b', String(Math.round(kmh(car))));
      set('.g-grand-prix-gear', car.gear === -1 ? 'R' : car.gear === 0 ? 'N' : String(car.gear));
      // rev lights: green, red, then blue at the shift point, flashing on the limiter
      const band = revBand(car);
      const lit = Math.round(band * LEDS);
      const leds = el.current.querySelectorAll<HTMLElement>('.g-grand-prix-led');
      const flash = car.rpm > SPEC.shiftRpm + 150 && Math.floor(performance.now() / 70) % 2 === 0;
      leds.forEach((led, k) => {
        const on = k < lit && !flash;
        led.dataset.on = on ? (k < 5 ? 'g' : k < 10 ? 'r' : 'b') : '';
      });
      const thr = q('.g-grand-prix-thr i');
      const brk = q('.g-grand-prix-brk i');
      if (thr) thr.style.transform = `scaleY(${car.throttle.toFixed(3)})`;
      if (brk) brk.style.transform = `scaleY(${car.brake.toFixed(3)})`;
      const ers = q('.g-grand-prix-ers i');
      if (ers) ers.style.transform = `scaleX(${Math.max(0, car.ers / SPEC.ersStore).toFixed(3)})`;
      const ersBox = q('.g-grand-prix-ers');
      if (ersBox) ersBox.dataset.on = car.ersOn ? '1' : '';
      const drs = q('.g-grand-prix-drs');
      if (drs) drs.dataset.state = car.drs ? 'open' : rn.drsOk ? 'ready' : rn.drsArmed ? 'armed' : '';
      // tyre temperatures: blue cold, green in the window, red hot
      el.current.querySelectorAll<HTMLElement>('.g-grand-prix-tyre').forEach((t, k) => {
        const temp = car.wheels[k].temp;
        t.style.background = tyreColor(temp);
        t.title = `${Math.round(temp)} C`;
        const n = t.querySelector('b');
        if (n) n.textContent = String(Math.round(temp));
      });

      // timing
      const lapTime = r.mode === 'race' && r.time < 0 ? 0 : r.time - rn.lapStart;
      const racing = rn.flying || r.mode === 'race';
      set('.g-grand-prix-laptime', racing ? fmtSec(Math.max(0, lapTime)) : 'Out Lap');
      const lastLap = rn.laps[rn.laps.length - 1];
      set('.g-grand-prix-last b', lastLap ? fmtSec(lastLap.time) + (lastLap.valid ? '' : ' *') : '-:--.---');
      set('.g-grand-prix-best b', rn.best ? fmtSec(rn.best.time) : '-:--.---');
      const lapEl = q('.g-grand-prix-laptime');
      if (lapEl) lapEl.dataset.invalid = rn.lapValid ? '' : '1';
      const delta = liveDelta(r, rn, ref);
      const dEl = q('.g-grand-prix-delta');
      if (dEl) {
        dEl.textContent = delta === null ? '' : `${delta >= 0 ? '+' : '-'}${Math.abs(delta).toFixed(2)}`;
        dEl.dataset.tone = delta === null ? '' : delta <= 0 ? 'good' : 'bad';
      }
      const sectors = el.current.querySelectorAll<HTMLElement>('.g-grand-prix-sector');
      sectors.forEach((sEl, k) => {
        const done = k < rn.splits.length;
        const time = done ? (k === 0 ? rn.splits[0] : rn.splits[k] - rn.splits[k - 1]) : null;
        let tone = '';
        if (time !== null) {
          if (r.bestSectors[k] !== undefined && time <= r.bestSectors[k] + 1e-6) tone = 'purple';
          else if (rn.bestSectors[k] !== undefined && time <= rn.bestSectors[k] + 1e-6) tone = 'green';
          else tone = 'yellow';
        }
        sEl.dataset.tone = tone;
      });
      if (r.mode === 'race') {
        const pos = r.order.indexOf(idx) + 1;
        set('.g-grand-prix-pos b', `P${pos}`);
        set('.g-grand-prix-pos small', `/${r.runners.filter((x) => !x.out).length}`);
        set('.g-grand-prix-lap', `Lap ${Math.min(r.laps, rn.lap + 1)}/${r.laps}`);
      } else {
        set('.g-grand-prix-pos b', '');
        set('.g-grand-prix-pos small', '');
        set('.g-grand-prix-lap', rn.flying ? `Lap ${rn.laps.length + 1}/${r.laps}` : 'Out Lap');
      }
      // start lights
      const lights = el.current.querySelectorAll<HTMLElement>('.g-grand-prix-light');
      const showLights = r.mode === 'race' && r.time < 0.8 && r.time > r.lightsFrom - 1.5;
      const lightsBox = q('.g-grand-prix-lights');
      if (lightsBox) lightsBox.dataset.show = showLights ? '1' : '';
      lights.forEach((l, k) => (l.dataset.on = r.lights > Math.floor(k / 2) ? '1' : ''));

      // minimap dots
      const g = dotsRef.current;
      if (g) {
        const circles = g.children;
        r.runners.forEach((x, k) => {
          const dot = circles[k] as SVGCircleElement | undefined;
          if (!dot) return;
          dot.setAttribute('cx', ((x.car.x - path.minX) * path.k).toFixed(1));
          dot.setAttribute('cy', ((path.maxY - x.car.y) * path.k).toFixed(1));
          dot.style.display = x.out ? 'none' : '';
          dot.setAttribute('r', k === idx ? '8' : '5');
          dot.setAttribute('fill', k === idx ? '#ffffff' : TEAMS[x.entry.team % TEAMS.length].body);
        });
      }

      // the tower a few times a second
      const now = performance.now();
      if (tower && now - lastTower.current > 300) {
        lastTower.current = now;
        const order = r.order;
        const mePos = order.indexOf(idx);
        const show = new Set<number>();
        for (let k = 0; k < Math.min(order.length, split ? 3 : 5); k++) show.add(k);
        for (let k = Math.max(0, mePos - 2); k <= Math.min(order.length - 1, mePos + 2); k++) show.add(k);
        setRows(
          [...show]
            .sort((a, b) => a - b)
            .map((k) => {
              const rr = r.runners[order[k]];
              const gap = r.mode === 'race' ? (k === mePos ? fmtGap(gapLeader(r, rr.idx)) : relGap(r, idx, rr.idx)) : rr.best ? fmtSec(rr.best.time) : '-';
              return { pos: k + 1, code: codeOf(rr.entry.name), color: TEAMS[rr.entry.team % TEAMS.length].body, gap, me: rr.idx === idx, fin: rr.fin !== null };
            }),
        );
      }
      if (msgTimer.current && now > msgTimer.current) {
        msgTimer.current = 0;
        const m = q('.g-grand-prix-msg');
        if (m) m.dataset.show = '';
      }
    },
    flash(text, tone = 'info') {
      const m = q('.g-grand-prix-msg');
      if (!m) return;
      m.textContent = text;
      m.dataset.tone = tone;
      m.dataset.show = '';
      void m.offsetWidth;
      m.dataset.show = '1';
      msgTimer.current = performance.now() + 2200;
    },
  }));

  return (
    <div ref={el} className={`g-grand-prix-hud${split ? ' is-split' : ''}${touch ? ' is-touch' : ''}`}>
      <div className="g-grand-prix-top">
        <div className="g-grand-prix-poslap">
          <div className="g-grand-prix-pos">
            <b />
            <small />
          </div>
          <div className="g-grand-prix-lap" />
        </div>
        {tower && rows.length > 0 && (
          <ol className="g-grand-prix-tower">
            {rows.map((row) => (
              <li key={row.pos} data-me={row.me ? '1' : ''}>
                <span className="g-grand-prix-tpos">{row.pos}</span>
                <i style={{ background: row.color }} />
                <span className="g-grand-prix-tcode">{row.code}</span>
                <span className="g-grand-prix-tgap">{row.fin ? 'Fin' : row.gap}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="g-grand-prix-timing">
        <div className="g-grand-prix-laptime" />
        <div className="g-grand-prix-delta" />
        <div className="g-grand-prix-sectors">
          <i className="g-grand-prix-sector" />
          <i className="g-grand-prix-sector" />
          <i className="g-grand-prix-sector" />
        </div>
        <div className="g-grand-prix-last">
          Last <b />
        </div>
        <div className="g-grand-prix-best">
          Best <b />
        </div>
      </div>
      <div className="g-grand-prix-lights" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((k) => (
          <span key={k}>
            <i className="g-grand-prix-light" />
            <i className="g-grand-prix-light" />
          </span>
        ))}
      </div>
      <div className="g-grand-prix-msg" role="status" />
      <div className="g-grand-prix-dash">
        <div className="g-grand-prix-leds">
          {Array.from({ length: LEDS }, (_, k) => (
            <i key={k} className="g-grand-prix-led" />
          ))}
        </div>
        <div className="g-grand-prix-dashrow">
          <div className="g-grand-prix-pedals">
            <div className="g-grand-prix-thr">
              <i />
            </div>
            <div className="g-grand-prix-brk">
              <i />
            </div>
          </div>
          <div className="g-grand-prix-gearbox">
            <div className="g-grand-prix-gear" />
            <div className="g-grand-prix-speed">
              <b /> km/h
            </div>
          </div>
          <div className="g-grand-prix-tyres" aria-label="Tyre temperatures">
            {[0, 1, 2, 3].map((k) => (
              <i key={k} className="g-grand-prix-tyre">
                <b />
              </i>
            ))}
          </div>
        </div>
        <div className="g-grand-prix-dashrow">
          <div className="g-grand-prix-ers">
            <span>ERS</span>
            <i />
          </div>
          <div className="g-grand-prix-drs">DRS</div>
        </div>
      </div>
      {!split && (
        <svg className="g-grand-prix-map" viewBox={`0 0 ${path.w.toFixed(0)} ${path.h.toFixed(0)}`} aria-hidden="true">
          <path d={path.d} />
          <g ref={dotsRef}>
            {Array.from({ length: 24 }, (_, k) => (
              <circle key={k} r={5} cx={-99} cy={-99} />
            ))}
          </g>
        </svg>
      )}
    </div>
  );
}

function relGap(r: Race, me: number, other: number) {
  const a = r.runners[me];
  const b = r.runners[other];
  const d = (b.dist - a.dist) / Math.max(20, Math.abs(a.car.vx));
  if (Math.abs(b.dist - a.dist) > r.c.length) return `${b.dist > a.dist ? '-' : '+'}${Math.floor(Math.abs(b.dist - a.dist) / r.c.length)}L`;
  return `${d > 0 ? '-' : '+'}${Math.abs(d).toFixed(1)}`;
}

function tyreColor(t: number) {
  if (t < 80) return `hsl(${210 - (80 - Math.max(40, t)) * 0.5} 80% 52%)`;
  if (t > 112) return `hsl(${Math.max(0, 40 - (t - 112) * 2)} 85% 52%)`;
  // in the window: green, fading toward yellow near its edges
  const g = tempGrip(t);
  return `hsl(${90 + (g - 0.9) * 300} 70% 45%)`;
}

function miniPath(c: Circuit) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < c.n; i++) {
    minX = Math.min(minX, c.px[i]);
    maxX = Math.max(maxX, c.px[i]);
    minY = Math.min(minY, c.py[i]);
    maxY = Math.max(maxY, c.py[i]);
  }
  const pad = 30;
  minX -= pad;
  maxX += pad;
  minY -= pad;
  maxY += pad;
  const k = 300 / Math.max(maxX - minX, maxY - minY);
  let d = '';
  for (let i = 0; i < c.n; i += 4) d += `${i ? 'L' : 'M'}${((c.px[i] - minX) * k).toFixed(1)} ${((maxY - c.py[i]) * k).toFixed(1)}`;
  return { d: d + 'Z', minX, maxY, k, w: (maxX - minX) * k, h: (maxY - minY) * k };
}

