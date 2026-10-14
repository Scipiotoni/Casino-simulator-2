import { mulberry32 } from '../../core/noise';
import { SECTION_BARS, SONG_BARS, STEPS, composeBar, stepTime, type Inst, type Note, type StationDef } from './music';

/**
 * Plays a station with Web Audio. Drums, plucked strings and mallets are rendered once into
 * small buffers (plain JS: noise, Karplus-Strong, decaying partials), so a hit costs one buffer
 * source and one gain; synths and electric pianos are oscillators with envelopes. Every
 * instrument has a channel strip (filter, tape wobble or tremolo, level, pan, sends to the room
 * and the tempo echo), and the station a soft compressor on its output.
 *
 * Notes are scheduled by a lookahead scheduler: `pump()` is called a few times a second and
 * schedules every note that starts before `until`, a bar at a time.
 */

/** How far ahead notes are scheduled (s), and how often the scheduler looks (ms). */
export const LOOKAHEAD = 0.4;
export const TICK_MS = 50;

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// ---------------------------------------------------------------- rendering samples

type Filt = NonNullable<Inst['filter']>;

/** An RBJ biquad, for shaping noise while rendering samples. */
function biquad(f: Filt, sr: number): (x: number) => number {
  const w = (2 * Math.PI * Math.min(f.freq, sr * 0.45)) / sr;
  const cs = Math.cos(w);
  const al = Math.sin(w) / (2 * (f.q ?? 0.707));
  let b0: number, b1: number, b2: number;
  if (f.type === 'lowpass') [b0, b1, b2] = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2];
  else if (f.type === 'highpass') [b0, b1, b2] = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2];
  else [b0, b1, b2] = [al, 0, -al];
  const a0 = 1 + al;
  const [c0, c1, c2, d1, d2] = [b0 / a0, b1 / a0, b2 / a0, (-2 * cs) / a0, (1 - al) / a0];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = c0 * x + c1 * x1 + c2 * x2 - d1 * y1 - d2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

function normalise(d: Float32Array, to = 0.95): Float32Array {
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < d.length; i++) d[i] *= to / peak;
  return d;
}

/** Kick: a sine sweeping down, a beater click, a touch of saturation. */
function renderKick(i: Inst, sr: number): Float32Array {
  const d = i.d ?? 0.2, f0 = i.f0 ?? 120, f1 = i.f1 ?? 45;
  const out = new Float32Array(Math.round(sr * Math.min(1.2, d * 5 + 0.02)));
  const rnd = mulberry32(7);
  let ph = 0;
  for (let k = 0; k < out.length; k++) {
    const t = k / sr;
    ph += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t / 0.03))) / sr;
    let v = Math.sin(ph) * Math.exp(-t / d) * Math.min(1, t / 0.0015);
    v += (rnd() * 2 - 1) * Math.exp(-t / 0.002) * 0.2;
    out[k] = Math.tanh(v * 1.6) / Math.tanh(1.6);
  }
  return out;
}

/** Snare: a short pitched body and a longer burst of filtered noise. */
function renderSnare(i: Inst, sr: number): Float32Array {
  const d = i.d ?? 0.15, f0 = i.f0 ?? 190;
  const out = new Float32Array(Math.round(sr * Math.min(1, d * 5 + 0.02)));
  const f = biquad(i.filter ?? { type: 'highpass', freq: 1200 }, sr);
  const rnd = mulberry32(11);
  let ph = 0;
  for (let k = 0; k < out.length; k++) {
    const t = k / sr;
    ph += (2 * Math.PI * f0 * (1 + 0.3 * Math.exp(-t / 0.01))) / sr;
    const body = (Math.sin(ph) + 0.4 * Math.sin(ph * 1.5)) * Math.exp(-t / 0.045) * 0.6;
    const nz = f(rnd() * 2 - 1) * Math.exp(-t / d) * 1.3;
    out[k] = (body + nz) * Math.min(1, t / 0.001);
  }
  return normalise(out);
}

/** Hats, shakers, brushes, cymbals: filtered noise with an attack and a decay. */
function renderNoise(i: Inst, sr: number): Float32Array {
  const a = i.a ?? 0.001, d = i.d ?? 0.05;
  const out = new Float32Array(Math.round(sr * Math.min(2.5, a + d * 5 + 0.01)));
  const f = biquad(i.filter ?? { type: 'highpass', freq: 7000 }, sr);
  const rnd = mulberry32(13);
  for (let k = 0; k < out.length; k++) {
    const t = k / sr;
    out[k] = f(rnd() * 2 - 1) * (t < a ? t / a : Math.exp(-(t - a) / d));
  }
  return normalise(out);
}

/** Toms and congas: a sine dropping onto its pitch. */
function renderTom(i: Inst, midi: number, sr: number): Float32Array {
  const fr = midi ? mtof(midi) : (i.f0 ?? 120), d = i.d ?? 0.2;
  const out = new Float32Array(Math.round(sr * Math.min(1, d * 5 + 0.02)));
  const rnd = mulberry32(17);
  let ph = 0;
  for (let k = 0; k < out.length; k++) {
    const t = k / sr;
    ph += (2 * Math.PI * fr * (1 + 0.45 * Math.exp(-t / 0.018))) / sr;
    out[k] = (Math.sin(ph) * Math.exp(-t / d) + (rnd() * 2 - 1) * Math.exp(-t / 0.003) * 0.15) * Math.min(1, t / 0.001);
  }
  return normalise(out, 0.9);
}

/** Woodblock, clave, rim: two quick partials and a click. */
function renderWood(i: Inst, midi: number, sr: number): Float32Array {
  const fr = midi ? mtof(midi) : (i.f0 ?? 1200), d = i.d ?? 0.04;
  const out = new Float32Array(Math.round(sr * Math.min(0.5, d * 6 + 0.01)));
  const rnd = mulberry32(19);
  for (let k = 0; k < out.length; k++) {
    const t = k / sr;
    const w = 2 * Math.PI * fr * t;
    out[k] = (Math.sin(w) * Math.exp(-t / d) + 0.4 * Math.sin(w * 2.03) * Math.exp(-t / (d * 0.5)) + (rnd() * 2 - 1) * Math.exp(-t / 0.0015) * 0.3) * Math.min(1, t / 0.0005);
  }
  return normalise(out, 0.9);
}

/**
 * A plucked string (Karplus-Strong): a burst of noise circulating in a delay line one period
 * long, losing its highs a little on every pass. `bright` keeps more of them (the twang) and
 * picks nearer the bridge. Returns the samples and the playback rate that puts it in tune.
 */
function renderPluck(i: Inst, midi: number, sr: number): { data: Float32Array; rate: number } {
  const bright = i.bright ?? 0.5;
  const dur = Math.min(2.5, i.d ?? 1.5);
  const period = sr / mtof(midi);
  const a = bright * 0.45;
  const N = Math.max(2, Math.floor(period - (1 - a) * 0.5));
  const D = N + (1 - a) * 0.5;
  // Loss per pass: about -50 dB after `dur`.
  const g = Math.pow(0.003, D / (dur * sr));
  const rnd = mulberry32(23 + midi);
  const ring = new Float32Array(N);
  let lp = 0;
  const k = 0.15 + 0.85 * bright;
  for (let j = 0; j < N; j++) {
    lp += (rnd() * 2 - 1 - lp) * k;
    ring[j] = lp;
  }
  // Picking position: a comb takes out the harmonics with a node there.
  const P = Math.max(1, Math.round(N * (0.2 - bright * 0.1)));
  const exc = ring.map((v, j) => v - 0.6 * ring[(j + P) % N]);
  let mean = 0;
  for (const v of exc) mean += v / N;
  for (let j = 0; j < N; j++) ring[j] = (exc[j] - mean) * 0.8;
  const out = new Float32Array(Math.round(sr * dur));
  let prev = 0;
  let idx = 0;
  for (let n = 0; n < out.length; n++) {
    const v = ring[idx];
    ring[idx] = g * (a * v + (1 - a) * 0.5 * (v + prev));
    prev = v;
    out[n] = v;
    if (++idx === N) idx = 0;
  }
  const fade = Math.min(out.length, Math.round(sr * 0.01));
  for (let n = 0; n < fade; n++) out[out.length - 1 - n] *= n / fade;
  return { data: out, rate: D / period };
}

/** Vibes, marimba, steel pan, bells: decaying partials (recursive sine oscillators) and a soft strike. */
function renderMallet(i: Inst, midi: number, sr: number): Float32Array {
  const fr = mtof(midi), d = i.d ?? 1;
  const out = new Float32Array(Math.round(sr * Math.min(2.6, d * 2 + 0.05)));
  for (const [ratio, level, mult] of [[1, 1, 1], ...(i.partials ?? [])]) {
    const w = (2 * Math.PI * fr * ratio) / sr;
    if (fr * ratio > sr * 0.45) continue;
    const c = 2 * Math.cos(w);
    const decay = Math.exp(-3 / (d * mult * sr));
    let s0 = 0, sm1 = -Math.sin(w), env = level;
    for (let k = 0; k < out.length && env > 1e-4; k++) {
      out[k] += s0 * env;
      const s1 = c * s0 - sm1;
      sm1 = s0;
      s0 = s1;
      env *= decay;
    }
  }
  const att = Math.round(sr * 0.0015);
  for (let k = 0; k < att && k < out.length; k++) out[k] *= k / att;
  return out;
}

/** A few seconds of vinyl: soft hiss and the odd crackle (looped). */
function renderHiss(sr: number): Float32Array {
  const out = new Float32Array(Math.round(sr * 3));
  const rnd = mulberry32(29);
  let lp = 0;
  let pop = 0;
  for (let k = 0; k < out.length; k++) {
    const w = rnd() * 2 - 1;
    lp += (w - lp) * 0.2;
    if (rnd() < 9 / sr) pop = (rnd() < 0.5 ? -1 : 1) * (0.3 + rnd() ** 2 * 1.2);
    out[k] = lp * 0.5 + pop;
    pop *= 0.75;
  }
  return out;
}

/** An impulse for the room: decorrelated noise in each ear, darker as it dies away. */
function renderRoom(ctx: BaseAudioContext, secs: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.round(sr * secs);
  const ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    const rnd = mulberry32(31 + ch);
    let lp = 0;
    const pre = Math.round(sr * 0.012);
    for (let k = pre; k < len; k++) {
      const u = (k - pre) / (len - pre);
      lp += (rnd() * 2 - 1 - lp) * (0.85 - 0.75 * u);
      d[k] = lp * Math.pow(1 - u, 3);
    }
  }
  return ir;
}

/** Shared per audio context: the room's impulse and a second of white noise. */
interface Bank {
  room: AudioBuffer;
  noise: AudioBuffer;
}
const banks = new WeakMap<BaseAudioContext, Bank>();

function bank(ctx: BaseAudioContext): Bank {
  let b = banks.get(ctx);
  if (!b) {
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    const rnd = mulberry32(37);
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
    b = { room: renderRoom(ctx, 1.8), noise };
    banks.set(ctx, b);
  }
  return b;
}

function toBuffer(ctx: BaseAudioContext, data: Float32Array, sr: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.max(1, data.length), sr);
  b.getChannelData(0).set(data);
  return b;
}

/** A short burst of static between stations. */
export function tuningStatic(ctx: BaseAudioContext, dest: AudioNode, t: number, len = 0.22): void {
  const src = ctx.createBufferSource();
  src.buffer = bank(ctx).noise;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.4;
  f.frequency.setValueAtTime(900, t);
  f.frequency.exponentialRampToValueAtTime(3200, t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.14, t + 0.02);
  g.gain.setTargetAtTime(0, t + len * 0.6, len * 0.15);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + len + 0.1);
}

// ---------------------------------------------------------------- the player

interface Sample {
  buf: AudioBuffer;
  rate: number;
}

/** Where the station is "now": stations keep playing while you're not listening. */
export function livePosition(st: StationDef, wallSeconds: number): { bar: number; step: number } {
  const cycle = SONG_BARS * STEPS * 4096;
  const pos = (((wallSeconds / stepTime(st) + st.seed * 977) % cycle) + cycle) % cycle;
  const bar = Math.floor(pos / STEPS);
  return { bar, step: pos - bar * STEPS };
}

export class StationPlayer {
  /** The station's output (fade it with `fade`). */
  readonly out: GainNode;
  /** Notes scheduled so far. */
  notes = 0;
  private readonly step: number;
  private readonly mix: GainNode;
  private readonly verbIn: GainNode;
  private readonly echoIn: GainNode;
  private readonly strips = new Map<string, GainNode>();
  private readonly nodes: AudioNode[] = [];
  private readonly loops: AudioScheduledSourceNode[] = [];
  private readonly samples = new Map<string, Sample>();
  /** Pitched samples are rendered at half rate when the context runs at 44.1/48 kHz (half the memory). */
  private readonly sampleRate: number;
  private bar = 0;
  private barT = 0;
  private queue: Note[] = [];
  private cursor = 0;
  private alive = true;

  constructor(readonly ctx: BaseAudioContext, readonly st: StationDef, dest: AudioNode) {
    const c = ctx;
    this.step = stepTime(st);
    this.sampleRate = c.sampleRate >= 44100 ? c.sampleRate / 2 : c.sampleRate;
    this.out = c.createGain();
    const keep = <T extends AudioNode>(n: T): T => {
      this.nodes.push(n);
      return n;
    };
    // Output: mix → (dusty lowpass) → rumble filter → soft compressor → trim → out.
    this.mix = keep(c.createGain());
    let head: AudioNode = this.mix;
    if (st.tone) {
      const lp = keep(c.createBiquadFilter());
      lp.type = 'lowpass';
      lp.frequency.value = st.tone;
      lp.Q.value = 0.5;
      head.connect(lp);
      head = lp;
    }
    const hp = keep(c.createBiquadFilter());
    hp.type = 'highpass';
    hp.frequency.value = 32;
    const comp = keep(c.createDynamicsCompressor());
    comp.threshold.value = -12;
    comp.knee.value = 10;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    const trim = keep(c.createGain());
    trim.gain.value = st.level ?? 1;
    head.connect(hp);
    hp.connect(comp);
    comp.connect(trim);
    trim.connect(this.out);
    this.out.connect(dest);
    // The room.
    this.verbIn = keep(c.createGain());
    const verb = keep(c.createConvolver());
    verb.buffer = bank(c).room;
    const verbOut = keep(c.createGain());
    verbOut.gain.value = 0.5;
    this.verbIn.connect(verb);
    verb.connect(verbOut);
    verbOut.connect(this.mix);
    // The tempo echo: a delay feeding back through a band-pass, a little of it into the room.
    this.echoIn = keep(c.createGain());
    const delay = keep(c.createDelay(2));
    delay.delayTime.value = Math.min(1.9, st.echo[0] * this.step);
    const elp = keep(c.createBiquadFilter());
    elp.type = 'lowpass';
    elp.frequency.value = 2600;
    const ehp = keep(c.createBiquadFilter());
    ehp.type = 'highpass';
    ehp.frequency.value = 280;
    const fb = keep(c.createGain());
    fb.gain.value = Math.min(0.7, st.echo[1]);
    const echoOut = keep(c.createGain());
    echoOut.gain.value = 0.7;
    this.echoIn.connect(delay);
    delay.connect(elp);
    elp.connect(ehp);
    ehp.connect(fb);
    fb.connect(delay);
    ehp.connect(echoOut);
    echoOut.connect(this.mix);
    echoOut.connect(this.verbIn);
    for (const [name, inst] of Object.entries(st.kit)) this.strips.set(name, this.strip(inst));
  }

  /** An instrument's channel: filter, wobble, level (with tremolo), pan and sends. */
  private strip(inst: Inst): GainNode {
    const c = this.ctx;
    const keep = <T extends AudioNode>(n: T): T => {
      this.nodes.push(n);
      return n;
    };
    const input = keep(c.createGain());
    let head: AudioNode = input;
    const drum = inst.kind === 'kick' || inst.kind === 'snare' || inst.kind === 'noise' || inst.kind === 'tom' || inst.kind === 'wood';
    if (inst.filter && !drum) {
      const f = keep(c.createBiquadFilter());
      f.type = inst.filter.type;
      f.frequency.value = inst.filter.freq;
      f.Q.value = inst.filter.q ?? 0.707;
      head.connect(f);
      head = f;
    }
    if (inst.wobble) {
      // Pitch wobble from a delay line whose length swings: depth in cents at `rate` Hz.
      const [rate, cents] = inst.wobble;
      const amp = (Math.pow(2, cents / 1200) - 1) / (2 * Math.PI * rate);
      const d = keep(c.createDelay(0.1));
      d.delayTime.value = amp + 0.003;
      const lfo = c.createOscillator();
      lfo.frequency.value = rate;
      const depth = keep(c.createGain());
      depth.gain.value = amp;
      lfo.connect(depth);
      depth.connect(d.delayTime);
      lfo.start();
      this.loops.push(lfo);
      this.nodes.push(lfo);
      head.connect(d);
      head = d;
    }
    const level = keep(c.createGain());
    level.gain.value = inst.gain;
    if (inst.trem) {
      const [rate, depth] = inst.trem;
      level.gain.value = inst.gain * (1 - depth / 2);
      const lfo = c.createOscillator();
      lfo.frequency.value = rate;
      const g = keep(c.createGain());
      g.gain.value = (inst.gain * depth) / 2;
      lfo.connect(g);
      g.connect(level.gain);
      lfo.start();
      this.loops.push(lfo);
      this.nodes.push(lfo);
    }
    head.connect(level);
    let out: AudioNode = level;
    if (inst.pan && c.createStereoPanner) {
      const p = keep(c.createStereoPanner());
      p.pan.value = inst.pan;
      level.connect(p);
      out = p;
    }
    out.connect(this.mix);
    for (const [amount, to] of [[inst.verb, this.verbIn], [inst.echo, this.echoIn]] as const) {
      if (!amount) continue;
      const s = keep(c.createGain());
      s.gain.value = amount;
      out.connect(s);
      s.connect(to);
    }
    if (inst.kind === 'hiss') {
      const src = c.createBufferSource();
      src.buffer = toBuffer(c, renderHiss(this.sampleRate), this.sampleRate);
      src.loop = true;
      src.connect(input);
      src.start();
      this.loops.push(src);
      this.nodes.push(src);
    }
    return input;
  }

  /** Begin with bar `bar` (from step `from`) at time `t`. Long notes already sounding come in too. */
  start(t: number, bar: number, from = 0): void {
    this.bar = bar;
    this.barT = t - from * this.step;
    this.queue = composeBar(this.st, bar);
    this.cursor = 0;
    while (this.cursor < this.queue.length && this.queue[this.cursor].at < from - 1e-6) {
      const nt = this.queue[this.cursor++];
      const kind = this.st.kit[nt.inst]?.kind;
      const left = nt.at + nt.len - from;
      if ((kind === 'tone' || kind === 'fm') && left >= 2) this.play({ ...nt, at: from, len: left, gate: undefined }, t);
    }
  }

  /** Schedule every note starting before `until`; notes already later than `now` are dropped. */
  pump(until: number, now = this.ctx.currentTime): void {
    if (!this.alive) return;
    const barLen = STEPS * this.step;
    for (let guard = 0; guard < 8; guard++) {
      while (this.cursor < this.queue.length) {
        const nt = this.queue[this.cursor];
        const t = this.barT + nt.at * this.step;
        if (t >= until) return;
        this.cursor++;
        if (t >= now - 0.005) this.play(nt, t);
      }
      // On to the next bar, skipping any the scheduler slept through.
      let next = this.barT + barLen;
      let index = this.bar + 1;
      if (next + barLen < now) {
        const skip = Math.floor((now - next) / barLen);
        index += skip;
        next += skip * barLen;
      }
      this.bar = index;
      this.barT = next;
      this.queue = composeBar(this.st, index);
      this.cursor = 0;
      if (next >= until) return;
    }
  }

  /** Ramp the output to `to` over `secs`, from `at`. */
  fade(to: number, secs: number, at = this.ctx.currentTime): void {
    const g = this.out.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(g.value, at);
    g.linearRampToValueAtTime(to, at + Math.max(0.01, secs));
  }

  /** Stop everything and let go of the graph. */
  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    for (const s of this.loops) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const n of this.nodes) n.disconnect();
    this.out.disconnect();
    this.samples.clear();
    this.strips.clear();
  }

  // ---------------------------------------------------------------- notes

  private play(nt: Note, t: number): void {
    const inst = this.st.kit[nt.inst];
    const dest = this.strips.get(nt.inst);
    if (!inst || !dest || inst.kind === 'hiss') return;
    this.notes++;
    const len = Math.max(0.02, nt.len * this.step);
    if (inst.kind === 'tone') this.tone(inst, dest, nt, t, len);
    else if (inst.kind === 'fm') this.fm(inst, dest, nt, t, len);
    else this.sample(nt.inst, inst, dest, nt, t, len);
  }

  private sampleFor(name: string, inst: Inst, midi: number): Sample {
    const key = `${name}:${midi}`;
    let s = this.samples.get(key);
    if (s) return s;
    const c = this.ctx;
    const full = c.sampleRate;
    const half = this.sampleRate;
    switch (inst.kind) {
      case 'kick': s = { buf: toBuffer(c, renderKick(inst, full), full), rate: 1 }; break;
      case 'snare': s = { buf: toBuffer(c, renderSnare(inst, full), full), rate: 1 }; break;
      case 'tom': s = { buf: toBuffer(c, renderTom(inst, midi, full), full), rate: 1 }; break;
      case 'wood': s = { buf: toBuffer(c, renderWood(inst, midi, full), full), rate: 1 }; break;
      case 'pluck': {
        const p = renderPluck(inst, midi, half);
        s = { buf: toBuffer(c, p.data, half), rate: p.rate };
        break;
      }
      case 'mallet': s = { buf: toBuffer(c, renderMallet(inst, midi, half), half), rate: 1 }; break;
      default: s = { buf: toBuffer(c, renderNoise(inst, full), full), rate: 1 };
    }
    this.samples.set(key, s);
    return s;
  }

  private sample(name: string, inst: Inst, dest: AudioNode, nt: Note, t: number, len: number): void {
    const c = this.ctx;
    const pitched = inst.kind === 'pluck' || inst.kind === 'mallet' || ((inst.kind === 'tom' || inst.kind === 'wood') && nt.midi > 0);
    const s = this.sampleFor(name, inst, pitched ? nt.midi : 0);
    const src = c.createBufferSource();
    src.buffer = s.buf;
    if (inst.bend && nt.len >= 6) {
      src.playbackRate.setValueAtTime(s.rate * Math.pow(2, -inst.bend / 12), t);
      src.playbackRate.exponentialRampToValueAtTime(s.rate, t + 0.09);
    } else src.playbackRate.value = s.rate;
    const g = c.createGain();
    g.gain.value = nt.vel;
    src.connect(g);
    g.connect(dest);
    src.start(t);
    // Strings and bars are damped when the note ends.
    if (inst.kind === 'pluck' || inst.kind === 'mallet') {
      const r = inst.r ?? 0.15;
      const off = t + len;
      if (off + r * 1.6 < t + s.buf.duration / s.rate) {
        g.gain.setValueAtTime(nt.vel, off);
        g.gain.setTargetAtTime(0, off, r / 4);
        src.stop(off + r * 1.6);
      }
    }
  }

  /** Envelope on `g`: attack, decay to the sustain level, release at `off`. Returns when it's silent. */
  private envelope(g: GainNode, inst: Inst, peak: number, t: number, len: number): number {
    const a = inst.a ?? 0.005, d = inst.d ?? 0.3, s = inst.s ?? 0.6, r = inst.r ?? 0.1;
    const off = Math.max(t + a + 0.005, t + len);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(peak * s, t + a, d / 3);
    g.gain.setTargetAtTime(0, off, r / 4);
    const end = off + r * 1.6;
    return s === 0 ? Math.min(end, t + a + d * 2.4) : end;
  }

  /** Gated notes switch on and off every sixteenth. */
  private gated(nt: Note, t: number, dest: AudioNode): AudioNode {
    if (!nt.gate) return dest;
    const gg = this.ctx.createGain();
    for (let k = 0; k < Math.ceil(nt.len); k++) gg.gain.setTargetAtTime(nt.gate[k % nt.gate.length] === 'x' ? 1 : 0.08, t + k * this.step, 0.006);
    gg.connect(dest);
    return gg;
  }

  private tone(inst: Inst, dest: AudioNode, nt: Note, t: number, len: number): void {
    const c = this.ctx;
    const g = c.createGain();
    const end = this.envelope(g, inst, nt.vel * (inst.unison ? 0.6 : 1), t, len);
    g.connect(this.gated(nt, t, dest));
    const f = Math.min(mtof(nt.midi), c.sampleRate * 0.45);
    for (const det of inst.unison ? [-inst.unison, inst.unison] : [0]) {
      const o = c.createOscillator();
      o.type = inst.wave ?? 'sine';
      o.frequency.value = f;
      if (det) o.detune.value = det;
      o.connect(g);
      o.start(t);
      o.stop(end);
    }
  }

  /** Electric piano: a sine carrier, a sine modulator whose brightness fades after the strike. */
  private fm(inst: Inst, dest: AudioNode, nt: Note, t: number, len: number): void {
    const c = this.ctx;
    const f = mtof(nt.midi);
    const g = c.createGain();
    const end = this.envelope(g, inst, nt.vel, t, len);
    g.connect(dest);
    const car = c.createOscillator();
    car.frequency.value = f;
    const mod = c.createOscillator();
    mod.frequency.value = f * (inst.ratio ?? 1);
    const mg = c.createGain();
    const depth = f * (inst.index ?? 1) * (0.5 + 0.7 * nt.vel);
    mg.gain.setValueAtTime(depth, t);
    mg.gain.setTargetAtTime(depth * 0.2, t, 0.3);
    mod.connect(mg);
    mg.connect(car.frequency);
    car.connect(g);
    for (const o of [car, mod]) {
      o.start(t);
      o.stop(end);
    }
  }
}

// ---------------------------------------------------------------- measuring

export interface Level {
  id: string;
  name: string;
  rms: number;
  peak: number;
  notes: number;
}

/** Render `seconds` of a station offline (from the top of the first verse by default) and measure it. */
export async function renderStation(st: StationDef, seconds = 8, startBar = SECTION_BARS, sampleRate = 44100): Promise<Level> {
  const w = globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext };
  const Ctor = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!Ctor) throw new Error('No OfflineAudioContext');
  const ctx = new Ctor(2, Math.ceil(seconds * sampleRate), sampleRate);
  const p = new StationPlayer(ctx, st, ctx.destination);
  p.start(0.02, startBar, 0);
  p.pump(seconds, 0);
  const buf = await ctx.startRendering();
  let sum = 0;
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      sum += d[i] * d[i];
      peak = Math.max(peak, Math.abs(d[i]));
    }
  }
  const rms = Math.sqrt(sum / (buf.length * buf.numberOfChannels));
  p.dispose();
  return { id: st.id, name: st.name, rms, peak, notes: p.notes };
}
