import type { Terrain } from '../world/terrain';
import { CELL } from '../world/terrain';
import { DOMAIN, LANDMARKS, CITY, allRoads, cityBlocks } from '../world/layout';
import { BRIDGE } from '../world/bridge';
import type { Game } from '../game/game';
import { el } from './dom';
import { audio } from '../core/audio';

/**
 * The island map, drawn the way the first game draws its city map: a dark panel in the
 * corner with a gold title and small buttons, shaded relief, dark roads, place names with
 * an emoji, your gold arrow, and a map that turns with the camera (or stays north up).
 * The ⤢ button (or M) opens it big in the middle of the screen: drag to look around,
 * scroll to zoom, click anywhere to set a waypoint.
 */

export interface MapMarker {
  x: number;
  z: number;
  /** Emoji or a single letter. */
  icon: string;
  color: string;
  label?: string;
  /** Drawn bigger and always on top. */
  big?: boolean;
}

const PX = 4; // terrain cells per base-image pixel

/** Shaded relief of the whole island, painted once from the heightfield. */
export class IslandMap {
  readonly base: HTMLCanvasElement;
  readonly w: number;
  readonly h: number;

  constructor(t: Terrain) {
    this.w = Math.floor(t.nx / PX);
    this.h = Math.floor(t.nz / PX);
    this.base = document.createElement('canvas');
    this.base.width = this.w;
    this.base.height = this.h;
    const g = this.base.getContext('2d')!;
    const img = g.createImageData(this.w, this.h);
    const d = img.data;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const cx = x * PX;
        const cz = y * PX;
        const hh = t.heights[cz * t.nx + cx];
        const he = t.heights[cz * t.nx + Math.min(t.nx - 1, cx + 2)];
        const hs = t.heights[Math.min(t.nz - 1, cz + 2) * t.nx + cx];
        // Light from the north-west, like a relief map.
        const shade = Math.max(0.62, Math.min(1.3, 1 + (hh - he) * 0.035 + (hh - hs) * 0.035));
        const s = t.surface[cz * t.nx + cx];
        const wz = DOMAIN.minZ + cz * CELL;
        let r: number, gg: number, b: number;
        if (hh < 0) {
          const k = Math.min(1, -hh / 60);
          r = 42 - 22 * k;
          gg = 143 - 70 * k;
          b = 196 - 60 * k;
        } else if (hh < 2.5) {
          r = 232; gg = 211; b = 156;
        } else if (s === 3) {
          r = 168; gg = 132; b = 92;
        } else if (hh > 520) {
          r = 228; gg = 226; b = 232;
        } else if (hh > 260) {
          r = 132 + (hh - 260) * 0.15; gg = 112 + (hh - 260) * 0.1; b = 98;
        } else {
          // Green in the south, dry tan in the north county.
          const dry = Math.max(0, Math.min(1, (-wz - 2600) / 1600));
          r = (74 + hh * 0.1) * (1 - dry) + 176 * dry;
          gg = (130 - hh * 0.05) * (1 - dry) + 146 * dry;
          b = 70 * (1 - dry) + 96 * dry;
        }
        const i = (y * this.w + x) * 4;
        d[i] = Math.min(255, r * shade);
        d[i + 1] = Math.min(255, gg * shade);
        d[i + 2] = Math.min(255, b * shade);
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  /** World metres per base-image pixel. */
  get scale(): number {
    return CELL * PX;
  }
}

interface Place {
  x: number;
  z: number;
  text: string;
  /** Minimum map scale (px per metre) at which the label shows. */
  min: number;
}

const PLACES: Place[] = [
  { x: (CITY.minX + CITY.maxX) / 2, z: (CITY.minZ + CITY.maxZ) / 2, text: '🏙 FORTUNA CITY', min: 0 },
  { x: LANDMARKS.volcano.x, z: LANDMARKS.volcano.z, text: '🌋 MOUNT FORTUNA', min: 0 },
  { x: LANDMARKS.mountain.x, z: LANDMARKS.mountain.z, text: '🏔 MOUNT THUNDERHEAD', min: 0 },
  { x: LANDMARKS.lake.x, z: LANDMARKS.lake.z, text: '🌊 ALKALI LAKE', min: 0 },
  { x: LANDMARKS.desertTown.x, z: LANDMARKS.desertTown.z, text: '🌵 DUSTWATER', min: 0 },
  { x: LANDMARKS.northTown.x, z: LANDMARKS.northTown.z, text: '🎣 HALIBUT BAY', min: 0 },
  { x: LANDMARKS.farms.x, z: LANDMARKS.farms.z, text: '🌾 HARVEST VALLEY', min: 0.05 },
  { x: LANDMARKS.windFarm.x, z: LANDMARKS.windFarm.z, text: '💨 WIND FARM', min: 0.05 },
  { x: LANDMARKS.base.x, z: LANDMARKS.base.z, text: '✈ FORT HAMMERHEAD', min: 0 },
  { x: LANDMARKS.oldTown.x, z: LANDMARKS.oldTown.z, text: '⚓ CORAL COVE', min: 0 },
  { x: LANDMARKS.sunsetBeach.x, z: LANDMARKS.sunsetBeach.z, text: '🏖 SUNSET BEACH', min: 0.04 },
  { x: LANDMARKS.lighthouse.x, z: LANDMARKS.lighthouse.z, text: '🗼 LIGHTHOUSE', min: 0.04 },
  { x: LANDMARKS.port.x, z: LANDMARKS.port.z, text: '🚢 PORT OF FORTUNA', min: 0.04 },
  { x: (BRIDGE.x0 + BRIDGE.x1) / 2, z: BRIDGE.z - 160, text: '🌉 INTERSTATE 15', min: 0 },
];

const INK = '#17151f';
const GOLD = '#ffc53d';
const ROAD = '#34313d';

export class Minimap {
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private c: CanvasRenderingContext2D;
  private title: HTMLDivElement;
  private t = 0;
  big = false;
  private zoomSmall = 1;
  private zoomBig = 1;
  /** Where the big map looks (null = the whole island). */
  private center: { x: number; z: number } | null = null;
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  private headingUp = true;
  private view = { cx: 0, cz: 0, s: 1, rot: 0 };
  private roads: { w: number; p: Path2D }[] | null = null;
  private blocks: Path2D | null = null;

  constructor(private game: Game, parent: HTMLElement, private map: IslandMap) {
    this.root = el('div', 'minimap');
    const head = el('div', 'mm-head');
    this.title = el('div', 'mm-title', 'JACKPOT ISLAND');
    const btns = el('div', 'mm-btns');
    const b = (text: string, title: string, fn: () => void, cls = '') => {
      const e = el('button', `mm-toggle ${cls}`, text);
      e.title = title;
      e.setAttribute('aria-label', title);
      e.addEventListener('click', (ev) => {
        ev.stopPropagation();
        fn();
        audio.play('click');
        this.t = 0;
      });
      return e;
    };
    try {
      this.headingUp = localStorage.getItem('cs2.mapNorthUp') !== '1';
    } catch {
      /* storage blocked: keep the default */
    }
    const compass = b('🧭', 'Map turns with the camera (click for north up)', () => {
      this.headingUp = !this.headingUp;
      compass.classList.toggle('on', !this.headingUp);
      try {
        localStorage.setItem('cs2.mapNorthUp', this.headingUp ? '0' : '1');
      } catch {
        /* storage blocked */
      }
    }, 'mm-compass');
    compass.classList.toggle('on', !this.headingUp);
    btns.append(
      b('−', 'Zoom out', () => this.zoom(1 / 1.5)),
      b('+', 'Zoom in', () => this.zoom(1.5)),
      b('◎', 'Back to you', () => (this.center = null)),
      compass,
      b('⤢', 'Bigger map (M)', () => this.setBig(!this.big)),
    );
    head.append(this.title, btns);
    this.canvas = el('canvas', 'mm-canvas') as HTMLCanvasElement;
    this.canvas.setAttribute('aria-label', 'Island map: click to set a waypoint');
    this.c = this.canvas.getContext('2d')!;
    this.root.append(head, this.canvas);
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.bindInput();
    parent.appendChild(this.root);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  setBig(big: boolean): void {
    if (big === this.big) return;
    const g = this.game;
    this.big = big;
    this.root.classList.toggle('big', big);
    this.center = null;
    this.t = 0;
    if (big) g.enterMenu();
    else g.leaveMenu();
  }

  toggleBig(): void {
    this.setBig(!this.big);
  }

  private zoom(f: number): void {
    if (this.big) this.zoomBig = Math.max(0.8, Math.min(40, this.zoomBig * f));
    else this.zoomSmall = Math.max(0.25, Math.min(4, this.zoomSmall * f));
  }

  /** Canvas pixel to world (undoing the turn). */
  private toWorld(px: number, py: number): { x: number; z: number } {
    const { cx, cz, s, rot } = this.view;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dx = px - W / 2;
    const dy = py - H / 2;
    const c = Math.cos(-rot);
    const sn = Math.sin(-rot);
    return { x: cx + (dx * c - dy * sn) / s, z: cz + (dx * sn + dy * c) / s };
  }

  private bindInput(): void {
    const cv = this.canvas;
    const pos = (e: PointerEvent | WheelEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height };
    };
    cv.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const p = pos(e);
      this.drag = { x: p.x, y: p.y, cx: this.view.cx, cz: this.view.cz, moved: false };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || !this.big) return;
      const p = pos(e);
      if (Math.hypot(p.x - d.x, p.y - d.y) > 4) d.moved = true;
      if (!d.moved) return;
      const a = this.toWorld(d.x, d.y);
      const b = this.toWorld(p.x, p.y);
      this.center = { x: this.view.cx - (b.x - a.x), z: this.view.cz - (b.z - a.z) };
      d.x = p.x;
      d.y = p.y;
      this.t = 0;
    });
    cv.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved) return;
      const p = pos(e);
      const w = this.toWorld(p.x, p.y);
      this.game.setUserWaypoint(w.x, w.z, 'Waypoint');
      this.t = 0;
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.zoom(e.deltaY < 0 ? 1.25 : 0.8);
      this.t = 0;
    }, { passive: false });
  }

  /** Roads and the city's blocks as paths in world metres (built once). */
  private paths(): void {
    if (this.roads) return;
    this.roads = [];
    for (const r of allRoads()) {
      const p = new Path2D();
      r.pts.forEach(([x, z], i) => (i ? p.lineTo(x, z) : p.moveTo(x, z)));
      this.roads.push({ w: Math.max(8, r.width), p });
    }
    const bridge = new Path2D();
    bridge.moveTo(BRIDGE.x0, BRIDGE.z);
    bridge.lineTo(BRIDGE.mainland + 900, BRIDGE.z);
    this.roads.push({ w: 22, p: bridge });
    this.blocks = new Path2D();
    for (const b of cityBlocks()) this.blocks.rect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
  }

  update(dt: number, px: number, pz: number, heading: number, markers: MapMarker[], speed = 0): void {
    this.t -= dt;
    if (this.t > 0 || this.root.style.display === 'none') return;
    this.t = 1 / 15;
    this.draw(px, pz, heading, markers, speed);
  }

  private draw(meX: number, meZ: number, heading: number, markers: MapMarker[], speed: number): void {
    const g = this.game;
    const cv = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = this.big ? Math.min(window.innerWidth - 32, 760) : 210;
    const cssH = this.big ? Math.min(window.innerHeight * 0.66, 520) : 150;
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
      cv.style.width = `${cssW}px`;
      cv.style.height = `${cssH}px`;
    }
    this.paths();
    const c = this.c;
    const W = cv.width;
    const H = cv.height;
    // Heading up: the way the camera looks points up the map.
    const rot = this.headingUp && !this.big ? g.camera.yaw : 0;
    const islandW = DOMAIN.maxX - DOMAIN.minX;
    const islandH = DOMAIN.maxZ - DOMAIN.minZ;
    // Small map: a few hundred metres round you, wider at speed. Big map: the whole island.
    const s = this.big
      ? Math.min(W / islandW, H / islandH) * this.zoomBig
      : (Math.max(W, H) / (520 + Math.min(1, speed / 40) * 600)) * this.zoomSmall;
    const centre = this.big ? (this.center ?? (this.zoomBig <= 1.01 ? { x: (DOMAIN.minX + DOMAIN.maxX) / 2, z: (DOMAIN.minZ + DOMAIN.maxZ) / 2 } : { x: meX, z: meZ })) : { x: meX, z: meZ };
    this.view = { cx: centre.x, cz: centre.z, s, rot };
    const X = (x: number) => (x - centre.x) * s + W / 2;
    const Z = (z: number) => (z - centre.z) * s + H / 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#144988';
    c.fillRect(0, 0, W, H);
    c.translate(W / 2, H / 2);
    c.rotate(rot);
    c.translate(-W / 2, -H / 2);
    const txt = (t: string, x: number, y: number, dy = 0) => {
      c.save();
      c.translate(x, y);
      c.rotate(-rot);
      c.fillText(t, 0, dy);
      c.restore();
    };
    // Relief.
    const m = this.map;
    c.imageSmoothingEnabled = true;
    c.drawImage(m.base, X(DOMAIN.minX), Z(DOMAIN.minZ), m.w * m.scale * s, m.h * m.scale * s);
    // The city's blocks, then the roads, through a world-metres transform.
    c.save();
    c.translate(X(0), Z(0));
    c.scale(s, s);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.fillStyle = 'rgba(52, 49, 61, 0.55)';
    if (this.blocks) c.fill(this.blocks);
    c.strokeStyle = ROAD;
    for (const r of this.roads!) {
      c.lineWidth = Math.max(r.w, 2.2 / s);
      c.stroke(r.p);
    }
    c.restore();
    // Your businesses' lots in green, the island's casinos in gold.
    for (const b of g.business.owned) {
      c.fillStyle = 'rgba(53, 224, 138, 0.85)';
      c.fillRect(X(b.lot.x0), Z(b.lot.z0), (b.lot.x1 - b.lot.x0) * s, (b.lot.z1 - b.lot.z0) * s);
    }
    for (const v of g.world.venues) {
      if (v.opts.id.startsWith('mine:')) continue;
      const bd = v.bounds;
      c.fillStyle = 'rgba(255, 197, 61, 0.9)';
      c.fillRect(X(bd.minX), Z(bd.minZ), Math.max(3, (bd.maxX - bd.minX) * s), Math.max(3, (bd.maxZ - bd.minZ) * s));
    }
    // Place names.
    const f = Math.round(Math.max(10, Math.min(14, 9 + s * 40)) * dpr);
    c.font = `800 ${f}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = 'rgba(0,0,0,0.9)';
    c.shadowBlur = 4;
    c.fillStyle = '#ffffff';
    for (const p of PLACES) if (s >= p.min || this.big) txt(p.text, X(p.x), Z(p.z));
    c.shadowBlur = 0;
    // Markers: shops, your car, businesses, the waypoint…
    const rr = Math.round((this.big ? 9 : 7) * dpr);
    for (const mk of markers) {
      const x = X(mk.x);
      const y = Z(mk.z);
      const r = mk.big ? rr * 1.25 : rr;
      if (Math.hypot(x - W / 2, y - H / 2) > Math.hypot(W, H) / 2 + r) continue;
      c.fillStyle = mk.color;
      c.strokeStyle = INK;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = '#ffffff';
      c.font = `${Math.round(r * 1.2)}px system-ui, sans-serif`;
      txt(mk.icon, x, y, 1);
      if (this.big && mk.label && mk.big) {
        c.font = `800 ${Math.round(11 * dpr)}px system-ui, sans-serif`;
        c.shadowColor = 'rgba(0,0,0,0.95)';
        c.shadowBlur = 4;
        c.fillStyle = '#ffd877';
        txt(mk.label, x, y, -r - 8 * dpr);
        c.shadowBlur = 0;
      }
    }
    // Your waypoint: a dashed line and a gold pin.
    const wp = g.waypoint.target;
    if (wp) {
      c.strokeStyle = 'rgba(255,197,61,0.9)';
      c.lineWidth = 2 * dpr;
      c.setLineDash([8 * dpr, 6 * dpr]);
      c.beginPath();
      c.moveTo(X(meX), Z(meZ));
      c.lineTo(X(wp.x), Z(wp.z));
      c.stroke();
      c.setLineDash([]);
      const pr = 8 * dpr;
      c.save();
      c.translate(X(wp.x), Z(wp.z));
      c.rotate(-rot);
      c.fillStyle = GOLD;
      c.strokeStyle = INK;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, 0);
      c.bezierCurveTo(-pr, -pr, -pr, -pr * 2.2, 0, -pr * 2.2);
      c.bezierCurveTo(pr, -pr * 2.2, pr, -pr, 0, 0);
      c.fill();
      c.stroke();
      c.fillStyle = INK;
      c.beginPath();
      c.arc(0, -pr * 1.45, pr * 0.32, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    // You: a gold arrow pointing the way you face.
    const r = Math.max(7 * dpr, s * 2);
    c.save();
    c.translate(X(meX), Z(meZ));
    c.rotate(Math.PI - heading);
    c.fillStyle = GOLD;
    c.strokeStyle = INK;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -r);
    c.lineTo(r * 0.7, r * 0.7);
    c.lineTo(0, r * 0.3);
    c.lineTo(-r * 0.7, r * 0.7);
    c.closePath();
    c.stroke();
    c.fill();
    c.restore();
    // A compass needle on the rim pointing north when the map turns.
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (Math.abs(rot) > 1e-3) {
      const nx = Math.sin(rot);
      const ny = -Math.cos(rot);
      const k = Math.min(Math.abs((W / 2 - 12 * dpr) / (nx || 1e-6)), Math.abs((H / 2 - 12 * dpr) / (ny || 1e-6)));
      const ax = W / 2 + nx * k;
      const ay = H / 2 + ny * k;
      c.fillStyle = 'rgba(11,7,20,0.75)';
      c.beginPath();
      c.arc(ax, ay, 9 * dpr, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#ff5a5a';
      c.font = `900 ${11 * dpr}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('N', ax, ay + 0.5);
    }
    this.title.textContent = this.big ? 'JACKPOT ISLAND · CLICK TO SET A WAYPOINT' : this.areaName(meX, meZ);
  }

  /** The nearest named place, for the panel's title. */
  private areaName(x: number, z: number): string {
    if (x > CITY.minX && x < CITY.maxX && z > CITY.minZ && z < CITY.maxZ) return 'FORTUNA CITY';
    let best = PLACES[0];
    let bd = Infinity;
    for (const p of PLACES) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best.text.replace(/^\S+\s/, '');
  }
}
