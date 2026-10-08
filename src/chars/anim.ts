import type { BoneName, CharacterModel } from './model';

/**
 * Procedural animation: every pose is a small function of time that returns bone angles.
 * Walk and run cycles are driven by the distance actually covered (no foot sliding), and
 * everything blends smoothly from one pose to the next.
 */

export type Pose =
  | 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'sit' | 'sitTable' | 'sitSlot' | 'sitCards' | 'drive' | 'deal' | 'dealCards'
  | 'aimPistol' | 'aimRifle' | 'cheer' | 'clap' | 'wave' | 'dance' | 'dance2' | 'dance3' | 'talk' | 'point' | 'phone'
  | 'shrug' | 'facepalm' | 'sad' | 'angry' | 'ko' | 'swim' | 'crouch' | 'think' | 'handsUp' | 'drink' | 'lean' | 'sweep'
  | 'salute' | 'lay' | 'pushButton' | 'pullLever' | 'rollDice' | 'spinWheel' | 'bow' | 'sleep' | 'punch' | 'kneel';

type Rot = [number, number, number];
type Targets = Partial<Record<BoneName, Rot>> & { hipsY?: number; hipsZ?: number; hipsX?: number };

const BONE_LIST: BoneName[] = [
  'hips', 'spine', 'chest', 'neck', 'head', 'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
];

const UPPER: BoneName[] = ['chest', 'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR'];

const S = Math.sin;
const C = Math.cos;

/** Arms hanging naturally, slightly out from the body. */
function relaxed(t: Targets, k = 1): void {
  t.upperArmL = [0.05, 0, 0.1 * k];
  t.upperArmR = [0.05, 0, -0.1 * k];
  t.foreArmL = [-0.15, 0, 0];
  t.foreArmR = [-0.15, 0, 0];
}

function sitBase(t: Targets): void {
  t.thighL = [-1.52, 0.06, 0.04];
  t.thighR = [-1.52, -0.06, -0.04];
  t.shinL = [1.45, 0, 0];
  t.shinR = [1.45, 0, 0];
  t.footL = [0.08, 0, 0];
  t.footR = [0.08, 0, 0];
  t.hipsY = -0.44;
  t.hipsZ = -0.04;
}

export class Animator {
  pose: Pose = 'idle';
  /** Horizontal speed in m/s (drives walk/run). */
  speed = 0;
  /** Up-down look for aiming and head turns (radians, + = up). */
  lookPitch = 0;
  lookYaw = 0;
  /** 0..1 progress of one-shot actions (deal, lever, roll) driven by the owner. */
  action = 0;
  private phase = 0;
  private t = Math.random() * 10;
  private cur = new Map<BoneName, Rot>();
  private hips = { x: 0, y: 0, z: 0 };
  /** How quickly poses blend (higher = snappier). */
  blend = 12;
  /** An upper-body pose layered over walking and running (aiming a gun). */
  upper: Pose | null = null;

  constructor(private model: CharacterModel) {
    for (const b of BONE_LIST) this.cur.set(b, [0, 0, 0]);
  }

  update(dt: number): void {
    this.t += dt;
    const tg: Targets = {};
    const sp = this.speed;
    const t = this.t;
    let locomote = this.pose === 'idle' || this.pose === 'walk' || this.pose === 'run';
    if (locomote) {
      // Stride length grows with speed; phase advances with distance.
      const stride = sp > 4 ? 2.4 : 1.45;
      this.phase += (sp * dt * Math.PI * 2) / stride;
      if (sp < 0.15) {
        this.idle(tg, t);
      } else if (sp < 4.2) {
        this.walk(tg, Math.min(1, sp / 1.6));
      } else {
        this.run(tg, Math.min(1.25, sp / 6.5));
      }
    } else {
      this.posed(tg, t);
      locomote = false;
    }
    if (this.upper && locomote) {
      const up: Targets = {};
      const was = this.pose;
      this.pose = this.upper;
      this.posed(up, t);
      this.pose = was;
      for (const b of UPPER) if (up[b]) tg[b] = up[b];
      if (sp > 0.15) tg.spine = [(tg.spine?.[0] ?? 0) * 0.3, 0.1, 0];
    }
    // Look: spread the head turn over neck and chest.
    const ly = this.lookYaw;
    const lp = this.lookPitch;
    const head = tg.head ?? [0, 0, 0];
    const neck = tg.neck ?? [0, 0, 0];
    tg.head = [head[0] - lp * 0.5, head[1] + ly * 0.5, head[2]];
    tg.neck = [neck[0] - lp * 0.3, neck[1] + ly * 0.3, neck[2]];
    if (this.pose === 'aimPistol' || this.pose === 'aimRifle' || (locomote && (this.upper === 'aimPistol' || this.upper === 'aimRifle'))) {
      const ch = tg.chest ?? [0, 0, 0];
      tg.chest = [ch[0] - lp * 0.45, ch[1], ch[2]];
    }
    // Blend towards the targets.
    const k = 1 - Math.exp(-this.blend * dt);
    const bones = this.model.bones;
    for (const b of BONE_LIST) {
      const target = tg[b] ?? [0, 0, 0];
      const c = this.cur.get(b)!;
      c[0] += (target[0] - c[0]) * k;
      c[1] += (target[1] - c[1]) * k;
      c[2] += (target[2] - c[2]) * k;
      bones[b].rotation.set(c[0], c[1], c[2]);
    }
    const r = this.model.rest.hips;
    const pr = this.model.rest.root;
    this.hips.x += ((tg.hipsX ?? 0) - this.hips.x) * k;
    this.hips.y += ((tg.hipsY ?? 0) - this.hips.y) * k;
    this.hips.z += ((tg.hipsZ ?? 0) - this.hips.z) * k;
    bones.hips.position.set(r[0] - pr[0] + this.hips.x, r[1] - pr[1] + this.hips.y, r[2] - pr[2] + this.hips.z);
    this.model.updateFace(dt);
  }

  /** Snap straight to the target pose (no blend), e.g. when sitting down instantly. */
  snap(): void {
    const b = this.blend;
    this.blend = 1000;
    this.update(0.016);
    this.blend = b;
  }

  private idle(t: Targets, time: number): void {
    const br = S(time * 1.6) * 0.025;
    t.spine = [br * 0.5, 0, S(time * 0.5) * 0.02];
    t.chest = [-br, 0, 0];
    t.head = [S(time * 0.7) * 0.03, S(time * 0.35) * 0.12, 0];
    relaxed(t);
    t.upperArmL = [0.05 + br, 0, 0.1 + br];
    t.upperArmR = [0.05 + br, 0, -0.1 - br];
    t.thighL = [0, 0, 0.03];
    t.thighR = [0, 0, -0.03];
    t.hipsY = S(time * 1.6) * 0.004;
  }

  private walk(t: Targets, a: number): void {
    const p = this.phase;
    const sw = 0.5 * a;
    t.thighL = [-S(p) * sw, 0, 0.02];
    t.thighR = [S(p) * sw, 0, -0.02];
    t.shinL = [Math.max(0, -C(p)) * 0.75 * a + 0.05, 0, 0];
    t.shinR = [Math.max(0, C(p)) * 0.75 * a + 0.05, 0, 0];
    t.footL = [S(p) * 0.2 * a, 0, 0];
    t.footR = [-S(p) * 0.2 * a, 0, 0];
    t.upperArmL = [S(p) * 0.45 * a, 0, 0.1];
    t.upperArmR = [-S(p) * 0.45 * a, 0, -0.1];
    t.foreArmL = [-0.25 - Math.max(0, S(p)) * 0.3 * a, 0, 0];
    t.foreArmR = [-0.25 - Math.max(0, -S(p)) * 0.3 * a, 0, 0];
    t.spine = [0.03 * a, S(p) * 0.08 * a, 0];
    t.chest = [0, -S(p) * 0.1 * a, 0];
    t.head = [0, S(p) * 0.05 * a, 0];
    t.hipsY = -Math.abs(C(p)) * 0.035 * a + 0.01;
  }

  private run(t: Targets, a: number): void {
    const p = this.phase;
    t.thighL = [-S(p) * 0.85 * a - 0.15, 0, 0.02];
    t.thighR = [S(p) * 0.85 * a - 0.15, 0, -0.02];
    t.shinL = [Math.max(0, -C(p)) * 1.5 * a + 0.25, 0, 0];
    t.shinR = [Math.max(0, C(p)) * 1.5 * a + 0.25, 0, 0];
    t.footL = [S(p) * 0.3, 0, 0];
    t.footR = [-S(p) * 0.3, 0, 0];
    t.upperArmL = [S(p) * 0.85 * a, 0, 0.16];
    t.upperArmR = [-S(p) * 0.85 * a, 0, -0.16];
    t.foreArmL = [-1.3, 0, 0];
    t.foreArmR = [-1.3, 0, 0];
    t.spine = [0.22 * a, S(p) * 0.12, 0];
    t.chest = [0.05, -S(p) * 0.18, 0];
    t.head = [-0.15 * a, S(p) * 0.06, 0];
    t.hipsY = -Math.abs(C(p)) * 0.07 * a + 0.02;
  }

  private posed(t: Targets, time: number): void {
    const a = this.action;
    switch (this.pose) {
      case 'jump':
        t.thighL = [-0.9, 0, 0.05];
        t.thighR = [-0.2, 0, -0.05];
        t.shinL = [1.3, 0, 0];
        t.shinR = [0.6, 0, 0];
        t.upperArmL = [-0.6, 0, 0.6];
        t.upperArmR = [-0.4, 0, -0.6];
        t.foreArmL = [-0.8, 0, 0];
        t.foreArmR = [-0.8, 0, 0];
        t.spine = [0.1, 0, 0];
        break;
      case 'fall':
        t.thighL = [-0.5, 0, 0.1];
        t.thighR = [-0.2, 0, -0.1];
        t.shinL = [0.8, 0, 0];
        t.shinR = [0.5, 0, 0];
        t.upperArmL = [-0.3, 0, 1.1 + S(time * 8) * 0.15];
        t.upperArmR = [-0.3, 0, -1.1 - S(time * 8) * 0.15];
        t.foreArmL = [-0.4, 0, 0];
        t.foreArmR = [-0.4, 0, 0];
        break;
      case 'sit':
        sitBase(t);
        relaxed(t, 0.5);
        t.upperArmL = [-0.35, 0, 0.12];
        t.upperArmR = [-0.35, 0, -0.12];
        t.foreArmL = [-0.9, 0, 0];
        t.foreArmR = [-0.9, 0, 0];
        t.head = [S(time * 0.5) * 0.04, S(time * 0.3) * 0.15, 0];
        t.chest = [S(time * 1.5) * 0.02, 0, 0];
        break;
      case 'sitTable':
      case 'sitCards':
        sitBase(t);
        t.spine = [0.12, 0, 0];
        t.chest = [0.05 + S(time * 1.5) * 0.015, 0, 0];
        t.upperArmL = [-0.55, 0.1, 0.18];
        t.upperArmR = [-0.55, -0.1, -0.18];
        t.foreArmL = [-1.0, 0.3, 0];
        t.foreArmR = [-1.0, -0.3, 0];
        t.handL = [0, 0, 0.2];
        t.handR = [0, 0, -0.2];
        if (this.pose === 'sitCards') {
          t.foreArmL = [-1.25, 0.5, 0];
          t.foreArmR = [-1.25, -0.5, 0];
          t.handL = [-0.4, 0, 0.5];
          t.handR = [-0.4, 0, -0.5];
        }
        t.head = [0.25, S(time * 0.4) * 0.1, 0];
        break;
      case 'sitSlot':
        sitBase(t);
        t.spine = [0.1, 0, 0];
        t.upperArmL = [-0.3, 0, 0.12];
        t.foreArmL = [-1.3, 0, 0];
        t.upperArmR = [-0.75 - a * 0.25, -0.1, -0.15];
        t.foreArmR = [-0.8 + a * 0.3, 0, 0];
        t.head = [0.05, 0, 0];
        break;
      case 'drive':
        sitBase(t);
        t.thighL = [-1.35, 0, 0.06];
        t.thighR = [-1.35, 0, -0.06];
        t.shinL = [1.0, 0, 0];
        t.shinR = [1.0, 0, 0];
        t.upperArmL = [-0.95, 0, 0.25 + this.lookYaw * 0.3];
        t.upperArmR = [-0.95, 0, -0.25 + this.lookYaw * 0.3];
        t.foreArmL = [-0.55, 0, 0];
        t.foreArmR = [-0.55, 0, 0];
        t.spine = [-0.08, 0, 0];
        break;
      case 'deal':
      case 'dealCards': {
        // Dealer at the table: hands forward over the felt, pitching and sweeping.
        const w = S(time * (this.pose === 'dealCards' ? 7 : 2.5));
        t.spine = [0.1, 0, 0];
        t.upperArmL = [-0.55, 0.15, 0.25];
        t.foreArmL = [-0.9, 0, 0];
        t.upperArmR = [-0.75 + w * 0.15 * (a > 0 ? 1 : 0.3), -0.2 + w * 0.2, -0.2];
        t.foreArmR = [-0.7, 0, 0];
        t.handR = [0, 0, -0.3];
        t.head = [0.25, w * 0.08, 0];
        break;
      }
      case 'aimPistol':
        t.upperArmR = [-1.5, 0.15, -0.1];
        t.foreArmR = [-0.1, 0, 0];
        t.upperArmL = [-1.4, -0.4, 0.15];
        t.foreArmL = [-0.35, 0, 0];
        t.handR = [0, 0, 0];
        t.spine = [0, 0.1, 0];
        relaxedLegs(t);
        break;
      case 'aimRifle':
        t.upperArmR = [-1.15, 0.45, -0.5];
        t.foreArmR = [-1.3, 0, 0];
        t.upperArmL = [-1.45, -0.25, 0.2];
        t.foreArmL = [-0.35, 0, 0];
        t.chest = [0, 0.15, 0];
        relaxedLegs(t);
        break;
      case 'cheer':
        t.upperArmL = [-0.2, 0, 2.6 + S(time * 9) * 0.2];
        t.upperArmR = [-0.2, 0, -2.6 - S(time * 9) * 0.2];
        t.foreArmL = [-0.3, 0, 0];
        t.foreArmR = [-0.3, 0, 0];
        t.hipsY = Math.abs(S(time * 9)) * 0.08;
        t.head = [-0.2, 0, 0];
        break;
      case 'clap': {
        const c = Math.abs(S(time * 10));
        t.upperArmL = [-0.9, -0.3 * c, 0.3];
        t.upperArmR = [-0.9, 0.3 * c, -0.3];
        t.foreArmL = [-0.9, -0.3, 0];
        t.foreArmR = [-0.9, 0.3, 0];
        break;
      }
      case 'wave':
        relaxed(t);
        t.upperArmR = [0, 0, -2.5];
        t.foreArmR = [0, 0, -0.4 + S(time * 9) * 0.45];
        t.head = [0, -0.1, 0.1];
        break;
      case 'dance': {
        const b = S(time * 7);
        t.hipsY = Math.abs(b) * 0.06 - 0.04;
        t.hipsX = b * 0.04;
        t.spine = [0, b * 0.2, b * 0.1];
        t.upperArmL = [-0.5 + b * 0.4, 0, 0.8];
        t.upperArmR = [-0.5 - b * 0.4, 0, -0.8];
        t.foreArmL = [-1.2, 0, 0];
        t.foreArmR = [-1.2, 0, 0];
        t.thighL = [-0.2 - Math.max(0, b) * 0.4, 0, 0.1];
        t.thighR = [-0.2 - Math.max(0, -b) * 0.4, 0, -0.1];
        t.shinL = [0.4 + Math.max(0, b) * 0.6, 0, 0];
        t.shinR = [0.4 + Math.max(0, -b) * 0.6, 0, 0];
        t.head = [0, b * 0.2, 0];
        break;
      }
      case 'dance2': {
        // The floss-alike: arms swing side to side behind and in front.
        const b = S(time * 9);
        t.hipsX = -b * 0.05;
        t.spine = [0, 0, b * 0.15];
        t.upperArmL = [b * 0.5, 0, 0.35 - b * 0.25];
        t.upperArmR = [-b * 0.5, 0, -0.35 - b * 0.25];
        t.foreArmL = [0, 0, 0];
        t.foreArmR = [0, 0, 0];
        t.thighL = [0, 0, 0.08 + b * 0.05];
        t.thighR = [0, 0, -0.08 + b * 0.05];
        break;
      }
      case 'dance3': {
        // Disco point.
        const b = S(time * 5);
        t.hipsX = b * 0.06;
        t.upperArmR = b > 0 ? [-0.2, 0, -2.4] : [0.5, 0, -0.5];
        t.foreArmR = [0, 0, 0];
        t.upperArmL = [0.1, 0, 0.4];
        t.foreArmL = [-1.4, 0, 0];
        t.spine = [0, 0, b * 0.12];
        t.thighL = [-Math.max(0, b) * 0.5, 0, 0.1];
        t.shinL = [Math.max(0, b) * 0.8, 0, 0];
        t.head = [b * 0.1, b * 0.3, 0];
        break;
      }
      case 'talk': {
        const g = S(time * 3.2);
        relaxed(t);
        t.upperArmR = [-0.5 + g * 0.15, 0, -0.25];
        t.foreArmR = [-0.9 - g * 0.2, -0.4, 0];
        t.upperArmL = [-0.2 - g * 0.1, 0, 0.18];
        t.foreArmL = [-0.6, 0.3, 0];
        t.head = [S(time * 2.1) * 0.06, S(time * 1.1) * 0.15, 0];
        break;
      }
      case 'point':
        relaxed(t);
        t.upperArmR = [-1.5, 0.2, -0.1];
        t.foreArmR = [-0.05, 0, 0];
        break;
      case 'phone':
        relaxed(t);
        t.upperArmR = [-0.6, 0, -0.3];
        t.foreArmR = [-2.0, 0.6, 0];
        t.head = [0.05, -0.2, 0.1];
        break;
      case 'shrug':
        t.upperArmL = [-0.2, 0, 0.5];
        t.upperArmR = [-0.2, 0, -0.5];
        t.foreArmL = [-1.2, 0.8, 0];
        t.foreArmR = [-1.2, -0.8, 0];
        t.chest = [0, 0, 0];
        t.head = [0.1, 0, 0.2];
        break;
      case 'facepalm':
        relaxed(t);
        t.upperArmR = [-1.2, 0.3, -0.1];
        t.foreArmR = [-2.0, 0.4, 0];
        t.head = [0.45, 0, 0];
        t.spine = [0.15, 0, 0];
        break;
      case 'sad':
        relaxed(t, 0.6);
        t.spine = [0.2, 0, 0];
        t.head = [0.5, 0, 0];
        t.hipsY = -0.02;
        break;
      case 'angry': {
        const g = S(time * 8);
        t.upperArmL = [-0.6, 0, 0.3];
        t.upperArmR = [-0.6 + g * 0.3, 0, -0.3];
        t.foreArmL = [-1.6, 0, 0];
        t.foreArmR = [-1.6, 0, 0];
        t.spine = [0.1, 0, 0];
        t.head = [0.1, g * 0.05, 0];
        break;
      }
      case 'ko':
      case 'lay':
      case 'sleep':
        t.hipsY = -0.82;
        t.hips = [-1.55, 0, 0];
        t.upperArmL = [0, 0, 0.9];
        t.upperArmR = [0, 0, -0.9];
        t.foreArmL = [-0.4, 0, 0];
        t.foreArmR = [-0.2, 0, 0];
        t.thighL = [0, 0, 0.12];
        t.shinR = [0.3, 0, 0];
        t.head = [0, 0.4, 0];
        break;
      case 'swim': {
        const p = time * 4;
        t.hips = [-1.2, 0, 0];
        t.hipsY = -0.6;
        t.upperArmL = [S(p) * 2.5 - 1.2, 0, 0.3];
        t.upperArmR = [-S(p) * 2.5 - 1.2, 0, -0.3];
        t.thighL = [S(p * 2) * 0.3, 0, 0];
        t.thighR = [-S(p * 2) * 0.3, 0, 0];
        t.head = [-0.9, 0, 0];
        break;
      }
      case 'crouch':
        t.hipsY = -0.38;
        t.thighL = [-1.4, 0, 0.15];
        t.thighR = [-1.0, 0, -0.15];
        t.shinL = [1.9, 0, 0];
        t.shinR = [1.6, 0, 0];
        t.spine = [0.4, 0, 0];
        t.head = [-0.3, 0, 0];
        relaxed(t);
        break;
      case 'kneel':
        t.hipsY = -0.45;
        t.thighL = [-1.5, 0, 0.1];
        t.shinL = [1.5, 0, 0];
        t.thighR = [-0.1, 0, -0.1];
        t.shinR = [1.6, 0, 0];
        relaxed(t);
        break;
      case 'think':
        relaxed(t);
        t.upperArmR = [-0.8, 0.2, -0.2];
        t.foreArmR = [-2.1, 0.3, 0];
        t.upperArmL = [-0.6, -0.4, 0.2];
        t.foreArmL = [-1.4, 0.6, 0];
        t.head = [0.1, 0.1, 0.15];
        break;
      case 'handsUp':
        t.upperArmL = [0, 0, 2.7];
        t.upperArmR = [0, 0, -2.7];
        t.foreArmL = [-0.2, 0, 0];
        t.foreArmR = [-0.2, 0, 0];
        break;
      case 'drink':
        relaxed(t);
        t.upperArmR = [-0.9 - a * 0.4, 0, -0.2];
        t.foreArmR = [-1.6 - a * 0.4, 0.3, 0];
        t.head = [-a * 0.4, 0, 0];
        break;
      case 'lean':
        relaxed(t);
        t.spine = [0, 0, 0.12];
        t.thighL = [0, 0, 0.12];
        t.thighR = [-0.2, 0.3, -0.25];
        t.shinR = [0.3, 0, 0];
        t.upperArmL = [0.2, 0, 0.2];
        t.upperArmR = [0.3, 0, -0.35];
        t.foreArmR = [-0.6, 0, 0];
        break;
      case 'sweep': {
        const g = S(time * 4);
        t.spine = [0.25, g * 0.2, 0];
        t.upperArmL = [-0.9, 0.2, 0.2];
        t.upperArmR = [-0.7, -0.2, -0.2];
        t.foreArmL = [-0.6, 0, 0];
        t.foreArmR = [-0.6, 0, 0];
        break;
      }
      case 'salute':
        relaxed(t);
        t.upperArmR = [-0.4, 0, -1.6];
        t.foreArmR = [-2.2, -1.0, 0];
        break;
      case 'pushButton':
        relaxed(t);
        t.upperArmR = [-1.1 - a * 0.2, 0, -0.1];
        t.foreArmR = [-0.4 + a * 0.3, 0, 0];
        break;
      case 'pullLever':
        sitBase(t);
        t.upperArmR = [-1.6 + a * 1.1, 0, -0.45];
        t.foreArmR = [-0.4, 0, 0];
        t.upperArmL = [-0.3, 0, 0.12];
        t.foreArmL = [-1.3, 0, 0];
        break;
      case 'rollDice': {
        relaxed(t);
        const p = Math.min(1, a);
        t.spine = [0.2, 0, 0];
        t.upperArmR = [-0.2 - p * 1.3, 0, -0.2];
        t.foreArmR = [-1.5 + p * 1.3, 0, 0];
        t.handR = [-0.5 + p * 1.2, 0, 0];
        break;
      }
      case 'spinWheel':
        relaxed(t);
        t.upperArmR = [-1.4, 0, -0.5 + a * 0.6];
        t.foreArmR = [-0.4, 0, 0];
        break;
      case 'bow':
        relaxed(t);
        t.spine = [0.6, 0, 0];
        t.head = [0.3, 0, 0];
        t.upperArmR = [-0.6, 0, -0.1];
        t.foreArmR = [-1.4, 0.8, 0];
        break;
      case 'punch': {
        const p = a < 0.5 ? a * 2 : (1 - a) * 2;
        t.upperArmL = [-0.9, 0, 0.3];
        t.foreArmL = [-1.8, 0, 0];
        t.upperArmR = [-0.9 - p * 0.65, 0.2, -0.3 + p * 0.25];
        t.foreArmR = [-1.8 + p * 1.7, 0, 0];
        t.chest = [0, -0.3 * p, 0];
        relaxedLegs(t);
        break;
      }
      default:
        this.idle(t, time);
    }
  }
}

function relaxedLegs(t: Targets): void {
  t.thighL = [-0.1, 0, 0.08];
  t.thighR = [0.1, 0, -0.08];
  t.shinL = [0.15, 0, 0];
  t.shinR = [0.1, 0, 0];
}
