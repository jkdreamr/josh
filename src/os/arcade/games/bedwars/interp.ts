// Smooth motion for players this machine does not move: a short buffer of timestamped poses, sampled a little in the
// past and interpolated (extrapolated briefly when packets are late). Pure, so it runs under node.

export type Pose = { t: number; x: number; y: number; z: number; yaw: number; pitch: number };

const TAU = Math.PI * 2;
/** An angle folded into -PI..PI in one step (a loop would never finish on a huge value from a bad packet). */
export const wrapAngle = (a: number) => (Number.isFinite(a) ? a - TAU * Math.floor((a + Math.PI) / TAU) : 0);
const wrap = wrapAngle;

export class Track {
  private buf: Pose[] = [];
  private readonly cap: number;
  constructor(cap = 24) {
    this.cap = cap;
  }

  /** Adds a pose; out-of-order ones (older than the newest) are dropped. */
  push(t: number, x: number, y: number, z: number, yaw: number, pitch: number) {
    const last = this.buf[this.buf.length - 1];
    if (last && t <= last.t) {
      if (t === last.t) Object.assign(last, { x, y, z, yaw, pitch });
      return;
    }
    this.buf.push({ t, x, y, z, yaw, pitch });
    if (this.buf.length > this.cap) this.buf.shift();
  }

  /** Jumps straight to a pose (respawn, teleport). */
  snap(t: number, x: number, y: number, z: number, yaw: number, pitch: number) {
    this.buf.length = 0;
    this.buf.push({ t, x, y, z, yaw, pitch });
  }

  get size() {
    return this.buf.length;
  }

  latest(): Pose | null {
    return this.buf[this.buf.length - 1] ?? null;
  }

  /** The pose at time t (interpolated; held or extrapolated up to 150ms past the newest). */
  sample(t: number, out: Pose): boolean {
    const b = this.buf;
    if (!b.length) return false;
    if (t <= b[0].t) {
      Object.assign(out, b[0]);
      return true;
    }
    for (let i = b.length - 1; i > 0; i--) {
      const a = b[i - 1];
      const c = b[i];
      if (t >= a.t && t <= c.t) {
        const k = (t - a.t) / Math.max(1e-6, c.t - a.t);
        out.t = t;
        out.x = a.x + (c.x - a.x) * k;
        out.y = a.y + (c.y - a.y) * k;
        out.z = a.z + (c.z - a.z) * k;
        out.yaw = a.yaw + wrap(c.yaw - a.yaw) * k;
        out.pitch = a.pitch + (c.pitch - a.pitch) * k;
        return true;
      }
    }
    // past the newest: extrapolate a little from the last two, then hold
    const c = b[b.length - 1];
    const a = b[b.length - 2];
    const over = Math.min(0.15, t - c.t);
    if (a && c.t > a.t && over > 0) {
      const k = over / (c.t - a.t);
      out.x = c.x + (c.x - a.x) * k;
      out.y = c.y + (c.y - a.y) * k;
      out.z = c.z + (c.z - a.z) * k;
    } else {
      out.x = c.x;
      out.y = c.y;
      out.z = c.z;
    }
    out.t = t;
    out.yaw = c.yaw;
    out.pitch = c.pitch;
    return true;
  }
}
