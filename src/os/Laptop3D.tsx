import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createLaptop, type LaptopController } from './laptop3d/scene';
import { lidStickers, palmStickers } from './Stickers';

export type Laptop3DHandle = {
  enterFs(swap: () => void): Promise<void>;
  exitFs(swap: () => void): Promise<void>;
};

export type Laptop3DProps = {
  open: boolean;
  screenOn: boolean;
  lidMs: number;
  children: ReactNode;
  onPalm: (key: string) => void;
  onBody: () => void;
  onFail: () => void;
  onReady: () => void;
};

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
        onReady: () => live.current.onReady(),
      });
      ctl.current.setOpen(live.current.open, live.current.lidMs);
      ctl.current.setScreenOn(live.current.screenOn);
    } catch (e) {
      console.warn('WebGL laptop unavailable, using CSS laptop', e);
      live.current.onFail();
    }
    return () => {
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

  useImperativeHandle(
    ref,
    () => ({
      enterFs: (swap) => ctl.current?.enterFs(swap) ?? Promise.resolve(swap()),
      exitFs: (swap) => ctl.current?.exitFs(swap) ?? Promise.resolve(swap()),
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
