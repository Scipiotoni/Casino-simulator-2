/**
 * Tiny tween runner for in-world animation (cards flying, chips sliding, wheels spinning).
 * Every tween resolves a promise, so game logic can be written as plain async sequences.
 */

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  in: (t: number) => t * t * t,
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

interface Tween {
  t: number;
  dur: number;
  fn: (k: number) => void;
  ease: Ease;
  done: () => void;
  group: string;
}

export class Tweens {
  private list: Tween[] = [];
  private timers: { t: number; done: () => void; group: string }[] = [];

  /** Run fn(k) for k from 0 to 1 over `dur` seconds. */
  run(dur: number, fn: (k: number) => void, e: Ease = ease.inOut, group = ''): Promise<void> {
    return new Promise((done) => {
      if (dur <= 0) {
        fn(1);
        done();
        return;
      }
      this.list.push({ t: 0, dur, fn, ease: e, done, group });
    });
  }

  wait(seconds: number, group = ''): Promise<void> {
    return new Promise((done) => this.timers.push({ t: seconds, done, group }));
  }

  /** Finish everything in a group immediately (their promises resolve). */
  finish(group: string): void {
    for (const tw of this.list.filter((x) => x.group === group)) {
      tw.fn(1);
      tw.done();
    }
    this.list = this.list.filter((x) => x.group !== group);
    for (const tm of this.timers.filter((x) => x.group === group)) tm.done();
    this.timers = this.timers.filter((x) => x.group !== group);
  }

  update(dt: number): void {
    // Callbacks may start new tweens; those land in the fresh list and start next frame.
    const snap = this.list;
    this.list = [];
    for (const tw of snap) {
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(tw.ease(k));
      if (k >= 1) tw.done();
      else this.list.push(tw);
    }
    const tsnap = this.timers;
    this.timers = [];
    for (const tm of tsnap) {
      tm.t -= dt;
      if (tm.t <= 0) tm.done();
      else this.timers.push(tm);
    }
  }
}

export const tweens = new Tweens();
