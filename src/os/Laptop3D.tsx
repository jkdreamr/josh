import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createLaptop, type LaptopController } from './laptop3d/scene';
import { createTyper, type Mods } from './laptop3d/typing';
import { lidStickers, palmStickers } from './Stickers';

export type Laptop3DHandle = {
  enterFs(swap: () => void): Promise<void>;
  exitFs(swap: () => void): Promise<void>;
  closeLid(): Promise<void>;
  resetView(): Promise<void>;
};

export type Laptop3DProps = {
  open: boolean;
  screenOn: boolean;
  /** Lid drag and typing are enabled once the OS is on (or asleep). */
  interactive: boolean;
  lidMs: number;
  children: ReactNode;
  onPalm: (key: string) => void;
  onBody: () => void;
  /** A 3D key was pressed. Return true to swallow it (e.g. while booting). */
  onKey: (code: string) => boolean;
  onLid: (open: boolean, remaining: number) => void;
  onOrbit: (rotated: boolean) => void;
  onFail: () => void;
  onReady: () => void;
};

const heldCodes = (m: Mods) => [
  ...(m.shift ? ['ShiftLeft'] : []),
  ...(m.caps ? ['CapsLock'] : []),
  ...(m.meta ? ['MetaLeft'] : []),
  ...(m.ctrl ? ['ControlLeft'] : []),
  ...(m.alt ? ['AltLeft'] : []),
];

/** Photoreal WebGL MacBook. The live desktop is real DOM projected onto the display with CSS3D, so clicks hit exact pixels. */
const Laptop3D = forwardRef<Laptop3DHandle, Laptop3DProps>(function Laptop3D(props, ref) {
  const box = useRef<HTMLDivElement>(null);
  const fsLayer = useRef<HTMLDivElement>(null);
  const src = useRef<HTMLDivElement>(null);
  const ctl = useRef<LaptopController | null>(null);
  const live = useRef(props);
  live.current = props;
  const [host] = useState(() => {
    const el = document.createElement('div');
    el.className = 'screen';
    return el;
  });

  useEffect(() => {
    const typer = createTyper(host, (m) => ctl.current?.setHeld(heldCodes(m)));
    try {
      ctl.current = createLaptop({
        container: box.current!,
        host,
        fsLayer: fsLayer.current!,
        stickerSource: src.current!,
        lid: lidStickers,
        palm: palmStickers,
        onPalm: (k) => live.current.onPalm(k),
        onBody: () => (live.current.onBody(), true),
        onKey: (k) => {
          if (!live.current.onKey(k.code)) typer.press(k);
        },
        onLid: (open, remaining) => live.current.onLid(open, remaining),
        onOrbit: (r) => live.current.onOrbit(r),
        onReady: () => live.current.onReady(),
      });
      ctl.current.setOpen(live.current.open, live.current.lidMs);
      ctl.current.setScreenOn(live.current.screenOn);
      ctl.current.setInteractive(live.current.interactive);
      if (import.meta.env.DEV) Object.assign(window, { __laptop: ctl.current });
    } catch (e) {
      console.warn('WebGL laptop unavailable, using CSS laptop', e);
      live.current.onFail();
    }
    // the visitor's own keyboard presses the matching 3D keys
    const onKey = (e: KeyboardEvent) => {
      if (!e.isTrusted || (e.type === 'keydown' && e.repeat)) return;
      ctl.current?.tapKey(e.code, e.type === 'keydown');
    };
    const onBlur = () => {
      for (const code of ['MetaLeft', 'MetaRight', 'AltLeft', 'AltRight', 'ControlLeft', 'ShiftLeft', 'ShiftRight']) ctl.current?.tapKey(code, false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onBlur);
      typer.dispose();
      ctl.current?.dispose();
      ctl.current = null;
    };
  }, [host]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    ctl.current?.setOpen(props.open, props.lidMs);
  }, [props.open, props.lidMs]);
  useEffect(() => ctl.current?.setScreenOn(props.screenOn), [props.screenOn]);
  useEffect(() => ctl.current?.setInteractive(props.interactive), [props.interactive]);

  useImperativeHandle(
    ref,
    () => ({
      enterFs: (swap) => ctl.current?.enterFs(swap) ?? Promise.resolve(swap()),
      exitFs: (swap) => ctl.current?.exitFs(swap) ?? Promise.resolve(swap()),
      closeLid: () => ctl.current?.closeLid() ?? Promise.resolve(),
      resetView: () => ctl.current?.resetView() ?? Promise.resolve(),
    }),
    [],
  );

  return (
    <>
      <div className="l3d" ref={box} />
      <div className="l3d-fs" ref={fsLayer} />
      <div className="l3d-src" ref={src} aria-hidden="true">
        {[...lidStickers, ...palmStickers].map((s) => (
          <div key={s.key} data-sticker={s.key}>
            {s.el}
          </div>
        ))}
      </div>
      <div className="l3d-a11y">
        {palmStickers.map((s) => (
          <button key={s.key} type="button" onClick={() => props.onPalm(s.key)}>
            {s.label}
          </button>
        ))}
      </div>
      {createPortal(props.children, host)}
    </>
  );
});

export default Laptop3D;
