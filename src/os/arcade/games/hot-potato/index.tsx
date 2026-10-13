import { Fragment, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { GameShell, defineSetting, sfx, useGameLoop, useKeys, useSetting, useShell } from '../../kit';
import { Avatar, Big, DrinkNote, HowToPlay, Option, Pile, PlayerList, Row, Screen, listNames, usePlayers } from '../../kit/party';
import type { GameProps } from '../../types';
import {
  LOSER_SIPS,
  addLoss,
  burnAt,
  burnProfile,
  fuseLength,
  leaders,
  lossesOf,
  nextStarter,
  promptsFor,
  removeLoss,
  standings,
  tickGap,
  type Burn,
  type Prompt,
  type PromptMode,
  type Tally,
} from './logic';
import { meta } from './meta';
import './hot-potato.css';

const PROMPTS = defineSetting('hot-potato:prompts', ['categories', 'letters', 'mix'] as const, 'mix');
const FUSE = defineSetting('hot-potato:fuse', ['short', 'normal', 'long'] as const, 'normal');
const LOSER = defineSetting('hot-potato:loser', ['point', 'drink'] as const, 'point');

/** Seconds after the boom before anything takes a tap, so a hand mid-pass can't score the wrong person. */
const ARM = 0.8;

const HOW: ReactNode[] = [
  <>
    <b>Read the prompt</b> out loud, then light the fuse.
  </>,
  <>
    Say one thing that fits and <b>pass the phone left</b>. No repeats.
  </>,
  <>Stuck? Keep thinking. You can't pass it until you've said one.</>,
  <>
    When it blows, <b>whoever's holding it loses</b> the round.
  </>,
  <>Add names to keep score. The loser starts the next round.</>,
];

type Step = { s: 'setup' } | { s: 'ready' } | { s: 'burn' } | { s: 'boom'; again?: boolean } | { s: 'score'; loser: string };
type Fuse = { total: number; burn: Burn };

export default function Game({ compact, onExit }: GameProps) {
  return (
    <GameShell meta={meta} compact={compact} onExit={onExit} autoStart>
      <Play />
    </GameShell>
  );
}

function Play() {
  const [players] = usePlayers();
  const [mode, setMode] = useSetting(PROMPTS);
  const [fuse, setFuse] = useSetting(FUSE);
  const [rule, setRule] = useSetting(LOSER);
  const [step, setStep] = useState<Step>({ s: 'setup' });
  const [table, setTable] = useState<string[]>([]);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [round, setRound] = useState(0);
  const [starter, setStarter] = useState(0);
  const [lit, setLit] = useState<Fuse | null>(null);
  const [tally, setTally] = useState<Tally>({});
  const pile = useRef<{ mode: PromptMode; pile: Pile<Prompt> } | null>(null);
  const last = useRef<Prompt | undefined>(undefined);
  const heat = useRef<HTMLDivElement | null>(null);
  const drinks = rule === 'drink';

  const draw = () => {
    if (pile.current?.mode !== mode) pile.current = { mode, pile: new Pile(promptsFor(mode)) };
    const p = pile.current.pile.draw(last.current);
    if (p) last.current = p;
    return p ?? null;
  };

  const deal = (names: string[], lastLoser: number | null) => {
    setTable(names);
    setPrompt(draw());
    setRound((r) => r + 1);
    setStarter(nextStarter(names.length, lastLoser));
    setLit(null);
    setStep({ s: 'ready' });
  };

  const skip = () => {
    sfx.play('blip', 0.9);
    setPrompt(draw());
  };

  const light = () => {
    setLit({ total: fuseLength(fuse), burn: burnProfile() });
    // A match strike: a scrape of noise and a rising hiss.
    sfx.noise(0.22, 0.16);
    sfx.tone({ freq: 220, to: 900, dur: 0.2, type: 'sawtooth', vol: 0.05 });
    setStep({ s: 'burn' });
  };

  const boom = () => {
    sfx.play('boom');
    sfx.noise(1.3, 0.42);
    sfx.tone({ freq: 120, to: 30, dur: 0.9, type: 'sine', vol: 0.6 });
    sfx.tone({ freq: 84, to: 26, dur: 0.65, type: 'sawtooth', vol: 0.16 });
    try {
      navigator.vibrate?.([90, 40, 320]);
    } catch {
      /* no vibration on this device */
    }
    setStep({ s: 'boom' });
  };

  const pick = (seat: number) => {
    const name = table[seat];
    if (!name) return;
    sfx.play('hit', 0.8);
    setTally((t) => addLoss(t, name));
    setStep({ s: 'score', loser: name });
  };

  const undo = (name: string) => {
    sfx.play('blip', 0.7);
    setTally((t) => removeLoss(t, name));
    setStep({ s: 'boom', again: true });
  };

  useKeys((code, e) => {
    if (e?.repeat) return;
    if (step.s === 'ready' && code === 'KeyS') skip();
    else if (step.s === 'score' && (code === 'KeyU' || code === 'Backspace')) undo(step.loser);
  });

  if (step.s === 'setup' || !prompt) {
    const start = () => deal(players, null);
    return (
      <Screen key="setup" className="g-hot-potato-setup" center={false} onEnter={start} actions={<Big primary onClick={start}>Start</Big>}>
        <header className="g-hot-potato-head">
          <Potato mark />
          <h2 className="arcade-party-title">Hot Potato</h2>
          <p className="arcade-party-sub">Say something that fits the prompt, then pass the phone left. Whoever's holding it when it blows loses the round.</p>
        </header>
        <HowToPlay steps={HOW} />
        <PlayerList min={0} />
        <Option
          label="Prompts"
          value={mode}
          options={[
            ['categories', 'Categories'],
            ['letters', 'Letters'],
            ['mix', 'Mix'],
          ]}
          onChange={setMode}
        />
        <Option
          label="Fuse"
          value={fuse}
          options={[
            ['short', 'Short'],
            ['normal', 'Normal'],
            ['long', 'Long'],
          ]}
          onChange={setFuse}
        />
        <Option
          label="Loser"
          value={rule}
          options={[
            ['point', 'Takes a Point'],
            ['drink', 'Drinks'],
          ]}
          onChange={setRule}
        />
        {drinks && <DrinkNote />}
      </Screen>
    );
  }

  const named = table.length > 0;

  if (step.s === 'ready' || step.s === 'burn') {
    const burning = step.s === 'burn';
    return (
      <Fragment key={`round-${round}`}>
        <div className="g-hot-potato-heat" ref={heat} aria-hidden="true" />
        <Screen
          className="g-hot-potato-round"
          kicker={named ? `${table[starter] ?? table[0]} starts` : `Round ${round}`}
          onEnter={burning ? undefined : light}
          actions={
            burning ? (
              <p className="g-hot-potato-hint">Say one, pass it left. No repeats.</p>
            ) : (
              <Row>
                <Big quiet onClick={skip}>
                  Skip Prompt
                </Big>
                <Big primary quiet onClick={light}>
                  Light the Fuse
                </Big>
              </Row>
            )
          }
        >
          <div className="g-hot-potato-table">
            <Card key={`${prompt.kind}-${prompt.text}`} prompt={prompt} />
            <Potato fuse={burning ? lit : null} heat={heat} onBoom={boom} />
          </div>
        </Screen>
      </Fragment>
    );
  }

  if (step.s === 'boom')
    return (
      <Boom
        key={`boom-${round}-${step.again ? 'again' : ''}`}
        prompt={prompt}
        table={table}
        again={!!step.again}
        drinks={drinks}
        onPick={pick}
        onSkip={() => deal(table, null)}
        onNext={() => deal(table, null)}
        onSetup={() => setStep({ s: 'setup' })}
      />
    );

  const rows = standings(tally, table);
  const next = () => deal(table, table.indexOf(step.loser));
  return (
    <Screen
      key={`score-${round}`}
      className="g-hot-potato-score"
      center={false}
      kicker={`Round ${round}`}
      title={drinks ? `${step.loser} Drinks ${LOSER_SIPS}` : `${step.loser} Takes a Point`}
      sub={standingLine(tally, table, step.loser, drinks)}
      onEnter={next}
      actions={
        <>
          <Big primary onClick={next}>
            Next Round
          </Big>
          <Row>
            <Big onClick={() => undo(step.loser)}>Undo</Big>
            <Big onClick={() => setStep({ s: 'setup' })}>Change Setup</Big>
          </Row>
        </>
      }
    >
      <ol className="arcade-party-scores g-hot-potato-scores" aria-label={drinks ? 'Rounds lost this session' : 'Points this session, fewest wins'}>
        {rows.map((r) => (
          <li key={r.name} className={r.name === step.loser ? 'is-hi' : r.losses ? undefined : 'is-zero'}>
            <Avatar name={r.name} index={r.seat} size={28} />
            <span>{r.name}</span>
            <b>{r.losses}</b>
          </li>
        ))}
      </ol>
    </Screen>
  );
}

/** Where the loser stands: "Sam's on 3, the most so far." (points) or "Sam's lost 3, the most so far." (drinks). */
function standingLine(t: Tally, names: string[], loser: string, drinks: boolean): string {
  const n = lossesOf(t, loser);
  const top = leaders(t, names);
  const max = top.length ? lossesOf(t, top[0]) : 0;
  const total = names.reduce((sum, name) => sum + lossesOf(t, name), 0);
  const one = (who: string, k: number) => (drinks ? `${who}'s lost ${k}` : `${who}'s on ${k}`);
  const many = (who: string[], k: number) => (drinks ? `${listNames(who)} have lost ${k} each` : `${listNames(who)} are tied on ${k}`);
  if (total <= 1) return drinks ? `${loser}'s lost the first round.` : 'Fewest points wins.';
  if (top.length === 1 && top[0] === loser) return `${one(loser, n)}, the most so far.`;
  if (top.includes(loser)) return `${many(top, n)}, the most so far.`;
  return `${one(loser, n)}. ${top.length === 1 ? `${top[0]} has the most with ${max}.` : `Most so far: ${listNames(top)}, ${max} each.`}`;
}

/** The prompt on cream card stock, readable from across the circle. */
function Card({ prompt, small }: { prompt: Prompt; small?: boolean }) {
  const letters = prompt.kind === 'letters';
  return (
    <div className={['arcade-party-card is-paper g-hot-potato-card', letters ? 'is-letters' : '', small ? 'is-small' : ''].join(' ')}>
      <small>{letters ? 'Any word with' : 'Name one'}</small>
      <strong>{prompt.text}</strong>
    </div>
  );
}

function useStill() {
  const [still, setStill] = useState(false);
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!m) return;
    const f = () => setStill(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return still;
}

// The potato, drawn in a 220 by 210 box: a lumpy body, its eyes, and a fuse out of the top ending at (188, 24).
const BODY = 'M30 146C24 114 52 90 94 86C134 82 172 96 178 126C184 156 158 182 114 188C68 194 36 178 30 146Z';
const EYES = 'M64 142q5 4 10 0M104 164q5 4 10 0M130 128q4 3 8 0M84 116q4 3 8 0M150 154q4 3 8 0';
const FUSE_PATH = 'M128 92C124 70 132 54 150 46C168 38 182 40 188 24';
const INK = '#2a1810';
const PAPER = '#f3e9d6';
const COOL = [220, 164, 102];
const HOT = [240, 106, 60];
const SHADE_COOL = [182, 122, 62];
const SHADE_HOT = [196, 62, 36];
const rgb = (a: number[], b: number[], t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
const star = (n: number, ro: number, ri: number) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? ri : ro;
    return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
  }).join(' ');
const SPARK_OUT = star(9, 26, 11);
const SPARK_IN = star(9, 13, 6);

function tick(left: number, tock: boolean) {
  const near = Math.min(1, Math.max(0, 1 - left / 20));
  sfx.tone({ freq: (tock ? 880 : 1180) * (1 + near * 0.3), dur: 0.035, type: 'square', vol: 0.08 + near * 0.08 });
  // The fuse crackles now and then.
  if (Math.random() < 0.3) sfx.noise(0.045, 0.03 + near * 0.03);
}

/**
 * The potato with its fuse. Given a lit fuse it runs the clock: the fuse burns along its uneven profile, the spark
 * flickers, the potato warms up and twitches on every tick, and onBoom fires when the time is up. Pausing the game
 * stops all of it. `mark` draws it small with a still spark, for the setup screen.
 */
function Potato({ fuse = null, heat, onBoom, mark }: { fuse?: Fuse | null; heat?: RefObject<HTMLDivElement | null>; onBoom?: () => void; mark?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const shell = useShell();
  const still = useStill();
  const geo = useRef<SVGPathElement | null>(null);
  const cut = useRef<SVGPathElement | null>(null);
  const spark = useRef<SVGGElement | null>(null);
  const flame = useRef<SVGGElement | null>(null);
  const embers = useRef<(SVGCircleElement | null)[]>([]);
  const body = useRef<SVGGElement | null>(null);
  const fill = useRef<SVGPathElement | null>(null);
  const shade = useRef<SVGPathElement | null>(null);
  const st = useRef({ t: 0, tickIn: 0.3, tock: false, wob: 0, dir: 1, done: false });
  const boom = useRef(onBoom);
  boom.current = onBoom;
  const lit = !!fuse;

  // Lighting removes the button that had focus; keep keys (P to pause) going to the game.
  useEffect(() => {
    if (!lit) return;
    const root = shell.root.current;
    const active = document.activeElement;
    if (root && (!active || active === document.body || !root.contains(active))) root.focus({ preventScroll: true });
  }, [lit, shell.root]);

  useGameLoop(
    (dt) => {
      const s = st.current;
      if (!fuse || s.done || dt <= 0) return;
      s.t += dt;
      if (s.t >= fuse.total) {
        s.done = true;
        boom.current?.();
        return;
      }
      s.tickIn -= dt;
      if (s.tickIn <= 0) {
        const left = fuse.total - s.t;
        tick(left, s.tock);
        s.tock = !s.tock;
        s.tickIn = tickGap(left);
        s.wob = 1;
        s.dir = -s.dir;
      }
      s.wob = Math.max(0, s.wob - dt * 7);
    },
    () => {
      const p = geo.current;
      if (!fuse || !p) return;
      const s = st.current;
      const b = burnAt(fuse.burn, s.t / fuse.total);
      const len = p.getTotalLength();
      const keep = len * (1 - b);
      cut.current?.setAttribute('stroke-dasharray', `${keep.toFixed(2)} ${(len + 20).toFixed(0)}`);
      const at = p.getPointAtLength(keep);
      spark.current?.setAttribute('transform', `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`);
      if (!still) {
        flame.current?.setAttribute('transform', `rotate(${(Math.random() * 40).toFixed(0)}) scale(${(0.8 + Math.random() * 0.4).toFixed(2)})`);
        for (const e of embers.current) {
          if (!e) continue;
          const a = Math.random() * Math.PI * 2;
          const r = 22 + Math.random() * 18;
          e.setAttribute('cx', (Math.cos(a) * r).toFixed(1));
          e.setAttribute('cy', (Math.sin(a) * r).toFixed(1));
          e.setAttribute('r', (1.4 + Math.random() * 2.4).toFixed(1));
        }
        body.current?.setAttribute('transform', `rotate(${(s.dir * s.wob * 2.4).toFixed(2)} 104 140)`);
      }
      const h = Math.min(1, b / 0.9);
      fill.current?.setAttribute('fill', rgb(COOL, HOT, h));
      shade.current?.setAttribute('fill', rgb(SHADE_COOL, SHADE_HOT, h));
      if (heat?.current) heat.current.style.opacity = (h * 0.85).toFixed(3);
    },
  );

  return (
    <svg
      className={['g-hot-potato-pot', mark ? 'is-mark' : ''].join(' ')}
      viewBox="0 0 220 210"
      role="img"
      aria-label={lit ? 'The fuse is burning' : mark ? 'A potato with a lit fuse' : 'A potato with its fuse ready'}
    >
      <defs>
        <clipPath id={`${id}-body`}>
          <path d={BODY} />
        </clipPath>
        <mask id={`${id}-fuse`} maskUnits="userSpaceOnUse" x="0" y="0" width="220" height="210">
          <path ref={cut} d={FUSE_PATH} fill="none" stroke="#fff" strokeWidth="24" />
        </mask>
      </defs>
      <g ref={body}>
        {/* Die-cut sticker edge: a cream border round the potato and its fuse. */}
        <path d={BODY} fill="none" stroke={PAPER} strokeWidth="14" strokeLinejoin="round" />
        <g mask={`url(#${id}-fuse)`}>
          <path d={FUSE_PATH} fill="none" stroke={PAPER} strokeWidth="19" strokeLinecap="round" />
        </g>
        <path ref={shade} d={BODY} fill={rgb(SHADE_COOL, SHADE_COOL, 0)} />
        <g clipPath={`url(#${id}-body)`}>
          <path ref={fill} d={BODY} transform="translate(-7 -10)" fill={rgb(COOL, COOL, 0)} />
        </g>
        <path d={EYES} fill="none" stroke="#7a4a22" strokeWidth="4" strokeLinecap="round" />
        <path d={BODY} fill="none" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
        <path ref={geo} d={FUSE_PATH} fill="none" stroke="#4a3528" strokeWidth="3" strokeLinecap="round" strokeDasharray="0.5 7" opacity="0.8" />
        <g mask={`url(#${id}-fuse)`}>
          <path d={FUSE_PATH} fill="none" stroke={INK} strokeWidth="11" strokeLinecap="round" />
          <path d={FUSE_PATH} fill="none" stroke="#ecd9ae" strokeWidth="5.5" strokeLinecap="round" />
          <path d={FUSE_PATH} fill="none" stroke="#b48b52" strokeWidth="5.5" strokeDasharray="2.5 5" />
        </g>
        <ellipse cx="128" cy="92" rx="9" ry="4.5" fill={INK} />
        {(lit || mark) && (
          <g ref={spark} transform="translate(188 24)">
            <g ref={flame}>
              <polygon points={SPARK_OUT} fill="#ffc83d" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
              <polygon points={SPARK_IN} fill="#fff6dc" />
            </g>
            {lit &&
              [0, 1, 2].map((i) => (
                <circle
                  key={i}
                  ref={(el) => {
                    embers.current[i] = el;
                  }}
                  r="0"
                  fill="#ffc83d"
                />
              ))}
          </g>
        )}
      </g>
    </svg>
  );
}

// A comic starburst, two layers, in a 132 by 104 box.
const burst = (rx: number, ry: number, jitter: readonly number[]) =>
  Array.from({ length: 32 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 0.64 : jitter[(i / 2) % jitter.length];
    return `${(66 + Math.cos(a) * rx * r).toFixed(1)},${(52 + Math.sin(a) * ry * r).toFixed(1)}`;
  }).join(' ');
const BURST_OUT = burst(63, 50, [1, 0.86, 0.97, 0.8, 1, 0.9, 0.95, 0.83, 0.99, 0.87, 0.93, 0.81]);
const BURST_IN = burst(48, 37, [0.92, 1, 0.84, 0.98, 0.88, 1, 0.9, 0.96, 0.86, 1, 0.9, 0.94]);

// Bits of potato and a few fries, flying out from the middle (x and y in px from the center).
const DEBRIS = [
  { fry: false, x: -150, y: -86, r: -200, s: 1 },
  { fry: false, x: 138, y: -100, r: 160, s: 0.8 },
  { fry: true, x: -160, y: 40, r: -320, s: 1 },
  { fry: false, x: 156, y: 56, r: 240, s: 1.1 },
  { fry: true, x: 56, y: -118, r: 280, s: 0.9 },
  { fry: false, x: -64, y: 110, r: -140, s: 0.7 },
  { fry: true, x: 112, y: 112, r: 200, s: 1 },
  { fry: false, x: -108, y: -124, r: 120, s: 0.6 },
  { fry: false, x: 20, y: 124, r: -90, s: 0.8 },
];

function Boom({
  prompt,
  table,
  again,
  drinks,
  onPick,
  onSkip,
  onNext,
  onSetup,
}: {
  prompt: Prompt;
  table: string[];
  again: boolean;
  drinks: boolean;
  onPick: (seat: number) => void;
  onSkip: () => void;
  onNext: () => void;
  onSetup: () => void;
}) {
  const { touch } = useShell();
  const [armed, setArmed] = useState(again);
  const waited = useRef(0);
  const named = table.length > 0;
  useGameLoop((dt) => {
    if (armed) return;
    waited.current += dt;
    if (waited.current >= ARM) setArmed(true);
  });
  useKeys((code, e) => {
    if (e?.repeat || !armed || !named) return;
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (m && Number(m[1]) <= table.length) onPick(Number(m[1]) - 1);
  });
  const guard = (fn: () => void) => () => {
    if (!armed) return;
    sfx.play('select');
    fn();
  };
  return (
    <>
      <Screen
        className={['g-hot-potato-boom', again ? 'is-again' : '', named ? 'is-named' : ''].join(' ')}
        onEnter={!named && armed ? guard(onNext) : undefined}
        actions={
          named ? (
            <Big quiet onClick={guard(onSkip)}>
              Don't Count It
            </Big>
          ) : (
            <>
              <Big primary quiet onClick={guard(onNext)}>
                Next Round
              </Big>
              <Big quiet onClick={guard(onSetup)}>
                Change Setup
              </Big>
            </>
          )
        }
      >
        <div className="g-hot-potato-aftermath">
          <div className="g-hot-potato-blast" role="status">
            <svg viewBox="0 0 132 104" aria-hidden="true">
              <polygon points={BURST_OUT} fill="#ff4d1a" stroke={PAPER} strokeWidth="3" strokeLinejoin="round" />
              <polygon points={BURST_IN} fill="#ffc83d" />
            </svg>
            <h2 className="g-hot-potato-boomword">Boom!</h2>
            {!again && (
              <div className="g-hot-potato-debris" aria-hidden="true">
                {DEBRIS.map((d, i) => (
                  <i
                    key={i}
                    className={d.fry ? 'is-fry' : undefined}
                    style={{ ['--x' as string]: `${d.x}px`, ['--y' as string]: `${d.y}px`, ['--r' as string]: `${d.r}deg`, ['--s' as string]: d.s }}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="g-hot-potato-after">
            <Card prompt={prompt} small />
            {named ? (
              <>
                <h3 className="g-hot-potato-who">Who was holding it?</h3>
                <div className={['arcade-party-picks g-hot-potato-picks', armed ? '' : 'is-arming'].join(' ')} role="group" aria-label="Who was holding it?">
                  {table.map((p, i) => (
                    <button key={p} type="button" onClick={() => armed && onPick(i)}>
                      <Avatar name={p} index={i} size={30} />
                      <span>{p}</span>
                      {!touch && i < 9 && <kbd aria-hidden="true">{i + 1}</kbd>}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="arcade-party-sub g-hot-potato-verdict">{drinks ? `Whoever's holding it drinks ${LOSER_SIPS}.` : "Whoever's holding it loses this round."}</p>
            )}
          </div>
        </div>
      </Screen>
      {!again && <div className="g-hot-potato-flash" aria-hidden="true" />}
    </>
  );
}
