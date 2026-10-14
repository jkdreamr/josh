// A steady beat for the online host while its tab is hidden: the browser stops drawing frames there and slows page
// timers to once a second or less, but a worker's timers keep their pace. Post a period in ms to start, 0 to stop.
let timer: ReturnType<typeof setInterval> | undefined;

self.onmessage = (e: MessageEvent<number>) => {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  const ms = Number(e.data);
  if (ms > 0) timer = setInterval(() => (self as unknown as Worker).postMessage(0), Math.max(10, ms));
};
