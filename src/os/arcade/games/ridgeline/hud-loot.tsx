// Royale loot on screen: the pickup toasts (a line for each thing you take, at the right edge for a moment, tinted by
// how good it is) and the Setup switch for the loot glow (the rings and shafts drawn over loot in gfx/royale.ts).
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Segmented, defineSetting, useSetting, useShell } from '../../kit';
import type { Match } from './match.ts';
import { PickupFeed, TOAST_LIFE, addToast, liveToasts, nextExpiry, type Toast } from './loot-feed.ts';
import { TIER_CSS } from './loot-tier.ts';

/** The rings and shafts that show where loot lies and how good it is (on by default). */
export const LOOTGLOW = defineSetting('ridgeline:lootglow', ['on', 'off'] as const, 'on', { live: true });
const glowOptions = [
  ['on', 'On'],
  ['off', 'Off'],
] as const;

/** The Setup card's switch for the loot glow. */
export function LootGlowSetting() {
  const [glow, setGlow] = useSetting(LOOTGLOW);
  return <Segmented label="Loot glow" value={glow} options={glowOptions} onChange={setGlow} />;
}

/** Whether the loot glow is on, as a ref the frame loop reads (a change redraws at once, even while paused). */
export function useLootGlow() {
  const [glow] = useSetting(LOOTGLOW);
  const shell = useShell();
  const on = useRef(glow === 'on');
  on.current = glow === 'on';
  const invalidate = shell.invalidate;
  useEffect(() => invalidate(), [glow, invalidate]);
  return on;
}

export type PickupToastsApi = {
  /** Reads this frame's events for your own pickups (call once a frame, after the step). */
  feed(m: Match): void;
};

const clock = () => performance.now() / 1000;

/** The pickup toasts: at most four lines, newest at the bottom, each fading after TOAST_LIFE seconds. */
export const PickupToasts = forwardRef<PickupToastsApi>(function PickupToasts(_, ref) {
  const [list, setList] = useState<Toast[]>([]);
  const feed = useRef<PickupFeed | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      feed(m) {
        const add = (feed.current ??= new PickupFeed()).take(m, clock());
        if (!add.length) return;
        const now = clock();
        setList((l) => add.reduce((acc, t) => addToast(acc, t, now), l));
      },
    }),
    [],
  );
  // drop each line once it has run out
  useEffect(() => {
    if (!list.length) return;
    const ms = Math.max(30, (nextExpiry(list) - clock()) * 1000 + 30);
    const id = window.setTimeout(() => setList((l) => liveToasts(l, clock())), ms);
    return () => window.clearTimeout(id);
  }, [list]);
  if (!list.length) return null;
  return (
    <div className="g-ridgeline-toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.key} data-tier={t.tier} style={{ ['--g-ridgeline-tier' as string]: TIER_CSS[t.tier], animationDuration: `${TOAST_LIFE}s` }}>
          <i aria-hidden="true" />
          <span>{t.text}</span>
          {t.plus > 0 && <b>+{t.plus}</b>}
        </div>
      ))}
    </div>
  );
});
