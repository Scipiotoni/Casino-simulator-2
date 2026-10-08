import * as THREE from 'three';
import type { Game } from '../game/game';
import { Relay, type RelayPeer } from './relay';
import { CharacterModel } from '../chars/model';
import { Animator, ROLL_TIME, type Pose } from '../chars/anim';
import { appearanceFromSkin, randomAppearance, SKIN_TONES, HAIR_COLORS, type Appearance } from '../chars/skins';
import { Vehicle } from '../vehicles/vehicle';
import { VEHICLES } from '../vehicles/models';
import { labelTexture } from '../render/signs';
import { DOMAIN } from '../world/layout';
import { mulberry32, hashString } from '../core/noise';
import { audio } from '../core/audio';

/**
 * Everyone else on the island. Each player broadcasts a small presence message (name, look,
 * where they are, what they're doing, their car, their last few chat lines) through a public
 * MQTT broker; everyone else draws them where they are, walking or driving, with a name tag.
 * Everything that arrives is untrusted: names and chat are cleaned, numbers clamped, looks
 * checked against the real outfit lists.
 */

export interface ChatLine {
  from: string;
  text: string;
  me?: boolean;
  /** A system line (joined / left / help). */
  system?: boolean;
}

interface Presence {
  v: number;
  n: string;
  a: Appearance;
  x: number;
  y: number;
  z: number;
  h: number;
  p: string;
  s: number;
  /** How far through a dodge roll (0..1), sent with the 'roll' pose. */
  r?: number;
  car: { d: string; c: number; h: number } | null;
  chat: { i: string; t: string }[];
}

class Remote {
  model: CharacterModel;
  anim: Animator;
  car: Vehicle | null = null;
  tag: THREE.Sprite;
  readonly pos = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  yaw = 0;
  targetYaw = 0;
  carYaw = 0;
  look = '';
  name = '';
  seen = new Set<string>();
  fresh = true;
  /** When they dropped out (a short grace before "left the island": reconnects are quiet). */
  goneAt = 0;
  /** The pose they last sent. */
  pose: Pose = 'idle';
  /** Their dodge roll as we play it (0..1, -1 when not rolling) and the phase they last sent (-1: none). */
  roll = -1;
  sentRoll = -1;

  constructor(private scene: THREE.Scene, a: Appearance, name: string) {
    this.model = new CharacterModel(a);
    this.anim = new Animator(this.model);
    this.look = JSON.stringify(a);
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
    this.tag.renderOrder = 8;
    this.setName(name);
    scene.add(this.model.root, this.tag);
  }

  setName(n: string): void {
    if (n === this.name) return;
    this.name = n;
    const m = this.tag.material as THREE.SpriteMaterial;
    m.map?.dispose();
    m.map = labelTexture(n, { width: 512, height: 96, size: 56, color: '#ffffff', bg: 'rgba(0,0,0,0.45)', font: 'Nunito' });
    m.needsUpdate = true;
    this.tag.scale.set(1.6, 0.3, 1);
  }

  setLook(a: Appearance): void {
    const key = JSON.stringify(a);
    if (key === this.look) return;
    this.look = key;
    this.scene.remove(this.model.root);
    this.model.dispose();
    this.model = new CharacterModel(a);
    this.anim = new Animator(this.model);
    this.scene.add(this.model.root);
  }

  dispose(): void {
    this.scene.remove(this.model.root, this.tag);
    this.model.dispose();
    (this.tag.material as THREE.SpriteMaterial).map?.dispose();
    this.tag.material.dispose();
    if (this.car) this.scene.remove(this.car.root);
  }
}

const POSES = new Set<string>(['idle', 'walk', 'run', 'roll', 'fall', 'sit', 'sitTable', 'sitSlot', 'sitCards', 'drive', 'swim', 'ko', 'aimPistol', 'dance', 'dance2', 'dance3', 'wave', 'cheer']);
const CAR_IDS = new Set(VEHICLES.map((v) => v.id));
/** Poses a remote roll carries on through (it's over in a moment anyway). */
const ROLL_INTO = new Set<string>(['roll', 'idle', 'walk', 'run', 'fall']);

/** Keep a chat line or name printable and short. */
export function cleanText(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const num = (v: unknown, lo: number, hi: number, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/** A look from the network: only known options survive, anything else falls back. */
function cleanLook(a: unknown, seed: string): Appearance {
  const base = randomAppearance(mulberry32(hashString(seed)), 'civilian');
  if (!a || typeof a !== 'object') return base;
  const r = a as Record<string, unknown>;
  const skin = typeof r.skinId === 'string' ? r.skinId : '';
  const out: Appearance = skin && skin !== 'custom' ? appearanceFromSkin(skin) : base;
  if (r.body === 'm' || r.body === 'f') out.body = r.body;
  if (SKIN_TONES.includes(r.skin as number)) out.skin = r.skin as number;
  if (HAIR_COLORS.includes(r.hairColor as number)) out.hairColor = r.hairColor as number;
  if (typeof r.hair === 'string' && /^[a-z]{2,12}$/.test(r.hair)) out.hair = r.hair as Appearance['hair'];
  out.height = num(r.height, 0.92, 1.08, 1);
  out.build = num(r.build, 0.9, 1.14, 1);
  return out;
}

export class Multiplayer {
  private relay: Relay | null = null;
  private remotes = new Map<string, Remote>();
  readonly lines: ChatLine[] = [];
  onLine: ((l: ChatLine) => void) | null = null;
  private out: { i: string; t: string; at: number }[] = [];
  private n = 0;
  private sendT = 0;
  /** Send on the next frame whatever happens (a new chat line). */
  private force = false;
  private last = { x: 0, z: 0, h: 0, p: '' };
  connected = false;

  constructor(private game: Game) {}

  /** Connect (in the background); safe to call more than once. */
  start(): void {
    if (this.relay) return;
    let pid = '';
    try {
      pid = localStorage.getItem('cs2.pid') ?? '';
      if (!pid) {
        pid = Math.random().toString(36).slice(2, 10);
        localStorage.setItem('cs2.pid', pid);
      }
    } catch {
      pid = Math.random().toString(36).slice(2, 10);
    }
    this.relay = new Relay(pid);
    this.relay.onStatus = (c) => {
      this.connected = c;
    };
    this.relay.room.onPeers(({ peers }) => this.onPeers(peers));
    // A generous connect timeout: a slow first frame mustn't cause a reconnect (which drops you for others).
    void this.relay.start(25000).catch(() => undefined);
  }

  get online(): number {
    return this.remotes.size + 1;
  }

  names(): string[] {
    return [...this.remotes.values()].map((r) => r.name);
  }

  /** Send a chat line to everyone (it rides along with your presence). */
  say(text: string): void {
    const t = cleanText(text, 120);
    if (!t) return;
    this.out.push({ i: `${Date.now().toString(36)}${(this.n++).toString(36)}`, t, at: Date.now() });
    if (this.out.length > 4) this.out.shift();
    this.push({ from: this.game.playerName, text: t, me: true });
    this.force = true;
  }

  system(text: string): void {
    this.push({ from: '', text, system: true });
  }

  private push(l: ChatLine): void {
    this.lines.push(l);
    if (this.lines.length > 100) this.lines.shift();
    this.onLine?.(l);
  }

  private onPeers(peers: readonly RelayPeer[]): void {
    const g = this.game;
    const alive = new Set<string>();
    for (const p of peers) {
      if (p.isMe) continue;
      const pr = p.presence as Partial<Presence>;
      if (pr.v !== 1) continue;
      alive.add(p.peer);
      const name = cleanText(pr.n, 16) || 'Player';
      let r = this.remotes.get(p.peer);
      if (r) r.goneAt = 0;
      if (!r) {
        r = new Remote(g.renderer.scene, cleanLook(pr.a, p.peer), name);
        this.remotes.set(p.peer, r);
        this.system(`${name} joined the island`);
      } else {
        r.setName(name);
        r.setLook(cleanLook(pr.a, p.peer));
      }
      r.target.set(num(pr.x, DOMAIN.minX, DOMAIN.maxX + 3000), num(pr.y, -20, 2000), num(pr.z, DOMAIN.minZ, DOMAIN.maxZ));
      r.targetYaw = num(pr.h, -10, 10);
      const pose = (typeof pr.p === 'string' && POSES.has(pr.p) ? pr.p : 'idle') as Pose;
      r.pose = pose;
      r.anim.speed = num(pr.s, 0, 60);
      // A roll plays out here on its own clock from the phase they sent; a new one starts when
      // the phase jumps back (or the last message wasn't a roll).
      if (pose === 'roll') {
        const ph = num(pr.r, 0, 1);
        if (r.sentRoll < 0 || ph < r.sentRoll - 0.05) {
          r.roll = ph;
          audio.playAt('whoosh', r.target.x, r.target.z, 0.7);
        }
        r.sentRoll = ph;
      } else r.sentRoll = -1;
      // Their car, if they're driving.
      const car = pr.car && typeof pr.car === 'object' && CAR_IDS.has(pr.car.d) ? pr.car : null;
      if (car && (!r.car || r.car.def.id !== car.d)) {
        if (r.car) g.renderer.scene.remove(r.car.root);
        r.car = new Vehicle(car.d, num(car.c, 0, 0xffffff, 0xffffff) | 0, `remote-${p.peer}`);
        r.car.scripted = true;
        g.renderer.scene.add(r.car.root);
      } else if (!car && r.car) {
        g.renderer.scene.remove(r.car.root);
        r.car = null;
      }
      if (r.car && car) r.carYaw = num(car.h, -10, 10);
      if (r.fresh) {
        r.pos.copy(r.target);
        r.yaw = r.targetYaw;
        r.fresh = false;
      }
      // New chat lines (each has an id; the first batch we see is history, so skip it).
      const list = Array.isArray(pr.chat) ? pr.chat.slice(-6) : [];
      const first = r.seen.size === 0 && list.length > 0 && !r.seen.has('*');
      for (const m of list) {
        const id = cleanText(m?.i, 24);
        const text = cleanText(m?.t, 120);
        if (!id || !text || r.seen.has(id)) continue;
        r.seen.add(id);
        if (!first) this.push({ from: name, text });
      }
      r.seen.add('*');
      if (r.seen.size > 60) r.seen = new Set([...r.seen].slice(-20));
    }
    for (const [k, r] of this.remotes) if (!alive.has(k) && !r.goneAt) r.goneAt = performance.now();
  }

  update(dt: number): void {
    const g = this.game;
    if (!this.relay) return;
    // Your presence: often while moving, a heartbeat otherwise (the relay rate-limits too).
    this.sendT -= dt;
    const v = g.vehicles.driving;
    const p = g.player;
    const x = v ? v.pos.x : p.pos.x;
    const z = v ? v.pos.z : p.pos.z;
    const pose = v ? 'drive' : p.anim.pose;
    const moved = Math.hypot(x - this.last.x, z - this.last.z) > 0.3 || Math.abs(p.yaw - this.last.h) > 0.08 || pose !== this.last.p;
    if ((moved && this.sendT <= 0) || this.sendT < -2 || this.force) {
      this.force = false;
      this.sendT = 0.12;
      this.last = { x, z, h: p.yaw, p: pose };
      const pr: Presence = {
        v: 1,
        n: g.playerName,
        a: g.appearance,
        x: Math.round(x * 10) / 10,
        y: Math.round((v ? v.pos.y : p.pos.y) * 10) / 10,
        z: Math.round(z * 10) / 10,
        h: Math.round(p.yaw * 100) / 100,
        p: pose,
        s: Math.round(Math.hypot(p.vel.x, p.vel.z) * 10) / 10,
        ...(pose === 'roll' ? { r: Math.round(p.rollPhase * 100) / 100 } : {}),
        car: v ? { d: v.def.id, c: v.color, h: Math.round(v.heading * 100) / 100 } : null,
        chat: this.out.filter((m) => Date.now() - m.at < 120_000).map((m) => ({ i: m.i, t: m.t })),
      };
      void this.relay.room.presence(pr as unknown as Record<string, unknown>);
    }
    // Players who dropped out and didn't come back within a few seconds have left.
    const now = performance.now();
    for (const [k, r] of this.remotes) {
      if (!r.goneAt || now - r.goneAt < 6000) continue;
      this.system(`${r.name} left the island`);
      r.dispose();
      this.remotes.delete(k);
    }
    // Everyone else: glide towards their latest position.
    const cam = g.renderer.camera.position;
    const k = 1 - Math.exp(-dt * 8);
    for (const r of this.remotes.values()) {
      r.pos.lerp(r.target, k);
      let dy = r.targetYaw - r.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      r.yaw += dy * k;
      const d = r.pos.distanceTo(cam);
      if (r.car) {
        let dc = r.carYaw - r.car.heading;
        while (dc > Math.PI) dc -= Math.PI * 2;
        while (dc < -Math.PI) dc += Math.PI * 2;
        r.car.heading += dc * k;
        r.car.pos.copy(r.pos);
        r.car.sync(dt, g.world);
        const seat = r.car.seatWorld(0, new THREE.Vector3());
        r.model.root.position.set(seat.x, seat.y - 0.2, seat.z);
        r.model.root.rotation.y = r.car.heading;
        r.car.root.visible = d < 900;
      } else {
        r.model.root.position.copy(r.pos);
        r.model.root.rotation.y = r.yaw;
      }
      // Their roll runs to the end even if a message moves on; anything but moving about cuts it.
      if (r.roll >= 0) {
        r.roll += dt / ROLL_TIME;
        if (r.roll >= 1 || r.car || !ROLL_INTO.has(r.pose)) r.roll = -1;
      }
      r.anim.pose = r.roll >= 0 ? 'roll' : r.pose === 'roll' ? 'idle' : r.pose;
      r.anim.action = Math.max(0, r.roll);
      r.model.updateLod(d);
      if (r.model.lod < 2) r.anim.update(dt);
      r.tag.position.set(r.model.root.position.x, r.model.root.position.y + 2.15, r.model.root.position.z);
      r.tag.visible = d < 120;
    }
  }
}
