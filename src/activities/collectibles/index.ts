import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Activity } from '../activity';
import type { MapMarker } from '../../ui/map';
import { audio } from '../../core/audio';
import { money } from '../../ui/dom';
import { CHIP_COUNT, CHIP_REWARD, CHIP_SPOTS, MILESTONES, milestoneAt, parseFound, settle, type ChipSpot } from './spots';

/**
 * Lucky Chips: fifty golden casino chips hidden all over the island (back alleys, beaches,
 * piers, under the bridge, mountain tops, the desert, the farms). Each one spins and bobs a
 * little over the ground with a soft glow; run or drive through it to pocket it. Every chip
 * pays, and finding 10, 25 and all 50 pays a lot more. The big map marks the ones you've
 * found, never the ones you haven't.
 *
 * All the chips are one instanced mesh, their glows one point cloud and their sparkles
 * another: three draw calls, and none at all when no chip is anywhere near.
 */

/** Chips are settled on the ground and drawn within this distance (metres). */
const NEAR = 260;
/** ...spun and bobbed within this one (further out they hold still). */
const ANIM = 90;
/** Sparkles round the chips within this distance. */
const SPARKLE_NEAR = 45;
const SPARKS = 4;
/** Pick-up reach on foot and in a car (a car's nose is a couple of metres from its middle). */
const REACH_FOOT = 1.6;
const REACH_CAR = 3.2;
/** How high a chip floats over the ground, and its size. */
const HOVER = 1.05;
const RADIUS = 0.42;
const THICK = 0.09;
/** The pick-up flourish: the chip flies up, spins fast and shrinks away. */
const PICK_TIME = 0.7;

interface Chip {
  spot: ChipSpot;
  /** Where it floats (null until you first come near it and it's settled on the ground). */
  pos: THREE.Vector3 | null;
  found: boolean;
  /** Seconds into the pick-up flourish, or -1. */
  pick: number;
  phase: number;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const GOLD = new THREE.Color(0xffc640);
const SPARK = new THREE.Color(0xfff2c0);

export class Collectibles implements Activity {
  readonly id = 'collectibles';
  private chips: Chip[];
  private built = false;
  private group = new THREE.Group();
  private mesh!: THREE.InstancedMesh;
  private glow!: THREE.Points;
  private sparks!: THREE.Points;
  private t = 0;
  /** Something was drawn last frame (so a frame with nothing near clears it once). */
  private drawn = false;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(readonly game: Game) {
    this.chips = CHIP_SPOTS.map((spot, i) => ({ spot, pos: null, found: false, pick: -1, phase: (i * 2.399) % (Math.PI * 2) }));
  }

  get foundCount(): number {
    let n = 0;
    for (const c of this.chips) if (c.found) n++;
    return n;
  }

  // ---------------------------------------------------------------- building

  private build(): void {
    this.built = true;
    const tex = chipTexture();
    const mat = new THREE.MeshPhongMaterial({ map: tex, emissiveMap: tex, emissive: 0x8a7a5a, shininess: 90, specular: 0xfff0b0 });
    this.mesh = new THREE.InstancedMesh(chipGeometry(), mat, CHIP_COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < CHIP_COUNT; i++) this.mesh.setMatrixAt(i, ZERO);
    this.glow = points(CHIP_COUNT, glowTexture(), 2.8);
    this.sparks = points(CHIP_COUNT * SPARKS, sparkTexture(), 0.55);
    this.group.add(this.mesh, this.glow, this.sparks);
    this.group.visible = false;
    this.game.renderer.scene.add(this.group);
  }

  /** Settle a chip on the ground (or the deck of a pier or the bridge), clear of anything solid. */
  private place(c: Chip): void {
    const w = this.game.world;
    const s = c.spot;
    const ground = (x: number, z: number): number | null => {
      if (s.deck) return w.collision.topFloorAt(x, z);
      const base = w.groundY(x, z, -1e4);
      // The sea, the lake, a cliff face: no good.
      if (base < 0.4) return null;
      if (x < 6150 && w.terrain.slopeAt(x, z) < 0.6) return null;
      // A kerb or a low step up off the ground.
      return w.groundY(x, z, base + 0.4);
    };
    const free = (x: number, y: number, z: number) => !w.collision.blocked(x, z, 0.6, y + 0.1, 1.7);
    const p = settle(s, ground, free);
    c.pos = new THREE.Vector3(p.x, p.y + HOVER, p.z);
  }

  // ---------------------------------------------------------------- picking up

  private collect(c: Chip): void {
    const g = this.game;
    c.found = true;
    c.pick = 0;
    const n = this.foundCount;
    g.stats.luckyChips = n;
    audio.play('coin');
    audio.play('chips', { volume: 0.7 });
    g.hud.toast(`Lucky chip ${n}/${CHIP_COUNT}`, 'good');
    g.addMoney(CHIP_REWARD, 'for a lucky chip');
    const m = milestoneAt(n);
    if (m) {
      const all = n === CHIP_COUNT;
      audio.play(all ? 'jackpot' : 'bigwin');
      g.hud.banner(all ? 'EVERY LUCKY CHIP!' : `${n} LUCKY CHIPS`, all ? `All ${CHIP_COUNT} found · +${money(m.bonus)}` : `${CHIP_COUNT - n} still out there · +${money(m.bonus)} bonus`, 3600, 'gold');
      g.addMoney(m.bonus, all ? 'for every lucky chip on the island' : `for ${n} lucky chips`);
      // After this banner, so the outfit gets its own (load() hands it over if the game closes first).
      const skin = m.skin;
      if (skin) {
        window.setTimeout(() => {
          g.unlockSkin(skin);
          g.save();
        }, 3900);
      }
    }
    g.save();
  }

  // ---------------------------------------------------------------- every frame

  update(dt: number): void {
    const g = this.game;
    if (g.mode === 'loading' || g.mode === 'title') return;
    if (!this.built) this.build();
    this.t += dt;
    const car = g.vehicles.driving;
    const p = car ? car.pos : g.player.pos;
    // Settle the chips you come near (they're far apart: only one or two at a time). Not on the
    // very first frames, so the other activities have put up their piers and props first.
    if (this.t > 0.5) {
      for (const c of this.chips) if (!c.pos && !c.found && Math.abs(c.spot.x - p.x) < NEAR && Math.abs(c.spot.z - p.z) < NEAR) this.place(c);
    }
    if (g.canMove) {
      const reach = car ? REACH_CAR : REACH_FOOT;
      for (const c of this.chips) {
        if (c.found || !c.pos) continue;
        const dy = c.pos.y - p.y;
        if (dy < -1.2 || dy > 2.8) continue;
        if (Math.hypot(c.pos.x - p.x, c.pos.z - p.z) < reach) this.collect(c);
      }
    }
    this.draw(p, g.mode !== 'cutscene', dt);
  }

  private draw(p: THREE.Vector3, show: boolean, dt: number): void {
    const mesh = this.mesh;
    const gp = this.glow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const gc = this.glow.geometry.getAttribute('color') as THREE.BufferAttribute;
    const sp = this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const sc = this.sparks.geometry.getAttribute('color') as THREE.BufferAttribute;
    const night = this.game.world.sky?.night ?? 0;
    const t = this.t;
    let any = false;
    for (let i = 0; i < CHIP_COUNT; i++) {
      const c = this.chips[i];
      if (c.pick >= 0) {
        c.pick += dt;
        if (c.pick >= PICK_TIME) c.pick = -1;
      }
      const d = c.pos ? Math.hypot(c.pos.x - p.x, c.pos.z - p.z) : Infinity;
      const live = show && d < NEAR && (!c.found || c.pick >= 0);
      if (!live || !c.pos) {
        mesh.setMatrixAt(i, ZERO);
        gc.setXYZ(i, 0, 0, 0);
        for (let n = 0; n < SPARKS; n++) sc.setXYZ(i * SPARKS + n, 0, 0, 0);
        continue;
      }
      any = true;
      const moving = d < ANIM || c.pick >= 0;
      const k = c.pick >= 0 ? c.pick / PICK_TIME : 0;
      const bob = moving ? Math.sin(t * 2.2 + c.phase) * 0.12 : 0;
      const spin = moving ? c.phase + t * 2.4 + k * k * 14 : c.phase;
      const y = c.pos.y + bob + k * 1.8;
      this.e.set(Math.sin(t * 1.3 + c.phase) * 0.12, spin, 0, 'YXZ');
      const sz = c.pick >= 0 ? Math.max(0.001, 1 - k * k) : 1;
      this.m.compose(this.v.set(c.pos.x, y, c.pos.z), this.q.setFromEuler(this.e), this.s.set(sz, sz, sz));
      mesh.setMatrixAt(i, this.m);
      // The glow: brighter at night, fading out with distance (it isn't fogged: it adds light).
      const fade = 1 - smooth(110, NEAR, d);
      const pulse = 0.8 + 0.2 * Math.sin(t * 3 + c.phase);
      const glow = (0.6 + 0.4 * night) * pulse * fade * (1 - k);
      gp.setXYZ(i, c.pos.x, y, c.pos.z);
      gc.setXYZ(i, GOLD.r * glow, GOLD.g * glow, GOLD.b * glow);
      // Sparkles winking round the chip; a burst outwards as you pick it up.
      for (let s = 0; s < SPARKS; s++) {
        const j = i * SPARKS + s;
        if (d > SPARKLE_NEAR && c.pick < 0) {
          sc.setXYZ(j, 0, 0, 0);
          continue;
        }
        const a = t * 1.2 + (s * Math.PI * 2) / SPARKS + c.phase;
        const r = 0.6 + k * 1.6 + Math.sin(t * 0.9 + s) * 0.1;
        sp.setXYZ(j, c.pos.x + Math.cos(a) * r, y + Math.sin(t * 2.1 + s * 1.9 + c.phase) * 0.45 + k * 0.6, c.pos.z + Math.sin(a) * r);
        const wink = c.pick >= 0 ? 1 - k : Math.pow(Math.max(0, Math.sin(t * 3.7 + s * 1.7 + c.phase * 3)), 3);
        sc.setXYZ(j, SPARK.r * wink, SPARK.g * wink, SPARK.b * wink);
      }
    }
    this.group.visible = any;
    if (any || this.drawn) {
      mesh.instanceMatrix.needsUpdate = true;
      gp.needsUpdate = gc.needsUpdate = sp.needsUpdate = sc.needsUpdate = true;
    }
    this.drawn = any;
  }

  // ---------------------------------------------------------------- map and saves

  markers(full: boolean): MapMarker[] {
    // The big map only (it asks with full = false too, so check whether it's open).
    if (!full && !this.game.minimap?.big) return [];
    const out: MapMarker[] = [];
    for (const c of this.chips) if (c.found) out.push({ x: c.pos?.x ?? c.spot.x, z: c.pos?.z ?? c.spot.z, icon: '', color: 'rgba(255, 206, 64, 0.5)' });
    return out;
  }

  save(): unknown {
    const found: number[] = [];
    this.chips.forEach((c, i) => c.found && found.push(i));
    return { found };
  }

  load(data: unknown): void {
    const found = new Set(parseFound(data));
    this.chips.forEach((c, i) => {
      c.found = found.has(i);
      c.pick = -1;
    });
    const g = this.game;
    g.stats.luckyChips = found.size;
    // Every milestone outfit you've earned is yours, even if the game closed before it was handed over.
    for (const m of MILESTONES) if (m.skin && found.size >= m.at && !g.ownedSkins.includes(m.skin)) g.ownedSkins.push(m.skin);
  }
}

function smooth(a: number, b: number, x: number): number {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

/** A glowing point cloud (additive, so a dark colour is an invisible point). */
function points(n: number, map: THREE.Texture, size: number): THREE.Points {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.PointsMaterial({ size, map, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 2;
  return pts;
}

/**
 * The chip: a disc standing on its edge (faces along ±z), its faces and rim mapped onto
 * one texture (the face on the left half, the striped rim on the right).
 */
function chipGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, THICK, 36, 1);
  geo.rotateX(Math.PI / 2);
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const nz = nrm.getZ(i);
    if (Math.abs(nz) > 0.5) {
      // A face: seen from its own side, so the back face is mirrored to read the right way round.
      const u = 0.5 + (pos.getX(i) / (2 * RADIUS)) * Math.sign(nz);
      const v = 0.5 + pos.getY(i) / (2 * RADIUS);
      uv.setXY(i, u * 0.5, v);
    } else uv.setX(i, 0.5 + uv.getX(i) * 0.5);
  }
  uv.needsUpdate = true;
  return geo;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** A gold casino chip: cream edge spots, a dotted inlay ring and a red lucky 7. */
function chipTexture(): THREE.CanvasTexture {
  const [cv, g] = canvas(256, 128);
  const cx = 64;
  const cy = 64;
  // The face.
  const rg = g.createRadialGradient(cx - 18, cy - 22, 6, cx, cy, 70);
  rg.addColorStop(0, '#fff0a0');
  rg.addColorStop(0.55, '#f2bf2e');
  rg.addColorStop(1, '#c98d12');
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fff6dc';
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    g.beginPath();
    g.arc(cx, cy, 64, a - 0.2, a + 0.2);
    g.arc(cx, cy, 47, a + 0.2, a - 0.2, true);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = '#9a6a10';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy, 45, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#fff3cf';
  g.beginPath();
  g.arc(cx, cy, 34, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#d9a223';
  for (let k = 0; k < 24; k++) {
    const a = (k * Math.PI) / 12;
    g.beginPath();
    g.arc(cx + Math.cos(a) * 39.5, cy + Math.sin(a) * 39.5, 2, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#c8202f';
  g.font = '900 54px "Lilita One", "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('7', cx + 1, cy + 3);
  // The rim: gold with cream stripes, as on a real chip's edge.
  g.fillStyle = '#e0aa26';
  g.fillRect(128, 0, 128, 128);
  g.fillStyle = '#fff6dc';
  for (let k = 0; k < 8; k++) g.fillRect(128 + k * 16 + 5, 0, 6, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A soft round glow. */
function glowTexture(): THREE.CanvasTexture {
  const [cv, g] = canvas(64, 64);
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.18, 'rgba(255,244,200,0.8)');
  rg.addColorStop(0.5, 'rgba(255,214,110,0.22)');
  rg.addColorStop(1, 'rgba(255,190,60,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

/** A four-pointed twinkle. */
function sparkTexture(): THREE.CanvasTexture {
  const [cv, g] = canvas(32, 32);
  const rg = g.createRadialGradient(16, 16, 0, 16, 16, 7);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 32, 32);
  for (const [w, h] of [[15, 1.4], [1.4, 15]]) {
    const lg = w > h ? g.createLinearGradient(1, 0, 31, 0) : g.createLinearGradient(0, 1, 0, 31);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,1)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.beginPath();
    g.ellipse(16, 16, w, h, 0, 0, Math.PI * 2);
    g.fill();
  }
  return new THREE.CanvasTexture(cv);
}
