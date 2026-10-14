// The heads-up display: Hypixel's sidebar scoreboard with a cardinal header, the hotbar with hearts and resources,
// the chat feed with kills and bed breaks, big titles, the shop and team upgrades panels, and the player list.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TEAMS, TILE } from './blocks.ts';
import { iconURL } from './atlas.ts';
import {
  ARMOR_NAMES,
  OFFERS,
  QUICK_BUY,
  RESOURCES,
  RES_COLOR,
  SHOP_CATS,
  TRAPS,
  UPGRADES,
  blockFor,
  isBlockItem,
  itemTile,
  priceOf,
  trapCost,
  upgradeCost,
  type Inventory,
  type Item,
  type Offer,
  type Res,
  type ShopCat,
  type TrapKind,
  type UpgradeKey,
  type Upgrades,
} from './items.ts';
import type { FeedLine, Hud, HudSlot, Title } from './client.ts';
import { COSMETICS, starOf, type Record as StatRecord } from './stats.ts';

export const fmtClock = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.max(0, secs) % 60).padStart(2, '0')}`;

export function itemIcon(item: Item, team: number, tier = 1): string {
  if (isBlockItem(item) && item !== 'ladder') return iconURL({ block: blockFor(item, team) });
  if (item === 'tnt') return iconURL({ tile: TILE.tnt_side });
  return iconURL({ tile: itemTile(item, team, tier) });
}
const resIcon = (r: Res) => iconURL({ tile: TILE[r] });

export function Icon({ src, size = 32, className }: { src: string; size?: number; className?: string }) {
  return <img className={['g-bedwars-icon', className ?? ''].join(' ')} src={src} width={size} height={size} alt="" draggable={false} />;
}

export function Crosshair() {
  return (
    <div className="g-bedwars-cross" aria-hidden="true">
      <i />
      <i />
    </div>
  );
}

/** Ten hearts (with golden absorption hearts ahead of them), Minecraft style. */
function Hearts({ hp, absorb, hurt }: { hp: number; absorb: number; hurt: boolean }) {
  const hearts: ReactNode[] = [];
  const full = TILE.heart;
  for (let i = 0; i < 10; i++) {
    const v = hp - i * 2;
    const tile = v >= 2 ? full : v >= 1 ? TILE.heart_half : TILE.heart_empty;
    hearts.push(<Icon key={i} src={iconURL({ tile })} size={18} className={hp <= 4 ? 'is-low' : ''} />);
  }
  const gold: ReactNode[] = [];
  for (let i = 0; i < Math.ceil(absorb / 2); i++) gold.push(<Icon key={`g${i}`} src={iconURL({ tile: TILE.heart_gold })} size={18} />);
  return (
    <div className={`g-bedwars-hearts${hurt ? ' is-hurt' : ''}`} aria-label={`${Math.ceil(hp / 2)} hearts`}>
      {hearts}
      {gold}
    </div>
  );
}

export function Hotbar({ hud, onSelect, hurt }: { hud: Hud; onSelect: (i: number) => void; hurt: boolean }) {
  return (
    <div className="g-bedwars-bar">
      <div className="g-bedwars-barTop">
        <Hearts hp={hud.hp} absorb={hud.absorb} hurt={hurt} />
        <div className="g-bedwars-wallet" aria-label="Resources">
          {RESOURCES.map((r) => (
            <span key={r} className={hud.wallet[r] ? '' : 'is-zero'} style={{ color: RES_COLOR[r] }}>
              <Icon src={resIcon(r)} size={20} />
              {hud.wallet[r]}
            </span>
          ))}
        </div>
      </div>
      <div className="g-bedwars-slots" role="toolbar" aria-label="Hotbar">
        {hud.slots.map((s, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            className={`g-bedwars-slot${i === hud.sel ? ' is-sel' : ''}`}
            aria-label={s ? `${s.item} ${s.n}` : `Slot ${i + 1}, empty`}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelect(i);
            }}
          >
            <SlotIcon s={s} />
            <kbd>{i + 1}</kbd>
          </button>
        ))}
      </div>
    </div>
  );
}

function SlotIcon({ s }: { s: HudSlot }) {
  if (!s) return null;
  return (
    <>
      <Icon src={itemIcon(s.item, s.team, s.tier)} size={32} />
      {s.n > 1 && <b>{s.n}</b>}
    </>
  );
}

/** The sidebar: next event, every team with its bed or players left, your kills. */
export function Scoreboard({ hud, mode }: { hud: Hud; mode: string }) {
  const teams = hud.teams.filter((t) => t.used || t.id < (mode === 'solo' ? 8 : 4));
  return (
    <div className="g-bedwars-board" aria-label="Scoreboard">
      <header>BED WARS</header>
      <p className="g-bedwars-board-sub">{mode === 'solo' ? 'solo' : 'doubles'} · stanford</p>
      {hud.phase ? (
        <p>
          {hud.phase.label} in <b className="is-green">{fmtClock(hud.phase.secs)}</b>
        </p>
      ) : (
        <p>&nbsp;</p>
      )}
      <ul>
        {teams.map((t) => (
          <li key={t.id} className={t.out ? 'is-out' : ''}>
            <b style={{ color: TEAMS[t.id].color }}>{TEAMS[t.id].letter}</b>
            <span>{TEAMS[t.id].name}:</span>
            {t.bed ? <i className="is-ok">✔</i> : t.out || !t.used ? <i className="is-x">✘</i> : <i className="is-n">{t.alive}</i>}
            {t.me && <small>YOU</small>}
          </li>
        ))}
      </ul>
      <p>
        Kills: <b className="is-green">{hud.stats.kills}</b>
      </p>
      <p>
        Final Kills: <b className="is-green">{hud.stats.finals}</b>
      </p>
      <p>
        Beds Broken: <b className="is-green">{hud.stats.beds}</b>
      </p>
      <footer>joshuakoo.com</footer>
    </div>
  );
}

const feedClass: Partial<Record<FeedLine['k'], string>> = { bed: 'is-bed', final: 'is-final', elim: 'is-elim', tier: 'is-tier', phase: 'is-phase', deny: 'is-deny', buy: 'is-buy', trap: 'is-trap', res: 'is-res' };

/** Chat lines: names in their team color, fading out after a few seconds. */
export function Feed({ lines, now, open, names }: { lines: FeedLine[]; now: number; open: boolean; names: [string, string][] }) {
  const shown = open ? lines : lines.filter((l) => now - l.at < 9);
  return (
    <ol className="g-bedwars-feed" aria-live="polite">
      {shown.slice(-7).map((l) => (
        <li key={l.id} className={feedClass[l.k] ?? ''} style={{ opacity: open ? 1 : Math.max(0, Math.min(1, 9 - (now - l.at))) }}>
          {l.k === 'bed' || l.k === 'elim' ? <FeedBig text={l.text} team={l.team} names={names} /> : <Named text={l.text} names={names} />}
        </li>
      ))}
    </ol>
  );
}

/** Player names in their team color, the way Hypixel's chat shows them. */
function Named({ text, names }: { text: string; names: [string, string][] }) {
  const sorted = names.filter(([n]) => n).sort((a, b) => b[0].length - a[0].length);
  if (!sorted.length) return <>{text}</>;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${sorted.map(([n]) => esc(n)).join('|')})`, 'g');
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) => {
        const hit = sorted.find(([n]) => n === part);
        return hit ? (
          <b key={i} style={{ color: hit[1] }}>
            {part}
          </b>
        ) : (
          part
        );
      })}
    </>
  );
}

function FeedBig({ text, team, names }: { text: string; team?: number; names: [string, string][] }) {
  const [head, rest] = text.split(' > ');
  return (
    <>
      <b>{head} &gt;</b>{' '}
      <span style={{ color: team !== undefined ? TEAMS[team].color : undefined }}>
        <Named text={rest ?? ''} names={names} />
      </span>
    </>
  );
}

export function TitleView({ title, now }: { title: Title | null; now: number }) {
  if (!title || now > title.until) return null;
  return (
    <div key={title.id} className="g-bedwars-title" role="status">
      <h2 style={{ color: title.color }}>{title.title}</h2>
      {title.sub && <p>{title.sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// shop

export function ShopPanel({ inv, team, onBuy, onClose, touch }: { inv: Inventory; team: number; onBuy: (id: string) => void; onClose: () => void; touch: boolean }) {
  const [cat, setCat] = useState<ShopCat>('quick');
  const offers = useMemo(() => (cat === 'quick' ? QUICK_BUY.map((id) => OFFERS.find((o) => o.id === id)!).filter(Boolean) : OFFERS.filter((o) => o.cat === cat)), [cat]);
  return (
    <Panel title="Item Shop" onClose={onClose} wallet={inv.wallet} touch={touch}>
      <nav className="g-bedwars-tabs" role="tablist">
        {SHOP_CATS.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} className={cat === c.id ? 'is-on' : ''} onClick={() => setCat(c.id)}>
            <Icon src={catIcon(c.id, team)} size={24} />
            <span>{c.name}</span>
          </button>
        ))}
      </nav>
      <div className="g-bedwars-offers">
        {offers.map((o) => (
          <OfferCard key={o.id} o={o} inv={inv} team={team} onBuy={onBuy} />
        ))}
      </div>
    </Panel>
  );
}

function catIcon(c: ShopCat, team: number) {
  switch (c) {
    case 'quick':
      return iconURL({ tile: TILE.feather });
    case 'blocks':
      return iconURL({ block: blockFor('wool', team) });
    case 'melee':
      return iconURL({ tile: TILE.sword_iron });
    case 'armor':
      return iconURL({ tile: TILE.chest_iron });
    case 'tools':
      return iconURL({ tile: TILE.pick_iron });
    case 'ranged':
      return iconURL({ tile: TILE.bow });
    case 'potions':
      return iconURL({ tile: TILE.potion_speed });
    case 'utility':
      return iconURL({ tile: TILE.tnt_side });
  }
}

function offerIcon(o: Offer, inv: Inventory, team: number) {
  const give = o.give;
  if ('item' in give) return itemIcon(give.item, team);
  if ('armor' in give) return iconURL({ tile: TILE[(['chest_leather', 'boots_chain', 'boots_iron', 'boots_diamond'] as const)[give.armor]] });
  if ('tool' in give) {
    const tier = Math.min(4, (give.tool === 'pick' ? inv.pick : inv.axe) + 1);
    return itemIcon(give.tool, team, tier);
  }
  return iconURL({ tile: TILE.shears });
}

function OfferCard({ o, inv, team, onBuy }: { o: Offer; inv: Inventory; team: number; onBuy: (id: string) => void }) {
  const price = priceOf(inv, o);
  const owned = !price;
  const can = !!price && inv.wallet[price.res] >= price.cost;
  const n = 'item' in o.give ? o.give.n : 1;
  return (
    <button type="button" className={`g-bedwars-offer${owned ? ' is-owned' : can ? ' is-can' : ' is-cant'}`} onClick={() => !owned && onBuy(o.id)} disabled={owned} title={o.desc}>
      <span className="g-bedwars-offer-icon">
        <Icon src={offerIcon(o, inv, team)} size={36} />
        {n > 1 && <b>{n}</b>}
      </span>
      <span className="g-bedwars-offer-name">{price?.name ?? o.name}</span>
      <span className="g-bedwars-offer-cost" style={{ color: owned ? undefined : RES_COLOR[price!.res] }}>
        {owned ? 'owned' : (
          <>
            <Icon src={resIcon(price!.res)} size={16} />
            {price!.cost}
          </>
        )}
      </span>
    </button>
  );
}

export function UpgradesPanel({ inv, ups, traps, onBuy, onTrap, onClose, touch }: { inv: Inventory; ups: Upgrades; traps: TrapKind[]; onBuy: (k: UpgradeKey) => void; onTrap: (k: TrapKind) => void; onClose: () => void; touch: boolean }) {
  return (
    <Panel title="Team Upgrades" onClose={onClose} wallet={inv.wallet} touch={touch} only="diamond">
      <div className="g-bedwars-ups">
        {UPGRADES.map((u) => {
          const lvl = ups[u.key];
          const cost = upgradeCost(ups, u.key);
          const can = cost !== null && inv.wallet.diamond >= cost;
          return (
            <button key={u.key} type="button" className={`g-bedwars-up${cost === null ? ' is-owned' : can ? ' is-can' : ' is-cant'}`} onClick={() => cost !== null && onBuy(u.key)} disabled={cost === null}>
              <Icon src={iconURL({ tile: TILE[u.tile] })} size={36} />
              <span className="g-bedwars-up-text">
                <b>{u.name}</b>
                <small>{cost === null ? u.levels[u.tiers.length - 1] : u.levels[lvl]}</small>
                <i className="g-bedwars-pips">
                  {u.tiers.map((_, k) => (
                    <em key={k} className={k < lvl ? 'is-on' : ''} />
                  ))}
                </i>
              </span>
              <span className="g-bedwars-offer-cost" style={{ color: cost === null ? undefined : RES_COLOR.diamond }}>
                {cost === null ? 'maxed' : (
                  <>
                    <Icon src={resIcon('diamond')} size={16} />
                    {cost}
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <h3 className="g-bedwars-trap-head">
        Traps <small>{traps.length}/3 queued · next costs {trapCost(traps.length)}</small>
      </h3>
      <div className="g-bedwars-traps">
        {TRAPS.map((t) => {
          const can = traps.length < 3 && inv.wallet.diamond >= trapCost(traps.length);
          return (
            <button key={t.kind} type="button" className={`g-bedwars-up${can ? ' is-can' : ' is-cant'}`} onClick={() => onTrap(t.kind)} title={t.desc}>
              <Icon src={iconURL({ tile: TILE[t.tile] })} size={30} />
              <span className="g-bedwars-up-text">
                <b>{t.name}</b>
                <small>{t.desc}</small>
              </span>
            </button>
          );
        })}
      </div>
      {traps.length > 0 && (
        <p className="g-bedwars-queue">
          queue:{' '}
          {traps.map((k, i) => (
            <span key={i}>{TRAPS.find((t) => t.kind === k)!.name}</span>
          ))}
        </p>
      )}
    </Panel>
  );
}

function Panel({ title, children, onClose, wallet, touch, only }: { title: string; children: ReactNode; onClose: () => void; wallet: Record<Res, number>; touch: boolean; only?: Res }) {
  useEffect(() => {
    // nothing to set up: Escape and E are handled by the game
  }, []);
  return (
    <div className="g-bedwars-panelWrap" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={`g-bedwars-panel${touch ? ' is-touch' : ''}`} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <div className="g-bedwars-wallet is-panel">
            {(only ? [only] : RESOURCES).map((r) => (
              <span key={r} style={{ color: RES_COLOR[r] }}>
                <Icon src={resIcon(r)} size={18} />
                {wallet[r]}
              </span>
            ))}
          </div>
          <button type="button" className="g-bedwars-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
        {!touch && <p className="g-bedwars-panel-hint">esc or e to close</p>}
      </section>
    </div>
  );
}

export function PlayerList({ rows }: { rows: { name: string; team: number; alive: boolean; out: boolean; kills: number; finals: number; beds: number; bot: boolean }[] }) {
  return (
    <div className="g-bedwars-tab" aria-label="Players">
      <table>
        <thead>
          <tr>
            <th>player</th>
            <th>kills</th>
            <th>finals</th>
            <th>beds</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.out ? 'is-out' : !r.alive ? 'is-dead' : ''}>
              <td>
                <b style={{ color: TEAMS[r.team].color }}>{TEAMS[r.team].letter}</b> {r.name}
                {r.bot && <small> bot</small>}
              </td>
              <td>{r.kills}</td>
              <td>{r.finals}</td>
              <td>{r.beds}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ArmorBadge({ tier }: { tier: number }) {
  return <span className="g-bedwars-armor">{ARMOR_NAMES[tier]}</span>;
}

// ---------------------------------------------------------------------------------------------------------------
// the start card: your record, how to play, the locker

/** A sheet over the whole game (portaled into the shell so it covers the Start and Pause cards). */
export function Sheet({ root, title, onClose, children }: { root: HTMLElement | null; title: string; onClose: () => void; children: ReactNode }) {
  const done = useRef(onClose);
  done.current = onClose;
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus({ preventScroll: true });
    // keys stay in the sheet: Escape closes it, and nothing reaches the game behind
    const onKey = (e: KeyboardEvent) => {
      if (!root?.contains(e.target as Node)) return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        done.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [root]);
  if (!root) return null;
  return createPortal(
    <div
      className="g-bedwars-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="g-bedwars-sheet-card">
        <header>
          <h2>{title}</h2>
          <button type="button" ref={close} className="arcade-btn" onClick={onClose}>
            Done
          </button>
        </header>
        <div className="g-bedwars-sheet-body">{children}</div>
      </div>
    </div>,
    root,
  );
}

export function RecordStrip({ r }: { r: StatRecord }) {
  return (
    <div className="g-bedwars-record" aria-label="Your record on this device">
      <span className="g-bedwars-star">
        <b>{starOf(r)}</b>✫
      </span>
      <span>
        <b>{r.wins}</b> wins
      </span>
      <span>
        <b>{r.finals}</b> finals
      </span>
      <span>
        <b>{r.beds}</b> beds
      </span>
      <span>
        <b>{r.streak}</b> streak
      </span>
    </div>
  );
}

export function HowToPlay({ touch }: { touch: boolean }) {
  return (
    <>
      <p className="g-bedwars-lede">Protect your bed, break everyone else's. While your bed stands you come back five seconds after you die. Once it's gone, your next death is final. Last team standing wins.</p>
      <section>
        <h3>Controls</h3>
        {touch ? (
          <dl className="g-bedwars-keys">
            <dt>left side</dt>
            <dd>drag to walk (you sprint on your own)</dd>
            <dt>right side</dt>
            <dd>drag to look around</dd>
            <dt>hit</dt>
            <dd>tap to swing, hold to break blocks</dd>
            <dt>use</dt>
            <dd>hold to place blocks, draw the bow, eat or throw</dd>
            <dt>crouch</dt>
            <dd>toggles; you can't walk off an edge while crouched</dd>
            <dt>hotbar</dt>
            <dd>tap a slot to hold it</dd>
          </dl>
        ) : (
          <dl className="g-bedwars-keys">
            <dt>click</dt>
            <dd>captures the mouse (Esc lets it go)</dd>
            <dt>WASD, Space</dt>
            <dd>walk and jump. you sprint on your own (switch to Ctrl or double tap W in the settings)</dd>
            <dt>Shift</dt>
            <dd>crouch. you can't walk off an edge while crouched</dd>
            <dt>left click</dt>
            <dd>hit, or hold to break a block</dd>
            <dt>right click</dt>
            <dd>place blocks, draw the bow, eat, drink, throw, talk to the shop keepers</dd>
            <dt>1 to 9, wheel</dt>
            <dd>pick from the hotbar. Q drops what you hold</dd>
            <dt>E or B</dt>
            <dd>open the shop or team upgrades when you're next to the keeper</dd>
            <dt>Tab</dt>
            <dd>everyone's kills and beds</dd>
          </dl>
        )}
      </section>
      <section>
        <h3>Resources</h3>
        <ul>
          <li>
            <b style={{ color: RES_COLOR.iron }}>iron</b> and <b style={{ color: RES_COLOR.gold }}>gold</b> pile up at your island's forge, under the red tile roof.
          </li>
          <li>
            <b style={{ color: RES_COLOR.diamond }}>diamonds</b> spawn on the corner islands and buy team upgrades.
          </li>
          <li>
            <b style={{ color: RES_COLOR.emerald }}>emeralds</b> spawn on the Main Quad around Hoover Tower and buy the best gear.
          </li>
          <li>kill someone and you take everything they carried.</li>
        </ul>
      </section>
      <section>
        <h3>Your first minute</h3>
        <ul>
          <li>grab iron at the forge, then buy wool from the item shop (the keeper in the band jacket).</li>
          <li>wrap your bed in wool, then end stone. pick up a stone sword and chainmail.</li>
          <li>to bridge: crouch at the edge, look down at the side of the block you stand on, and keep placing as you back out.</li>
          <li>head for diamonds, buy Sharpened Swords and Reinforced Armor, then go take some beds.</li>
        </ul>
      </section>
      <section>
        <h3>Fighting</h3>
        <ul>
          <li>hits while sprinting knock harder. a hit while you fall is a critical hit.</li>
          <li>everyone has half a second of hurt immunity, so a steady rhythm beats spam.</li>
          <li>fireballs and TNT clear bed defenses and send people flying off bridges.</li>
        </ul>
      </section>
    </>
  );
}

export function Locker({ r, skin, kill, bed, onSkin, onKill, onBed }: { r: StatRecord; skin: string; kill: string; bed: string; onSkin: (v: string) => void; onKill: (v: string) => void; onBed: (v: string) => void }) {
  const group = (kind: 'skin' | 'kill' | 'bed', title: string, value: string, set: (v: string) => void) => (
    <section>
      <h3>{title}</h3>
      <div className="g-bedwars-locker">
        {COSMETICS.filter((c) => c.kind === kind).map((c) => {
          const open = c.unlocked(r);
          return (
            <button key={c.id} type="button" className={`g-bedwars-cosmetic${value === c.id ? ' is-on' : ''}${open ? '' : ' is-locked'}`} disabled={!open} onClick={() => set(c.id)}>
              <b>{c.name}</b>
              <small>{open ? (value === c.id ? 'equipped' : 'tap to equip') : c.need}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
  return (
    <>
      <RecordStrip r={r} />
      {group('skin', 'Skins', skin, onSkin)}
      {group('kill', 'Kill effects', kill, onKill)}
      {group('bed', 'Bed break effects', bed, onBed)}
    </>
  );
}
