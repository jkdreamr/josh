// Everything drawn over the 3D view: the round bar (or a royale's players left and zone clock), health, armor and ammo,
// the kill feed, the minimap with the sites, the charge and the zone, markers for the sites, the charge and your team,
// the buy menu, the scoreboard, banners, plant, defuse, pick up and heal prompts, a vehicle's speed and health, the
// crosshair, hit markers and the scope.
import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import type { Mode, NadeKind, Phase, ShopItem } from './match.ts';
import { BOOST_FAST, HEAL, type UseKind } from './royale.ts';
import { ARMOR, NADES, PAVISE, WEAPONS, type WeaponId } from './weapons.ts';
import type { World } from './world.ts';

export type FeedItem = { id: number; killer: string; victim: string; kc: string; vc: string; w: string; head: boolean; mine: boolean };
export type Row = { name: string; team: number; k: number; d: number; a: number; cs: number; credits: number | null; alive: boolean; you: boolean };
export type Hud = {
  mode: Mode;
  phase: Phase;
  timer: number;
  round: number;
  score: [number, number];
  pips: [boolean[], boolean[]];
  breach: BreachHud | null;
  hp: number;
  /** What a full bar reads: people are tougher than bots (their health counts for more). */
  hpMax: number;
  armor: number;
  credits: number;
  gun: { name: string; mag: number; reserve: number; max: number; cls: string; scope: boolean } | null;
  slot: number;
  guns: (WeaponId | null)[];
  frags: number;
  smokes: number;
  flashes: number;
  fires: number;
  impacts: number;
  decoys: number;
  /** The grenade G throws (T steps through what you carry). */
  pick: NadeKind;
  /** A ballistic shield carried: what it has left (0 to 1), and whether it is raised. */
  pavise: number;
  paviseUp: boolean;
  /** How white your screen is from a flashbang, 0 to 1. */
  blind: number;
  canBuy: boolean;
  alive: boolean;
  dead: { by: string; w: string; head: boolean; respawn: number } | null;
  watching: string | null;
  feed: FeedItem[];
  dm: { kills: number; top: number; topName: string; place: number; total: number } | null;
  scoped: boolean;
  reload: number;
  rows: Row[];
  owned: Partial<Record<ShopItem, boolean>>;
  royale: RoyaleHud | null;
};

export type BreachHud = {
  /** Your side this round. */
  side: 'attack' | 'defend';
  charge: 'carried' | 'dropped' | 'planted' | 'defused' | 'blown';
  /** You carry the charge. */
  carrying: boolean;
  /** The site it is planted on. */
  site: string | null;
  /** Seconds left on the fuse once planted. */
  fuse: number;
  /** Your plant or defuse under way, 0 to 1, and its half way mark kept (defuse). */
  work: 'plant' | 'defuse' | null;
  progress: number;
  kept: number;
  /** What holding the use key would do where you stand. */
  prompt: 'plant' | 'defuse' | null;
  /** A teammate is on the charge (planting or defusing). */
  mateWorking: string | null;
};

export type RoyaleHud = {
  alive: number;
  total: number;
  kills: number;
  /** Seconds to the next zone change, and whether it is closing now; -1 once it has closed. */
  zoneT: number;
  closing: boolean;
  /** How far outside the zone you are (0 inside), and its damage there. */
  outside: number;
  dps: number;
  place: number;
  /** 1 aboard the transport, 2 in freefall, 3 under the canopy, 0 down. */
  drop: number;
  vest: number;
  helmet: number;
  /** Backpack level (0 none), heals and boosts carried, and the boost meter, 0 to 100. */
  pack: number;
  bandages: number;
  kits: number;
  drinks: number;
  pills: number;
  boost: number;
  /** A heal or boost under way, 0 to 1, and what it is. */
  heal: number;
  healName: string | null;
  pickup: string | null;
  /** A bombardment you are inside: meters out to its edge, whether shells are falling yet (else the seconds until
   * they do), and whether a roof keeps you safe where you stand. Null when you are clear of it. */
  red: { edge: number; live: boolean; t: number; cover: boolean } | null;
  /** In a vehicle: what it is, its speed in km/h, its health (0 to 1), and whether you drive it. */
  car: { name: string; kmh: number; hp: number; driving: boolean } | null;
  /** A vehicle at hand: what F does there ('drive Jeep', 'ride in Jeep'). */
  drive: string | null;
  /** The kit item being used now, the most of each you can carry, and whether each would help right now. */
  using: UseKind | null;
  caps: Record<UseKind, number>;
  helps: Record<UseKind, boolean>;
  /** Ammo by kind (rounds and the most you can carry), grenades and their caps, and your two long guns' names (with
   * what is fitted) and the sidearm's, for the kit panel. */
  ammo: { kind: string; n: number; cap: number }[];
  nades: { frag: number; fragCap: number; smoke: number; smokeCap: number };
  guns: string[];
  /** A supply crate with gear left near you: how far (-1 none near). */
  crate: number;
};

export const blankHud = (mode: Mode): Hud => ({
  mode,
  phase: 'buy',
  timer: 0,
  round: 1,
  score: [0, 0],
  pips: [[], []],
  breach: null,
  hp: 100,
  hpMax: 150,
  armor: 0,
  credits: 0,
  gun: null,
  slot: 1,
  guns: [null, null, null],
  frags: 0,
  smokes: 0,
  flashes: 0,
  fires: 0,
  impacts: 0,
  decoys: 0,
  pick: 'frag',
  pavise: 0,
  paviseUp: false,
  blind: 0,
  canBuy: false,
  alive: true,
  dead: null,
  watching: null,
  feed: [],
  dm: null,
  scoped: false,
  reload: 0,
  rows: [],
  owned: {},
  royale: null,
});

const clock = (t: number) => {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function TopBar({ h }: { h: Hud }) {
  const r = h.royale;
  if (h.mode === 'royale' && r) {
    return (
      <div className="g-ridgeline-top">
        <div className="g-ridgeline-score is-you">
          <b>{r.alive}</b>
          <small>alive</small>
        </div>
        <div className="g-ridgeline-clock">
          <b>{r.zoneT >= 0 ? clock(r.zoneT) : '-'}</b>
          <small>{r.zoneT < 0 ? 'zone closed' : r.closing ? 'zone closing' : 'zone holds'}</small>
        </div>
        <div className="g-ridgeline-score is-them">
          <b>{r.kills}</b>
          <small>kills</small>
        </div>
      </div>
    );
  }
  if (h.mode === 'dm' && h.dm) {
    return (
      <div className="g-ridgeline-top">
        <div className="g-ridgeline-score is-you">
          <b>{h.dm.kills}</b>
          <small>you</small>
        </div>
        <div className="g-ridgeline-clock">
          <b>{clock(h.timer)}</b>
          <small>first to 25</small>
        </div>
        <div className="g-ridgeline-score is-them">
          <b>{h.dm.top}</b>
          <small>{h.dm.topName}</small>
        </div>
      </div>
    );
  }
  const br = h.breach;
  const planted = br?.charge === 'planted' && h.phase === 'live';
  const sub =
    h.phase === 'buy'
      ? `buy phase. ${br?.side === 'attack' ? 'you attack' : 'you defend'}`
      : h.phase === 'end'
        ? 'round over'
        : planted
          ? `charge planted on ${br?.site}`
          : `round ${h.round}. ${br?.side === 'attack' ? 'attacking' : 'defending'}`;
  return (
    <div className="g-ridgeline-top">
      <div className="g-ridgeline-score is-you">
        <b>{h.score[0]}</b>
        <span className="g-ridgeline-pips">{h.pips[0].map((a, i) => <i key={i} className={a ? 'is-on' : ''} />)}</span>
      </div>
      <div className="g-ridgeline-clock" data-planted={planted ? '1' : '0'}>
        <b>{planted ? clock(br?.fuse ?? 0) : clock(h.timer)}</b>
        <small>{sub}</small>
        {br && (
          <span className="g-ridgeline-side" data-side={br.side}>
            {br.side === 'attack' ? 'ATK' : 'DEF'}
          </span>
        )}
      </div>
      <div className="g-ridgeline-score is-them">
        <b>{h.score[1]}</b>
        <span className="g-ridgeline-pips">{h.pips[1].map((a, i) => <i key={i} className={a ? 'is-on' : ''} />)}</span>
      </div>
    </div>
  );
}

/** Breach: what holding the use key does here (plant, defuse), the progress while you do it, and what the charge is up
 * to. */
export function BreachPrompts({ h, touch }: { h: Hud; touch: boolean }) {
  const br = h.breach;
  if (!br || !h.alive || h.phase !== 'live') return null;
  const key = touch ? (br.prompt === 'defuse' ? 'Defuse' : 'Plant') : 'F';
  return (
    <>
      {br.work ? (
        <div className="g-ridgeline-healing g-ridgeline-work" data-work={br.work}>
          <span>{br.work === 'plant' ? 'planting the charge' : 'defusing'}</span>
          <i style={{ width: `${Math.min(1, br.progress) * 100}%` }} />
          {br.work === 'defuse' && br.kept > 0 && <em style={{ left: `${br.kept * 100}%` }} />}
        </div>
      ) : br.prompt ? (
        <div className="g-ridgeline-prompt is-charge">
          hold <kbd>{key}</kbd>
          {br.prompt === 'plant' ? 'to plant the charge' : 'to defuse the charge'}
        </div>
      ) : br.carrying ? (
        <div className="g-ridgeline-hint">you carry the charge. plant it on A or B</div>
      ) : br.mateWorking ? (
        <div className="g-ridgeline-hint">{br.mateWorking}</div>
      ) : null}
    </>
  );
}

export function Vitals({ h }: { h: Hud }) {
  return (
    <div className="g-ridgeline-vitals">
      <div className="g-ridgeline-hp">
        <b>{Math.ceil((h.hp * h.hpMax) / 100)}</b>
        <span className="g-ridgeline-hpBar">
          <i style={{ width: `${h.hp}%` }} className={h.hp < 35 ? 'is-low' : ''} />
        </span>
        {h.royale && (
          <span className="g-ridgeline-boostBar" data-fast={h.royale.boost >= BOOST_FAST ? '1' : '0'} title="boost">
            <i style={{ width: `${h.royale.boost}%` }} />
          </span>
        )}
      </div>
      <div className="g-ridgeline-armor" data-on={h.armor > 0 ? '1' : '0'}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z" />
        </svg>
        <b>{Math.ceil(h.armor)}</b>
      </div>
      {h.royale && (
        <div className="g-ridgeline-kit">
          <span data-on={h.royale.helmet ? '1' : '0'}>helmet {h.royale.helmet || '-'}</span>
          <span data-on={h.royale.vest ? '1' : '0'}>vest {h.royale.vest || '-'}</span>
          <span data-on={h.royale.pack ? '1' : '0'}>pack {h.royale.pack || '-'}</span>
          <span data-on="1">
            <kbd>H</kbd>heal <kbd>X</kbd>boost <kbd>I</kbd>kit
          </span>
        </div>
      )}
      {h.mode === 'breach' && (
        <div className="g-ridgeline-credits">
          <span>¤</span>
          {h.credits}
        </div>
      )}
    </div>
  );
}

export function Ammo({ h }: { h: Hud }) {
  const g = h.gun;
  return (
    <div className="g-ridgeline-ammo">
      {g && (
        <>
          <div className="g-ridgeline-mag">
            <b className={g.mag <= Math.ceil(g.max * 0.25) ? 'is-low' : ''}>{g.mag}</b>
            <span>/ {h.mode === 'dm' ? '∞' : g.reserve}</span>
          </div>
          <div className="g-ridgeline-gunName">{g.name}</div>
          {g.scope && !h.scoped && <div className="g-ridgeline-scopeHint">right click or hold Z to scope</div>}
          {h.reload > 0 && (
            <div className="g-ridgeline-reload">
              <i style={{ width: `${h.reload * 100}%` }} />
            </div>
          )}
        </>
      )}
      <div className="g-ridgeline-slots">
        {[0, 2, 1].map((k, i) => {
          const id = h.guns[k];
          return (
            <span key={k} className={k === h.slot ? 'is-on' : ''} data-empty={id ? '0' : '1'}>
              <kbd>{i + 1}</kbd>
              {id ? WEAPONS[id].name : '-'}
            </span>
          );
        })}
        {NADE_CHIPS.map(([kind, key, label]) => {
          const n = nadeCount(h, kind);
          // (a royale has no flashbangs, and keeps its number keys for the kit: the others are thrown with G)
          if (kind === 'flash' && h.mode !== 'breach') return null;
          if (!n && h.mode !== 'breach' && kind !== 'frag' && kind !== 'smoke') return null;
          const k = h.mode === 'royale' && key > 5 ? '' : String(key);
          return (
            <span key={kind} className={h.pick === kind && n ? 'is-on' : ''} data-empty={n ? '0' : '1'}>
              {k && <kbd>{k}</kbd>}
              {label} {n}
            </span>
          );
        })}
        {h.pavise > 0 && (
          <span className={h.paviseUp ? 'is-on' : ''} data-empty="0">
            <kbd>V</kbd>shield {Math.round(h.pavise * 100)}%
          </span>
        )}
      </div>
      <div className="g-ridgeline-nadeHint">
        <kbd>G</kbd> throw {NADE_LABEL[h.pick]} <kbd>T</kbd> next
      </div>
    </div>
  );
}

export function Feed({ items }: { items: FeedItem[] }) {
  return (
    <div className="g-ridgeline-feed" aria-live="polite">
      {items.map((f) => (
        <div key={f.id} className={f.mine ? 'is-mine' : ''}>
          <b style={{ color: f.kc }}>{f.killer}</b>
          <span className="g-ridgeline-feedW">
            {f.w}
            {f.head ? ' ◎' : ''}
          </span>
          <b style={{ color: f.vc }}>{f.victim}</b>
        </div>
      ))}
    </div>
  );
}

export type Banner = { title: string; sub: string; tone: 'win' | 'loss' | 'info'; key: number };

/** A highlight of yours (first blood, a multi kill, a clutch): big, brief, under the crosshair. */
export type MedalPop = { title: string; sub: string; tier: number; key: number };
export function MedalView({ m }: { m: MedalPop | null }) {
  if (!m) return null;
  return (
    <div key={m.key} className="g-ridgeline-medal" data-tier={m.tier}>
      <b>{m.title}</b>
      {m.sub && <small>{m.sub}</small>}
    </div>
  );
}
export function BannerView({ b }: { b: Banner | null }) {
  if (!b) return null;
  return (
    <div key={b.key} className={`g-ridgeline-banner is-${b.tone}`}>
      <b>{b.title}</b>
      {b.sub && <small>{b.sub}</small>}
    </div>
  );
}

/** The grenades in the slot bar: kind, number key, label. */
const NADE_CHIPS: [NadeKind, number, string][] = [
  ['frag', 4, 'frag'],
  ['smoke', 5, 'smoke'],
  ['flash', 6, 'flash'],
  ['fire', 7, 'fire'],
  ['impact', 8, 'impact'],
  ['decoy', 9, 'decoy'],
];
const NADE_LABEL: Record<NadeKind, string> = { frag: 'frag', smoke: 'smoke', flash: 'flash', fire: 'incendiary', impact: 'impact', decoy: 'decoy' };
const nadeCount = (h: Hud, k: NadeKind) => (k === 'frag' ? h.frags : k === 'smoke' ? h.smokes : k === 'flash' ? h.flashes : k === 'fire' ? h.fires : k === 'impact' ? h.impacts : h.decoys);

const SHOP: { group: string; items: ShopItem[] }[] = [
  { group: 'Sidearms', items: ['wren', 'bulwark', 'marshal'] },
  { group: 'SMG and shotgun', items: ['hornet', 'wasp', 'mauler', 'thresher'] },
  { group: 'Rifles', items: ['kestrel', 'talon', 'lancer', 'rampart'] },
  { group: 'Sniper and crossbow', items: ['longbow', 'arbalest'] },
  { group: 'Armor and shield', items: ['light', 'heavy', 'pavise'] },
  { group: 'Grenades', items: ['frag', 'smoke', 'flash', 'fire', 'impact', 'decoy'] },
];
export const SHOP_ORDER = SHOP.flatMap((g) => g.items);

const NAMES: Partial<Record<ShopItem, string>> = { light: 'Light Armor', heavy: 'Heavy Armor', pavise: 'Ballistic Shield', frag: 'Frag', smoke: 'Smoke', flash: 'Flashbang', fire: 'Incendiary', impact: 'Impact Grenade', decoy: 'Decoy' };
const LINES: Partial<Record<ShopItem, string>> = {
  light: 'soaks 25',
  heavy: 'soaks 50',
  pavise: `stops shots from the front, ${PAVISE.hp} hp. V: up, sidearm only`,
  frag: 'big blast, 2 s fuse',
  smoke: 'blocks sight 15 s',
  flash: 'blinds whoever looks at it',
  fire: 'burns the ground 7 s',
  impact: 'goes off where it hits',
  decoy: 'fakes gunfire for 10 s',
};
const itemName = (i: ShopItem) => NAMES[i] ?? WEAPONS[i as WeaponId].name;
const itemPrice = (i: ShopItem) => (i === 'light' || i === 'heavy' ? ARMOR[i].price : i === 'pavise' ? PAVISE.price : i in NADES ? NADES[i as NadeKind].price : WEAPONS[i as WeaponId].price);
const itemLine = (i: ShopItem) => {
  const line = LINES[i];
  if (line) return line;
  const w = WEAPONS[i as WeaponId];
  const dmg = w.pellets > 1 ? `${w.pellets}x${w.dmg}` : `${w.dmg}`;
  const mode = w.burst ? `${w.burst} round bursts` : w.cls === 'crossbow' ? 'arcing bolts' : `${w.rpm} rpm`;
  return `${dmg} dmg, ${mode}, ${w.mag} ${w.mag === 1 ? 'bolt' : 'rounds'}${w.scope ? ', scoped' : ''}`;
};


export function BuyMenu({ h, onBuy, onClose }: { h: Hud; onBuy: (i: ShopItem) => void; onClose: () => void }) {
  return (
    <div className="g-ridgeline-buy" onPointerDown={(e) => e.stopPropagation()}>
      <div className="g-ridgeline-buyHead">
        <b>Buy</b>
        <span className="g-ridgeline-buyCredits">¤ {h.credits}</span>
        <span className="g-ridgeline-buyTime">{clock(h.timer)}</span>
        <button type="button" className="g-ridgeline-x" onClick={onClose} aria-label="Close the buy menu">
          ✕
        </button>
      </div>
      <div className="g-ridgeline-buyGrid">
        {SHOP.map((g) => (
          <section key={g.group}>
            <h4>{g.group}</h4>
            {g.items.map((i) => {
              const owned = !!h.owned[i];
              const price = itemPrice(i);
              const short = !owned && price > h.credits;
              return (
                <button key={i} type="button" disabled={owned || short} className={owned ? 'is-owned' : ''} onClick={() => onBuy(i)}>
                  <b>{itemName(i)}</b>
                  <span>{itemLine(i)}</span>
                  <em>{owned ? 'owned' : price === 0 ? 'free' : `¤ ${price}`}</em>
                </button>
              );
            })}
          </section>
        ))}
      </div>
      <p className="g-ridgeline-buyNote">guns you keep alive carry over. a gun or armor swapped in the same buy phase is refunded.</p>
    </div>
  );
}

/** Royale prompts: what to do in the air, what is at your feet, a heal under way, and the zone when you are out of it. */
/** The kit items in the order the item bar shows them, with their keys and how they look. */
export const KIT_ITEMS: { kind: UseKind; key: string; name: string; icon: string }[] = [
  { kind: 'bandage', key: '6', name: 'Bandage', icon: 'M5 9h14v6H5zM9 9v6M15 9v6' },
  { kind: 'kit', key: '7', name: 'Med kit', icon: 'M4 7h16v12H4zM9 7V5h6v2M12 10v6M9 13h6' },
  { kind: 'drink', key: '8', name: 'Energy drink', icon: 'M8 4h8l1 3v13H7V7zM7 9h10M10 13l3-2-1 3 2-1' },
  { kind: 'pills', key: '9', name: 'Painkillers', icon: 'M8 7h8v13H8zM7 4h10v3H7zM10 12h4M12 10v4' },
];

const countOf = (r: RoyaleHud, k: UseKind) => (k === 'bandage' ? r.bandages : k === 'kit' ? r.kits : k === 'drink' ? r.drinks : r.pills);

/**
 * Royale: what you carry to patch yourself up, always on screen: a bandage, a med kit, a drink and the painkillers,
 * each with its count, its key (6 to 9), dimmed when you have none or it wouldn't help now, and a ring that fills while
 * one is being used. Each can also be clicked or tapped.
 */
export function ItemBar({ h, onUse }: { h: Hud; onUse: (k: UseKind) => void }) {
  const r = h.royale;
  if (!r || !h.alive || r.drop) return null;
  return (
    <div className="g-ridgeline-items" role="group" aria-label="Heals and boosts">
      {KIT_ITEMS.map((it) => {
        const n = countOf(r, it.kind);
        const on = r.using === it.kind;
        return (
          <button key={it.kind} type="button" className={on ? 'is-on' : ''} data-empty={n ? '0' : '1'} data-helps={r.helps[it.kind] ? '1' : '0'} title={`${it.name} (${it.key})`} onPointerDown={(e) => e.stopPropagation()} onClick={() => onUse(it.kind)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={it.icon} />
            </svg>
            <b>{n}</b>
            <kbd>{it.key}</kbd>
            {on && <i style={{ ['--p' as string]: `${Math.round(r.heal * 100)}%` }} />}
          </button>
        );
      })}
    </div>
  );
}

/** Royale: the kit panel (I): everything you carry, with a Use button on each heal and boost. */
export function KitPanel({ h, onUse, onClose }: { h: Hud; onUse: (k: UseKind) => void; onClose: () => void }) {
  const r = h.royale;
  if (!r) return null;
  return (
    <div className="g-ridgeline-kitpanel" role="dialog" aria-label="Your kit" onPointerDown={(e) => e.stopPropagation()}>
      <header>
        <b>Your kit</b>
        <button type="button" onClick={onClose}>
          close <kbd>I</kbd>
        </button>
      </header>
      <section>
        <h4>Gear</h4>
        <p>
          helmet {r.helmet || 'none'} · vest {r.vest || 'none'} ({Math.ceil(h.armor)} armor) · backpack {r.pack || 'none'}
        </p>
        <p>{r.guns.length ? r.guns.join(' · ') : 'no guns yet'}</p>
      </section>
      <section>
        <h4>Heals and boosts</h4>
        <ul>
          {KIT_ITEMS.map((it) => {
            const n = countOf(r, it.kind);
            return (
              <li key={it.kind}>
                <span>
                  {it.name} <small>{n} of {r.caps[it.kind]}</small>
                </span>
                <button type="button" disabled={!n || !r.helps[it.kind] || !!r.using} onClick={() => onUse(it.kind)}>
                  use <kbd>{it.key}</kbd>
                </button>
              </li>
            );
          })}
        </ul>
        <small>a bandage heals up to {HEAL.bandage.to}, a med kit to full. drinks and painkillers fill the boost meter, which heals you slowly and, when high, speeds you up.</small>
      </section>
      <section>
        <h4>Ammo and grenades</h4>
        <ul>
          {r.ammo.map((a) => (
            <li key={a.kind}>
              <span>{a.kind}</span>
              <small>
                {a.n} of {a.cap}
              </small>
            </li>
          ))}
          <li>
            <span>frags</span>
            <small>
              {r.nades.frag} of {r.nades.fragCap}
            </small>
          </li>
          <li>
            <span>smokes</span>
            <small>
              {r.nades.smoke} of {r.nades.smokeCap}
            </small>
          </li>
        </ul>
      </section>
    </div>
  );
}

/**
 * Every knockout you make, impossible to miss: a big red X with ELIMINATED and their name, a headshot tag, and the
 * count when they come quickly one after another.
 */
export type KillPop = { key: number; name: string; head: boolean; n: number };
export function KillConfirm({ k }: { k: KillPop | null }) {
  if (!k) return null;
  return (
    <div key={k.key} className="g-ridgeline-killpop" aria-live="polite">
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <path d="M8 8l24 24M32 8L8 32" />
      </svg>
      <div>
        <b>Eliminated</b>
        <span>
          {k.name}
          {k.head && <em>headshot</em>}
        </span>
        {k.n > 1 && <small>x{k.n}</small>}
      </div>
    </div>
  );
}

export function RoyalePrompts({ h, touch }: { h: Hud; touch: boolean }) {
  const r = h.royale;
  if (!r || !h.alive) return null;
  const key = (k: string, t: string) => (touch ? t : k);
  return (
    <>
      {r.drop === 1 && (
        <div className="g-ridgeline-prompt is-drop">
          <b>{key('Space', 'Jump')}</b> to jump out
          <small>pick your spot on the map ({key('M', 'Map')}). the transport flies on its line, everyone left aboard at the end jumps</small>
        </div>
      )}
      {r.drop === 2 && (
        <div className="g-ridgeline-prompt is-drop">
          <b>{key('W', 'Push forward')}</b> and look down to dive, <b>{key('Space', 'Jump')}</b> opens the canopy early
        </div>
      )}
      {r.drop === 3 && <div className="g-ridgeline-prompt is-drop">steer to your spot. the canopy glides down</div>}
      {!r.drop && !r.car && r.drive && (
        <div className="g-ridgeline-prompt is-car">
          <kbd>{touch ? 'Drive' : 'F'}</kbd>
          {r.drive}
        </div>
      )}
      {!r.drop && !r.car && r.crate >= 0 && !r.pickup && (
        <div className="g-ridgeline-prompt is-crate">
          supply crate {r.crate > 3 ? `${Math.round(r.crate)} m` : 'here'}
          <small>its gear lies on the ground round it: walk over it to take it ({touch ? 'Grab' : 'F'} swaps a gun)</small>
        </div>
      )}
      {!r.drop && !r.car && !r.drive && r.pickup && (
        <div className="g-ridgeline-prompt">
          <kbd>{touch ? 'Grab' : 'F'}</kbd>
          {r.pickup}
        </div>
      )}
      {r.car && (
        <div className="g-ridgeline-car" data-low={r.car.hp < 0.3 ? '1' : '0'}>
          <b>
            {Math.round(r.car.kmh)}
            <small>km/h</small>
          </b>
          <span className="g-ridgeline-carHp">
            <i style={{ width: `${Math.max(0, r.car.hp) * 100}%` }} />
          </span>
          <em>
            {r.car.name}
            {touch ? '. Exit to get out' : r.car.driving ? '. F get out, Space handbrake' : '. F get out'}
          </em>
        </div>
      )}
      {r.heal > 0 && r.healName && (
        <div className="g-ridgeline-healing">
          <span>{r.healName}</span>
          <i style={{ width: `${r.heal * 100}%` }} />
        </div>
      )}
      {r.outside > 0 && !r.drop && (
        <div className="g-ridgeline-outside">
          outside the zone, -{r.dps} health a second. {Math.ceil(r.outside)} m to safety
        </div>
      )}
      {r.red && !r.drop && (
        <div className="g-ridgeline-outside is-red">
          {r.red.cover
            ? `${r.red.live ? 'shells falling' : 'bombardment coming'}. under a roof: they can't reach you here`
            : `${r.red.live ? 'shells falling' : `bombardment in ${Math.ceil(r.red.t)} s`}. get under a roof or ${Math.ceil(r.red.edge)} m out of the red`}
        </div>
      )}
    </>
  );
}

export function Scoreboard({ rows, mode }: { rows: Row[]; mode: Mode }) {
  const teams = mode === 'breach' ? [0, 1] : [-1];
  return (
    <div className="g-ridgeline-board">
      {teams.map((t) => (
        <table key={t} className={t === 1 ? 'is-them' : 'is-you'}>
          <thead>
            <tr>
              <th>{t === 0 ? 'Your team' : t === 1 ? 'Enemy team' : 'Players'}</th>
              <th>K</th>
              <th>D</th>
              <th>A</th>
              <th>Score</th>
              {t === 0 && <th>¤</th>}
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => t < 0 || r.team === t)
              .map((r, i) => (
                <tr key={i} className={`${r.you ? 'is-you' : ''} ${r.alive ? '' : 'is-dead'}`}>
                  <td>{r.name}</td>
                  <td>{r.k}</td>
                  <td>{r.d}</td>
                  <td>{r.a}</td>
                  <td>{r.cs}</td>
                  {t === 0 && <td>{r.credits ?? ''}</td>}
                </tr>
              ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

export function DeathPanel({ h, touch }: { h: Hud; touch: boolean }) {
  if (h.alive || !h.dead) return null;
  return (
    <div className="g-ridgeline-dead">
      <small>knocked out by</small>
      <b>{h.dead.by}</b>
      <span>
        {h.dead.w}
        {h.dead.head ? ', headshot' : ''}
      </span>
      {h.royale ? (
        <em>
          you finished #{h.royale.place} of {h.royale.total}
          {h.watching ? `. watching ${h.watching}${touch ? ', tap to switch' : ', click to switch'}` : ''}
        </em>
      ) : h.mode === 'dm' ? <em>back in {Math.max(0, Math.ceil(h.dead.respawn))}</em> : h.watching ? <em>watching {h.watching}{touch ? ', tap to switch' : ', click to switch'}</em> : <em>your team is out</em>}
    </div>
  );
}

export function Scope({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <div className="g-ridgeline-scope" aria-hidden="true">
      <div className="g-ridgeline-scopeMask" />
      <div className="g-ridgeline-scopeLens">
        <i className="is-h" />
        <i className="is-v" />
        <i className="is-l" />
        <i className="is-r" />
        <i className="is-b" />
        <b />
      </div>
    </div>
  );
}

/** Crosshair, hit marker and damage arcs, moved every frame through refs (no React renders). */
export type FastHud = { set(spread: number, show: boolean): void; hit(kill: boolean, head: boolean): void; hurt(angle: number): void; tick(dt: number): void };
export const Reticle = forwardRef<FastHud, { shotgun: boolean }>(function Reticle({ shotgun }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const hitEl = useRef<HTMLDivElement>(null);
  const arcs = useRef<HTMLDivElement>(null);
  const hitT = useRef(0);
  const hurts = useRef<{ a: number; t: number; el: HTMLElement }[]>([]);
  useImperativeHandle(ref, () => ({
    set(spread, show) {
      const el = root.current;
      if (!el) return;
      el.style.setProperty('--gap', `${Math.min(80, 3 + spread)}px`);
      el.style.opacity = show ? '1' : '0';
    },
    hit(kill, head) {
      const el = hitEl.current;
      if (!el) return;
      hitT.current = kill ? 0.45 : 0.22;
      el.dataset.kind = kill ? 'kill' : head ? 'head' : 'hit';
      el.style.opacity = '1';
    },
    hurt(angle) {
      const box = arcs.current;
      if (!box) return;
      const el = document.createElement('i');
      box.appendChild(el);
      hurts.current.push({ a: angle, t: 1.2, el });
      if (hurts.current.length > 6) hurts.current.shift()?.el.remove();
    },
    tick(dt) {
      if (hitT.current > 0) {
        hitT.current -= dt;
        if (hitT.current <= 0 && hitEl.current) hitEl.current.style.opacity = '0';
      }
      hurts.current = hurts.current.filter((h) => {
        h.t -= dt;
        if (h.t <= 0) {
          h.el.remove();
          return false;
        }
        h.el.style.transform = `rotate(${h.a}rad)`;
        h.el.style.opacity = String(Math.min(1, h.t * 1.5));
        return true;
      });
    },
  }));
  useEffect(
    () => () => {
      for (const h of hurts.current) h.el.remove();
    },
    [],
  );
  return (
    <>
      <div ref={root} className={`g-ridgeline-cross${shotgun ? ' is-ring' : ''}`} aria-hidden="true">
        <i className="is-t" />
        <i className="is-b" />
        <i className="is-l" />
        <i className="is-r" />
        <b />
      </div>
      <div ref={hitEl} className="g-ridgeline-hit" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div ref={arcs} className="g-ridgeline-arcs" aria-hidden="true" />
    </>
  );
});

/**
 * What your hits did, where they landed: a damage number that pops off the spot and rises (gold for the head, red for
 * the kill; quick hits on the same soldier add up into one), and a health bar over whoever you last hit, so there is
 * never a doubt whether a shot connected. Moved every frame through refs.
 */
export type HitInfoApi = {
  pop(x: number, y: number, z: number, dmg: number, kind: 'hit' | 'head' | 'kill', target: number): void;
  place(project: (x: number, y: number, z: number, out: { x: number; y: number; z: number }) => void, w: number, h: number, dt: number, actor: (id: number) => { x: number; y: number; z: number; hp: number; alive: boolean } | null): void;
};
type Pop = { x: number; y: number; z: number; t: number; dmg: number; kind: 'hit' | 'head' | 'kill'; target: number; el: HTMLElement };
const POP_LIFE = 0.85;
export const HitInfo = forwardRef<HitInfoApi, { children?: ReactNode }>(function HitInfo(_, ref) {
  const box = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const pops = useRef<Pop[]>([]);
  const target = useRef({ id: -1, t: 0, shown: 100 });
  const pt = useRef({ x: 0, y: 0, z: 0 });
  useImperativeHandle(ref, () => ({
    pop(x, y, z, dmg, kind, who) {
      const root = box.current;
      if (!root) return;
      target.current.id = who;
      target.current.t = 2.2;
      if (dmg <= 0 && kind !== 'kill') return;
      // a burst, or a shotgun's pellets: one number that counts up
      const last = pops.current[pops.current.length - 1];
      if (last && last.target === who && last.t > POP_LIFE - 0.35 && kind !== 'kill' && last.kind !== 'kill') {
        last.dmg += dmg;
        last.t = POP_LIFE;
        if (kind === 'head') last.kind = 'head';
        last.el.textContent = String(Math.round(last.dmg));
        last.el.dataset.kind = last.kind;
        last.el.style.animation = 'none';
        void last.el.offsetWidth;
        last.el.style.animation = '';
        return;
      }
      const el = document.createElement('b');
      el.dataset.kind = kind;
      el.textContent = kind === 'kill' && dmg <= 0 ? 'KO' : String(Math.round(dmg));
      root.appendChild(el);
      pops.current.push({ x, y, z, t: POP_LIFE, dmg, kind, target: who, el });
      if (pops.current.length > 10) pops.current.shift()?.el.remove();
    },
    place(project, w, h, dt, actor) {
      const p = pt.current;
      pops.current = pops.current.filter((q) => {
        q.t -= dt;
        if (q.t <= 0) {
          q.el.remove();
          return false;
        }
        project(q.x, q.y, q.z, p);
        const age = POP_LIFE - q.t;
        const on = p.z < 1 && p.x > -40 && p.x < w + 40 && p.y > -40 && p.y < h + 40;
        q.el.style.display = on ? '' : 'none';
        if (on) {
          q.el.style.transform = `translate(${p.x + 14 + age * 18}px, ${p.y - 16 - age * 46}px) translate(-50%, -50%)`;
          q.el.style.opacity = String(Math.min(1, q.t * 3.5));
        }
        return true;
      });
      // the bar over the one you last hit
      const tg = target.current;
      const el = bar.current;
      if (!el) return;
      tg.t -= dt;
      const a = tg.id >= 0 && tg.t > 0 ? actor(tg.id) : null;
      if (!a) {
        el.style.display = 'none';
        return;
      }
      project(a.x, a.y, a.z, p);
      const on = p.z < 1 && p.x > 0 && p.x < w && p.y > 0 && p.y < h;
      el.style.display = on ? '' : 'none';
      if (!on) return;
      const hp = a.alive ? Math.max(0, Math.min(100, a.hp)) : 0;
      // the bar eases down to where the health is now, so a hit visibly takes a bite
      tg.shown = hp > tg.shown ? hp : tg.shown + (hp - tg.shown) * Math.min(1, dt * 7);
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      el.style.opacity = String(Math.min(1, tg.t * 2.5));
      (el.firstChild as HTMLElement).style.width = `${tg.shown}%`;
      (el.lastChild as HTMLElement).style.width = `${hp}%`;
      el.dataset.dead = a.alive ? '' : '1';
    },
  }));
  useEffect(
    () => () => {
      for (const q of pops.current) q.el.remove();
      pops.current = [];
    },
    [],
  );
  return (
    <div ref={box} className="g-ridgeline-hitinfo" aria-hidden="true">
      <div ref={bar} className="g-ridgeline-hpbar" style={{ display: 'none' }}>
        <i />
        <i />
      </div>
    </div>
  );
});

/** The minimap: the baked map picture, the sites and the charge, your team, enemies your team can see, and you. Drawn
 * on demand. */
export type MinimapApi = { draw(s: MapState): void };
export type MapState = {
  x: number;
  z: number;
  yaw: number;
  /** Breach: the sites are marked, the one the charge is on picked out, and the charge where your side knows it. */
  sites: boolean;
  plantedOn: number;
  charge: { x: number; z: number; planted: boolean } | null;
  mates: { x: number; z: number }[];
  foes: { x: number; z: number }[];
  /** Royale: the zone now and next, and the transport's line with where it is. */
  zone?: { x: number; z: number; r: number; nx: number; nz: number; nr: number } | null;
  plane?: { ax: number; az: number; bx: number; bz: number; x: number; z: number } | null;
  /** Royale: a bombardment marked (shells falling once live), and supply crates with loot left (falling or down). */
  red?: { x: number; z: number; r: number; live: boolean } | null;
  drops?: { x: number; z: number; landed: boolean }[];
  /** Royale: the vehicles (x, z, heading, a wreck or not, a bike or not); the same list every frame, refilled. */
  cars?: { x: number; z: number; yaw: number; wreck: boolean; bike: boolean }[];
};
export const Minimap = forwardRef<MinimapApi, { world: World; big?: boolean }>(function Minimap({ world, big }, ref) {
  const cv = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const mm = world.minimap;
    const c = document.createElement('canvas');
    c.width = mm.size;
    c.height = mm.size;
    const g = c.getContext('2d');
    if (g) g.putImageData(new ImageData(new Uint8ClampedArray(mm.data), mm.size, mm.size), 0, 0);
    img.current = c;
  }, [world]);
  useImperativeHandle(ref, () => ({
    draw(s) {
      const c = cv.current;
      const src = img.current;
      if (!c || !src) return;
      const g = c.getContext('2d');
      if (!g) return;
      const size = c.width;
      const mm = world.minimap;
      const view = big ? mm.span : s.zone !== undefined ? 120 : 70;
      const scale = size / (2 * view);
      const cx = big ? 0 : s.x;
      const cz = big ? 0 : s.z;
      const toX = (x: number) => (x - cx) * scale + size / 2;
      const toY = (z: number) => (z - cz) * scale + size / 2;
      g.clearRect(0, 0, size, size);
      g.save();
      g.beginPath();
      if (big) g.rect(0, 0, size, size);
      else g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
      g.clip();
      const k = mm.size / (2 * mm.span);
      g.imageSmoothingEnabled = true;
      g.drawImage(src, (cx - view + mm.span) * k, (cz - view + mm.span) * k, 2 * view * k, 2 * view * k, 0, 0, size, size);
      if (s.zone) {
        const z = s.zone;
        g.lineWidth = big ? 2.5 : 2;
        g.strokeStyle = 'rgba(255,255,255,0.95)';
        g.beginPath();
        g.arc(toX(z.nx), toY(z.nz), Math.max(1, z.nr * scale), 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = 'rgba(230,110,60,0.95)';
        g.beginPath();
        g.arc(toX(z.x), toY(z.z), Math.max(1, z.r * scale), 0, Math.PI * 2);
        g.stroke();
      }
      if (s.red) {
        // the bombardment: a red disc, throbbing once the shells fall
        const r = s.red;
        const live = r.live ? 0.5 + 0.5 * Math.sin(performance.now() / 140) : 0;
        g.beginPath();
        g.arc(toX(r.x), toY(r.z), Math.max(2, r.r * scale), 0, Math.PI * 2);
        g.fillStyle = `rgba(220,40,30,${0.28 + live * 0.18})`;
        g.fill();
        g.lineWidth = big ? 2 : 1.5;
        g.strokeStyle = 'rgba(255,70,50,0.95)';
        g.stroke();
      }
      if (s.plane) {
        const p = s.plane;
        g.setLineDash([6, 5]);
        g.strokeStyle = 'rgba(255,255,255,0.8)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(toX(p.ax), toY(p.az));
        g.lineTo(toX(p.bx), toY(p.bz));
        g.stroke();
        g.setLineDash([]);
        g.beginPath();
        g.arc(toX(p.x), toY(p.z), big ? 6 : 4, 0, Math.PI * 2);
        g.fillStyle = '#ffd56a';
        g.fill();
      }
      if (s.sites) world.sites.forEach((site, i) => {
        const on = i === s.plantedOn;
        g.fillStyle = on ? '#ffd56a' : 'rgba(255,255,255,0.75)';
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.lineWidth = 3;
        g.font = `bold ${big ? 16 : 12}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const px = toX(site.x);
        const py = toY(site.z);
        if (on) {
          g.beginPath();
          g.arc(px, py, 9 * scale + 3, 0, Math.PI * 2);
          g.strokeStyle = 'rgba(255,213,106,0.9)';
          g.lineWidth = 2;
          g.stroke();
        }
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.lineWidth = 3;
        g.strokeText(site.name, px, py);
        g.fillText(site.name, px, py);
      });
      const dot = (x: number, z: number, col: string, r: number) => {
        g.beginPath();
        g.arc(toX(x), toY(z), r, 0, Math.PI * 2);
        g.fillStyle = col;
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.7)';
        g.lineWidth = 1;
        g.stroke();
      };
      if (s.drops)
        for (const d of s.drops) {
          // a supply crate: a small blue box (hollow while still coming down), held to the minimap's rim when far
          let px = toX(d.x);
          let py = toY(d.z);
          const half = big ? 5 : 4;
          if (!big) {
            const ox = px - size / 2;
            const oy = py - size / 2;
            const ol = Math.hypot(ox, oy);
            const rim = size / 2 - half - 2;
            if (ol > rim) {
              px = size / 2 + (ox / ol) * rim;
              py = size / 2 + (oy / ol) * rim;
            }
          }
          g.lineWidth = 2;
          g.strokeStyle = 'rgba(0,0,0,0.8)';
          g.strokeRect(px - half, py - half, half * 2, half * 2);
          if (d.landed) {
            g.fillStyle = '#3fb6ff';
            g.fillRect(px - half, py - half, half * 2, half * 2);
          } else {
            g.lineWidth = 1.5;
            g.strokeStyle = '#3fb6ff';
            g.strokeRect(px - half + 1, py - half + 1, half * 2 - 2, half * 2 - 2);
          }
        }
      // vehicles: a small block along the way each one faces (grey once burnt out)
      if (s.cars)
        for (const c of s.cars) {
          const px = toX(c.x);
          const py = toY(c.z);
          if (px < -8 || py < -8 || px > size + 8 || py > size + 8) continue;
          // (true to size where the map is close enough, never smaller than a mark you can see)
          const l = Math.max(c.bike ? 4 : 7, (c.bike ? 2.2 : 4.4) * scale);
          const wd = Math.max(c.bike ? 2.5 : 4, (c.bike ? 0.9 : 2) * scale);
          g.save();
          g.translate(px, py);
          g.rotate(-c.yaw);
          g.fillStyle = c.wreck ? 'rgba(90,90,90,0.8)' : '#e8d36a';
          g.strokeStyle = 'rgba(0,0,0,0.75)';
          g.lineWidth = 1;
          g.fillRect(-wd / 2, -l / 2, wd, l);
          g.strokeRect(-wd / 2, -l / 2, wd, l);
          g.restore();
        }
      for (const p of s.mates) dot(p.x, p.z, '#4fb4ff', big ? 4 : 3.5);
      for (const p of s.foes) dot(p.x, p.z, '#ff5a3c', big ? 4 : 3.5);
      if (s.charge) {
        // the charge: a small diamond, red and pulsing once planted
        const cx2 = toX(s.charge.x);
        const cy2 = toY(s.charge.z);
        const r2 = (big ? 7 : 5.5) * (s.charge.planted ? 1 + 0.25 * Math.sin(performance.now() / 120) : 1);
        g.beginPath();
        g.moveTo(cx2, cy2 - r2);
        g.lineTo(cx2 + r2, cy2);
        g.lineTo(cx2, cy2 + r2);
        g.lineTo(cx2 - r2, cy2);
        g.closePath();
        g.fillStyle = s.charge.planted ? '#ff4a3a' : '#ffd56a';
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.8)';
        g.lineWidth = 1.5;
        g.stroke();
      }
      // you: an arrow along the view
      const px = toX(s.x);
      const py = toY(s.z);
      const fx = -Math.sin(s.yaw);
      const fz = -Math.cos(s.yaw);
      g.save();
      g.translate(px, py);
      g.rotate(Math.atan2(fz, fx) + Math.PI / 2);
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(5, 5);
      g.lineTo(0, 2.5);
      g.lineTo(-5, 5);
      g.closePath();
      g.fillStyle = '#fff';
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.8)';
      g.stroke();
      g.restore();
      g.restore();
    },
  }));
  return <canvas ref={cv} width={big ? 360 : 168} height={big ? 360 : 168} className={big ? 'g-ridgeline-bigmap' : 'g-ridgeline-minimap'} />;
});

/** Screen markers: the sites, the charge, your teammates' names and (royale) supply crates, placed every frame through
 * refs. */
export type MarkersApi = { place(list: { key: string; x: number; y: number; on: boolean; text: string; sub?: string; kind: 'site' | 'mate' | 'charge' | 'supply' }[]): void };
export const Markers = forwardRef<MarkersApi, { children?: ReactNode }>(function Markers(_, ref) {
  const box = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLDivElement>());
  useImperativeHandle(ref, () => ({
    place(list) {
      const root = box.current;
      if (!root) return;
      const seen = new Set<string>();
      for (const m of list) {
        seen.add(m.key);
        let el = els.current.get(m.key);
        if (!el) {
          el = document.createElement('div');
          el.className = `g-ridgeline-mark is-${m.kind}`;
          el.innerHTML = '<b></b><small></small>';
          root.appendChild(el);
          els.current.set(m.key, el);
        }
        el.style.display = m.on ? '' : 'none';
        if (!m.on) continue;
        el.style.transform = `translate(${m.x}px, ${m.y}px)`;
        const b = el.firstChild as HTMLElement;
        const s = el.lastChild as HTMLElement;
        if (b.textContent !== m.text) b.textContent = m.text;
        const sub = m.sub ?? '';
        if (s.textContent !== sub) s.textContent = sub;
      }
      for (const [k, el] of els.current)
        if (!seen.has(k)) {
          el.remove();
          els.current.delete(k);
        }
    },
  }));
  return <div ref={box} className="g-ridgeline-marks" aria-hidden="true" />;
});
