// Interface pieces for Paper.io: skin swatches, the skin locker and How to Play sheets, and the minimap painter.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { drawSkin } from './art.ts';
import { SKINS, colorOf, unlockText, type Locker } from './skins.ts';
import type { World } from './world.ts';

/** A skin's cube top, painted on a little canvas. */
export function SkinIcon({ skin, size = 44, color }: { skin: number; size?: number; color?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.height = Math.round(size * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    const s = SKINS[skin] ?? SKINS[0];
    drawSkin(g, c.width, s.pattern, color ?? s.color);
  }, [skin, size, color]);
  return <canvas ref={ref} className="g-paperio-skinicon" style={{ width: size, height: size }} aria-hidden="true" />;
}

/** A sheet over the whole game (portaled into the shell so it covers the Start and Pause cards). */
export function Sheet({ root, title, onClose, children }: { root: HTMLElement | null; title: string; onClose: () => void; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  const done = useRef(onClose);
  done.current = onClose;
  useEffect(() => {
    close.current?.focus({ preventScroll: true });
    if (!root) return;
    // keys stay in the sheet: Escape closes it, nothing reaches the game behind (the shell listens on the same root,
    // after this capture listener). Cmd, Ctrl and Alt combos pass, so site shortcuts like Cmd+K still work.
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        done.current();
      }
    };
    root.addEventListener('keydown', onKey, true);
    return () => root.removeEventListener('keydown', onKey, true);
  }, [root]);
  if (!root) return null;
  return createPortal(
    <div
      className="g-paperio-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="g-paperio-sheet-card">
        <header>
          <h2>{title}</h2>
          <button type="button" ref={close} className="arcade-btn" onClick={onClose}>
            Done
          </button>
        </header>
        <div className="g-paperio-sheet-body">{children}</div>
      </div>
    </div>,
    root,
  );
}

/** `roundPick`: on the Pause card, the skin the round in progress wears (a new pick shows from the next round). */
export function SkinSheet({ root, locker, roundPick = null, onPick, onClose }: { root: HTMLElement | null; locker: Locker; roundPick?: number | null; onPick: (id: number) => void; onClose: () => void }) {
  const have = new Set(locker.have);
  const s = locker.stats;
  const later = roundPick !== null && roundPick !== locker.pick;
  return (
    <Sheet root={root} title="Skins" onClose={onClose}>
      <p className="g-paperio-lede">Your cube and your color. Hit the milestones to unlock more, they stay on this device.</p>
      {roundPick !== null && <p className="g-paperio-note">{later ? 'Your new pick shows from the next round.' : 'A new pick shows from the next round.'}</p>}
      <div className="g-paperio-skins">
        {SKINS.map((skin) => {
          const owned = have.has(skin.id);
          const on = locker.pick === skin.id;
          return (
            <button
              key={skin.id}
              type="button"
              className={`g-paperio-skin${on ? ' is-on' : ''}${owned ? '' : ' is-locked'}`}
              disabled={!owned}
              aria-pressed={on}
              aria-label={owned ? `${skin.name} skin` : `${skin.name}, locked: ${unlockText(skin.unlock)}`}
              onClick={() => owned && onPick(skin.id)}
            >
              <SkinIcon skin={skin.id} size={52} />
              <b>{skin.name}</b>
              <small>{owned ? (on ? (later ? 'next round' : 'wearing') : 'tap to wear') : unlockText(skin.unlock)}</small>
            </button>
          );
        })}
      </div>
      <dl className="g-paperio-stats">
        <dt>best life</dt>
        <dd>{s.best.toFixed(2)}%</dd>
        <dt>cuts</dt>
        <dd>{s.kills}</dd>
        <dt>best streak</dt>
        <dd>{s.streak}</dd>
        <dt>rounds</dt>
        <dd>{s.games}</dd>
      </dl>
    </Sheet>
  );
}

export function HowToPlay({ root, touch, online = false, onClose }: { root: HTMLElement | null; touch: boolean; online?: boolean; onClose: () => void }) {
  return (
    <Sheet root={root} title="How to Play" onClose={onClose}>
      <p className="g-paperio-lede">Grab as much of the farm as you can. You start on a small patch of your own color.</p>
      <section>
        <h3>Controls</h3>
        <dl className="g-paperio-keys">
          {touch ? (
            <>
              <dt>drag</dt>
              <dd>Put a finger down anywhere and drag the way you want to go</dd>
              <dt>2 players</dt>
              <dd>Each player drags on their own half of the screen</dd>
            </>
          ) : (
            <>
              <dt>mouse</dt>
              <dd>Your cube steers toward the pointer</dd>
              <dt>A D or ← →</dt>
              <dd>Turn left and right</dd>
              <dt>2 players</dt>
              <dd>Player 1 turns with A and D, player 2 with the arrow keys</dd>
              <dt>Esc</dt>
              <dd>{online ? 'Online rounds keep going, there is no pause' : 'Pause'}</dd>
            </>
          )}
        </dl>
      </section>
      <section>
        <h3>Rules</h3>
        <ul>
          <li>
            <b>Leave your land</b> and you draw a trail behind you.
          </li>
          <li>
            <b>Get back home</b> and the trail turns into land, plus everything it closed off, even other players' land.
          </li>
          <li>
            <b>Cut a trail</b> by running into it and its owner is out. Their land goes blank.
          </li>
          <li>
            <b>Never touch your own trail.</b> While you are out, you are exposed.
          </li>
          <li>
            <b>Heads meeting:</b> whoever is safe on their own land wins. Two heads out in the open both crash.
          </li>
          <li>
            <b>Take all of someone's land</b> and they are wiped out. Take all of the map and you win.
          </li>
        </ul>
      </section>
      <section>
        <h3>Modes</h3>
        <ul>
          <li>
            <b>Solo</b> is classic: one life against the bots. Your score is the most land you held.
          </li>
          <li>
            <b>2 players</b> and <b>online</b> are timed matches. Crash and you are back in three seconds with a fresh patch. Most land at the buzzer wins.
          </li>
        </ul>
      </section>
      <section>
        <h3>Tips</h3>
        <ul>
          <li>Small loops are safe, big loops pay. Watch who is near your trail.</li>
          <li>Bots see you a beat late. A quick cut catches them out.</li>
          <li>Skins unlock as you hit milestones: 10%, 25%, 50%, cuts and streaks.</li>
        </ul>
      </section>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Minimap

export type MiniMap = { canvas: HTMLCanvasElement; img: ImageData; tmp: HTMLCanvasElement; colors: Uint8Array; drawnAt: number; size: number };

const MINI = 120;

export function createMiniMap(canvas: HTMLCanvasElement): MiniMap | null {
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = MINI;
  const g = tmp.getContext('2d');
  if (!g) return null;
  const colors = new Uint8Array(17 * 3);
  return { canvas, img: g.createImageData(MINI, MINI), tmp, colors, drawnAt: -1, size: 0 };
}

/** Repaints the land picture (call a few times a second) and the heads (every call). */
export function paintMiniMap(m: MiniMap, w: World, mine: number[], now: number, heads: { x: number; y: number; color: string; me: boolean }[], count = heads.length) {
  const c = m.canvas;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (now - m.drawnAt > 0.35 || m.drawnAt < 0) {
    m.drawnAt = now;
    // the size is read only now and then: reading layout every frame would force a reflow
    m.size = c.clientWidth;
    if (m.size && c.width !== Math.round(m.size * dpr)) c.width = c.height = Math.round(m.size * dpr);
    for (const p of w.players) {
      if (!p) continue;
      const hex = colorOf(p.color);
      m.colors[(p.id + 1) * 3] = parseInt(hex.slice(1, 3), 16);
      m.colors[(p.id + 1) * 3 + 1] = parseInt(hex.slice(3, 5), 16);
      m.colors[(p.id + 1) * 3 + 2] = parseInt(hex.slice(5, 7), 16);
    }
    const d = m.img.data;
    const n = w.n;
    const scale = n / MINI;
    for (let y = 0; y < MINI; y++) {
      const gy = Math.min(n - 1, Math.floor((y + 0.5) * scale));
      for (let x = 0; x < MINI; x++) {
        const gx = Math.min(n - 1, Math.floor((x + 0.5) * scale));
        const k = gy * n + gx;
        const i = (y * MINI + x) * 4;
        if (!w.arena[k]) {
          d[i + 3] = 0;
          continue;
        }
        const o = w.owner[k];
        if (o) {
          const mineCell = mine.includes(o - 1);
          d[i] = m.colors[o * 3];
          d[i + 1] = m.colors[o * 3 + 1];
          d[i + 2] = m.colors[o * 3 + 2];
          d[i + 3] = mineCell ? 255 : 210;
        } else {
          d[i] = 246;
          d[i + 1] = 240;
          d[i + 2] = 228;
          d[i + 3] = 235;
        }
      }
    }
    m.tmp.getContext('2d')?.putImageData(m.img, 0, 0);
  }
  if (!m.size) return;
  const g = c.getContext('2d');
  if (!g) return;
  const S = c.width;
  g.clearRect(0, 0, S, S);
  g.save();
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
  g.clip();
  g.imageSmoothingEnabled = true;
  g.drawImage(m.tmp, 0, 0, S, S);
  g.restore();
  const k = S / w.n;
  for (let i = 0; i < count; i++) {
    const h = heads[i];
    g.beginPath();
    g.arc(h.x * k, h.y * k, h.me ? 4.2 * dpr : 2.6 * dpr, 0, Math.PI * 2);
    g.fillStyle = h.me ? '#fff' : h.color;
    g.fill();
    g.lineWidth = (h.me ? 2 : 1.2) * dpr;
    g.strokeStyle = h.me ? h.color : 'rgba(40,24,10,0.6)';
    g.stroke();
  }
}
