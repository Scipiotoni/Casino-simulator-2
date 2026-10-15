import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Activity } from '../activity';
import type { MapMarker } from '../../ui/map';
import type { Vehicle } from '../../vehicles/vehicle';
import { Kit } from '../../render/kit';
import { labelTexture } from '../../render/signs';
import { mulberry32 } from '../../core/noise';
import { audio } from '../../core/audio';
import { el, money } from '../../ui/dom';
import { additive, glowTexture } from '../glow';
import { clock, type Ground } from '../taxi/fares';
import {
  DEPOT, DEPOT_D, DEPOT_W, RULE_NAMES, condition, emptyRecord, findAddresses, fmtDist, heavySpeed, payout, pickJob, readRecord,
  type Address, type DeliveryRecord, type Job,
} from './jobs';
import './style.css';

/**
 * Island Express: courier shifts in a delivery van. Clock on at the depot on Dock Street (E)
 * and the van is waiting at the kerb. Drive it and the jobs come one at a time: a parcel for a
 * street address somewhere across town, against a clock set by the length of the trip. Pull
 * up in the yellow ring at the kerb and press E to hand it over (or get out and walk it to
 * the door). The pay is set by the distance and the kind of parcel, plus a bonus for being
 * early, and each kind has its rule: rush jobs have a short clock, fragile ones lose value
 * with every knock, valuables are lost if the police come after you, and heavy loads make
 * the van slow to pull away.
 *
 * Clock off with E at the depot, or by staying out of the van (away from the depot) for 20
 * seconds. Nobody says a word: it's all on the job card, the toasts and the banners.
 */

/** Radius of the drop-off ring (m). */
const RING_R = 4.5;
/** Slow enough to count as stopped (m/s). */
const STOP_SPEED = 2.5;
/** Out of the van longer than this, away from the depot, and the shift is over (s). */
const AWAY_LIMIT = 20;
/** Near enough the depot not to count as away (m). */
const DEPOT_NEAR = 40;
/** You can walk a parcel to the door with the van parked this close (m). */
const VAN_REACH = 60;
/** Touch screens have no E while driving: there, holding still in the ring this long drops off (s). */
const TOUCH_DROP = 1.5;
/** Seconds to the next job after one ends. */
const NEXT_JOB = 4;
/** The time on the card turns red with this much left (s). */
const LOW_TIME = 20;
/** How long the shift summary stays up (s). */
const CARD_TIME = 7;
const YELLOW = 0xffc21a;
const ORANGE = 0xff7a1a;
const NAVY = 0x1b2a4a;

interface Run {
  job: Job;
  left: number;
  /** Health the van has lost since the parcel went in (only knocks count, never repairs). */
  damage: number;
  /** Seconds before another knock gets its own toast. */
  knockT: number;
}

interface Shift {
  van: Vehicle;
  delivered: number;
  earned: number;
  /** Of which early bonuses. */
  bonus: number;
  failed: number;
  run: Run | null;
  nextT: number;
  /** Seconds out of the van, away from the depot. */
  away: number;
  /** Has been in the van at least once. */
  boarded: boolean;
  last: string;
  /** The best shift before this one (to call a new best). */
  bestBefore: number;
  /** Last frame's van speed and health (for heavy loads and knocks). */
  prevSpeed: number;
  prevHealth: number;
  /** Last frame: in the van, stopped in the ring. Pressing E there drops the parcel off. */
  inRing: boolean;
  /** How long the van has been stopped in the ring. */
  ringT: number;
}

export class Deliveries implements Activity {
  readonly id = 'deliveries';
  private built = false;
  private record: DeliveryRecord = emptyRecord();
  private shift: Shift | null = null;
  /** The last shift's van, cleared away once you're well clear of it. */
  private oldVan: Vehicle | null = null;
  private vans = 0;
  private addresses: Address[] = [];
  private rng = mulberry32((Date.now() & 0xffff) + 311);
  private front = new THREE.Vector3();
  private t = 0;
  // The rings: the kerb (for the van) and a small one at the door (on foot).
  private ring!: THREE.Group;
  private ringTorus!: THREE.Mesh;
  private wallMat!: THREE.MeshBasicMaterial;
  private door!: THREE.Group;
  // HUD.
  private hud: HTMLDivElement;
  private hudCount: HTMLElement;
  private hudIcon: HTMLElement;
  private hudKind: HTMLElement;
  private hudRule: HTMLElement;
  private hudHint: HTMLElement;
  private hudAddr: HTMLElement;
  private hudStreet: HTMLElement;
  private hudArea: HTMLElement;
  private hudDist: HTMLElement;
  private hudRow: HTMLElement;
  private hudTimeBox: HTMLElement;
  private hudTime: HTMLElement;
  private hudPay: HTMLElement;
  private hudCond: HTMLElement;
  private hudCondBar: HTMLElement;
  private hudWarn: HTMLElement;
  private card: HTMLDivElement;
  private cardT = 0;

  constructor(readonly game: Game) {
    this.hud = el(
      'div',
      'dlv-hud',
      '<div class="dl-head"><span class="dl-tag">ISLAND EXPRESS</span><span class="dl-count"></span></div>' +
        '<div class="dl-job"><div class="dl-icon"></div><div class="dl-what"><div class="dl-line"><b class="dl-kind"></b><span class="dl-rule"></span></div><small class="dl-hint"></small></div></div>' +
        '<div class="dl-addr"><div class="dl-street"></div><div class="dl-sub"><span class="dl-area"></span><span class="dl-dist"></span></div></div>' +
        '<div class="dl-row"><div class="dl-box dl-time"><small>TIME</small><b></b></div><div class="dl-box dl-pay"><small>PAY</small><b></b></div></div>' +
        '<div class="dl-cond"><small>CONDITION</small><span><i></i></span></div>' +
        '<div class="dl-warn"></div>',
    );
    const q = <T extends HTMLElement>(s: string): T => this.hud.querySelector(s) as T;
    this.hudCount = q('.dl-count');
    this.hudIcon = q('.dl-icon');
    this.hudKind = q('.dl-kind');
    this.hudRule = q('.dl-rule');
    this.hudHint = q('.dl-hint');
    this.hudAddr = q('.dl-addr');
    this.hudStreet = q('.dl-street');
    this.hudArea = q('.dl-area');
    this.hudDist = q('.dl-dist');
    this.hudRow = q('.dl-row');
    this.hudTimeBox = q('.dl-time');
    this.hudTime = q('.dl-time b');
    this.hudPay = q('.dl-pay b');
    this.hudCond = q('.dl-cond');
    this.hudCondBar = q('.dl-cond i');
    this.hudWarn = q('.dl-warn');
    this.card = el('div', 'dlv-card');
    game.uiRoot.append(this.hud, this.card);
  }

  // ---------------------------------------------------------------- building

  private build(): void {
    this.built = true;
    const w = this.game.world;
    const ground: Ground = {
      roads: w.terrain.roads,
      lots: w.terrain.lots,
      isLand: (x, z) => w.terrain.isLand(x, z),
      blocked: (x, z) => w.collision.blocked(x, z, 0.45, w.groundY(x, z) + 0.2, 1.6),
    };
    this.addresses = findAddresses(ground);
    this.buildDepot();
    this.buildRings();
    this.game.interactions.add({
      id: 'deliveries:door',
      x: 0,
      y: 0,
      z: 0,
      radius: 3.5,
      label: () => `Deliver the ${this.shift?.run?.job.kind.name.toLowerCase() ?? 'parcel'}`,
      sub: () => this.shift?.run?.job.to.street ?? '',
      enabled: () => {
        const s = this.shift;
        if (!s?.run) return false;
        const a = s.run.job.to;
        return Math.hypot(s.van.pos.x - a.doorX, s.van.pos.z - a.doorZ) < VAN_REACH;
      },
      action: () => this.shift?.run && this.deliver(this.shift),
      priority: 1,
    });
  }

  private buildDepot(): void {
    const g = this.game;
    const y = g.world.groundY(DEPOT.x, DEPOT.z);
    // The depot in its own frame: +z faces the street, x runs along it.
    const group = new THREE.Group();
    group.position.set(DEPOT.x, y, DEPOT.z);
    group.rotation.y = DEPOT.yaw;
    const k = new Kit();
    const glow = new Kit();
    const W = DEPOT_W;
    const D = DEPOT_D;
    const H = 3.6;
    const front = D / 2;
    // A concrete apron, the walls, an orange band and a flat navy roof.
    k.box(W + 2, 0.14, D + 3, 0xb8b4aa, { y: 0.07, z: 1 });
    k.box(W, H, D, 0xf4f1ea, { y: H / 2 + 0.14 });
    k.box(W + 0.04, 0.5, D + 0.04, ORANGE, { y: H - 0.1 });
    k.box(W + 0.5, 0.26, D + 0.5, NAVY, { y: H + 0.27 }, 'shiny');
    // The loading bay: a ribbed roller door with a yellow-and-black kerb.
    const bx = W / 2 - 2.3;
    k.box(3.4, 2.9, 0.06, 0x8a8f99, { x: bx, y: 1.6, z: front + 0.02 });
    for (let i = 0; i < 9; i++) k.box(3.36, 0.04, 0.05, 0x6a6f79, { x: bx, y: 0.35 + i * 0.32, z: front + 0.06 });
    for (let i = 0; i < 8; i++) k.box(0.45, 0.12, 0.3, i % 2 ? 0x15151a : YELLOW, { x: bx - 1.6 + (i + 0.5) * 0.4, y: 0.2, z: front + 0.2 });
    // The office: a glass door, a lit window with parcels on the shelf, a canopy.
    const dx = -W / 2 + 1.3;
    k.box(1.2, 2.3, 0.06, 0x9ccfe8, { x: dx, y: 1.3, z: front + 0.02 }, 'glass');
    k.box(1.36, 0.1, 0.1, NAVY, { x: dx, y: 2.5, z: front + 0.04 });
    k.box(2.2, 1.2, 0.06, 0x9ccfe8, { x: dx + 2.0, y: 1.75, z: front + 0.02 }, 'glass');
    glow.box(2.1, 1.1, 0.04, 0xf3d7a4, { x: dx + 2.0, y: 1.75, z: front - 0.08 }, 'glow');
    for (let i = 0; i < 3; i++) k.box(0.45, 0.35 + (i % 2) * 0.15, 0.3, 0xc49a6a, { x: dx + 1.35 + i * 0.6, y: 1.35 + (0.35 + (i % 2) * 0.15) / 2, z: front - 0.2 });
    k.box(3.6, 0.12, 1.5, NAVY, { x: dx + 1.0, y: 2.75, z: front + 0.75 }, 'shiny');
    glow.box(3.2, 0.05, 0.9, 0xfff1c8, { x: dx + 1.0, y: 2.68, z: front + 0.75 }, 'glow');
    // A stack of parcels on a pallet by the bay, and a post box by the door.
    const px = W / 2 + 0.2;
    k.box(1.2, 0.14, 1.0, 0x9a7a50, { x: px, y: 0.21, z: front + 1.2 });
    const stack: [number, number, number, number, number][] = [
      [-0.28, 0.5, -0.2, 0.5, 0.5], [0.28, 0.5, -0.2, 0.5, 0.5], [0, 0.5, 0.25, 1.0, 0.36], [-0.15, 0.95, 0, 0.6, 0.4], [0.3, 0.92, 0.05, 0.36, 0.34],
    ];
    for (const [sx, sy, sz, sw, sh] of stack) k.box(sw, sh, 0.4, 0xc49a6a, { x: px + sx, y: sy - 0.22 + sh / 2, z: front + 1.2 + sz });
    k.box(0.5, 1.0, 0.4, ORANGE, { x: dx - 0.95, y: 0.64, z: front + 0.4 }, 'shiny');
    k.box(0.52, 0.06, 0.42, NAVY, { x: dx - 0.95, y: 1.17, z: front + 0.4 });
    group.add(k.bake({ shadows: true }), glow.bake());
    // The sign: ISLAND EXPRESS on a navy board along the roof's front edge.
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(6.6, 0.95),
      new THREE.MeshBasicMaterial({ map: labelTexture('ISLAND EXPRESS', { width: 1024, height: 148, font: 'Lilita One', color: '#ffffff', bg: '#1b2a4a', size: 100 }), toneMapped: false }),
    );
    sign.position.set(-0.4, H + 1.0, front + 0.12);
    const board = new THREE.Mesh(new THREE.BoxGeometry(7.4, 1.15, 0.16), new THREE.MeshLambertMaterial({ color: NAVY }));
    board.position.set(-0.4, H + 1.0, front + 0.02);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.12, 0.18), new THREE.MeshBasicMaterial({ color: ORANGE, toneMapped: false }));
    stripe.position.set(-0.4, H + 0.4, front + 0.03);
    // A parcel logo beside the name: a box with tape.
    const logo = new Kit();
    logo.box(0.7, 0.7, 0.12, ORANGE, { x: 3.25, y: H + 1.0, z: front + 0.08 }, 'glow');
    logo.box(0.12, 0.72, 0.14, 0xffffff, { x: 3.25, y: H + 1.0, z: front + 0.09 }, 'glow');
    logo.box(0.72, 0.1, 0.14, 0xffffff, { x: 3.25, y: H + 1.18, z: front + 0.09 }, 'glow');
    group.add(board, stripe, sign, logo.bake());
    group.updateMatrixWorld(true);
    g.renderer.scene.add(group);
    // Collision: the building, the parcels and the post box (the depot is square to the grid).
    const box = (x0: number, x1: number, z0: number, z1: number, h: number, cam = true): void => {
      const a = group.localToWorld(new THREE.Vector3(x0, 0, z0));
      const b = group.localToWorld(new THREE.Vector3(x1, 0, z1));
      g.world.collision.addBox({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z), minY: y - 1, maxY: y + h, tag: 'deliveries', cam });
    };
    box(-W / 2, W / 2, -D / 2, front, H + 1.7);
    box(px - 0.6, px + 0.6, front + 0.7, front + 1.7, 1.2, false);
    box(dx - 1.2, dx - 0.7, front + 0.2, front + 0.6, 1.2, false);
    // Use the door.
    this.front.copy(group.localToWorld(new THREE.Vector3(dx + 1.0, 0, front + 2.0)));
    g.interactions.add({
      id: 'deliveries:depot',
      x: this.front.x,
      y,
      z: this.front.z,
      radius: 3.2,
      label: () => (this.shift ? 'End your shift' : 'Start an Island Express shift'),
      sub: () => {
        const s = this.shift;
        if (s) return `${s.delivered} deliver${s.delivered === 1 ? 'y' : 'ies'} · ${money(s.earned)}`;
        const r = this.record;
        return r.delivered ? `Best shift ${money(r.bestShift)}` : 'Parcels across town, against the clock';
      },
      action: () => (this.shift ? this.endShift('') : this.startShift()),
    });
  }

  private buildRings(): void {
    const g = this.game;
    this.ring = new THREE.Group();
    this.ringTorus = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.22, 8, 48), additive(YELLOW, 0.95));
    this.ringTorus.rotation.x = Math.PI / 2;
    this.ringTorus.position.y = 0.25;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(RING_R, 40), additive(YELLOW, 0.45, glowTexture(true)));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.12;
    this.wallMat = additive(YELLOW, 0.4, glowTexture(false));
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(RING_R, RING_R, 3.2, 40, 1, true), this.wallMat);
    wall.position.y = 1.6;
    this.ring.add(this.ringTorus, disc, wall);
    this.ring.visible = false;
    // The door: a small ring on the ground and a parcel hovering over it.
    this.door = new THREE.Group();
    const dt = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.07, 6, 32), additive(YELLOW, 0.9));
    dt.rotation.x = Math.PI / 2;
    dt.position.y = 0.12;
    const dd = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), additive(YELLOW, 0.35, glowTexture(true)));
    dd.rotation.x = -Math.PI / 2;
    dd.position.y = 0.08;
    const parcel = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.42), additive(ORANGE, 0.85));
    parcel.position.y = 1.5;
    parcel.name = 'parcel';
    this.door.add(dt, dd, parcel);
    this.door.visible = false;
    g.renderer.scene.add(this.ring, this.door);
  }

  // ---------------------------------------------------------------- shifts

  private startShift(): void {
    const g = this.game;
    if (g.combat.wanted > 0) {
      audio.play('error');
      g.hud.toast('Lose the police first: no van for you while they’re looking', 'bad');
      return;
    }
    this.clearOldVan(true);
    const van = this.spawnVan();
    this.shift = {
      van, delivered: 0, earned: 0, bonus: 0, failed: 0, run: null, nextT: 1.5, away: 0, boarded: false, last: '',
      bestBefore: this.record.bestShift, prevSpeed: 0, prevHealth: van.health, inRing: false, ringT: 0,
    };
    this.cardT = 0;
    g.setUserWaypoint(van.pos.x, van.pos.z, 'Your van');
    audio.play('objective');
    g.hud.banner('ON SHIFT', 'ISLAND EXPRESS', 2200, 'gold');
    g.hud.toast('Your van is at the kerb: get in for your first parcel', 'info');
  }

  /** The shift's van, at the kerb in front of the depot (a little along if something's parked there). */
  private spawnVan(): Vehicle {
    const g = this.game;
    const others = [...g.vehicles.list, ...g.traffic.list];
    let x = DEPOT.vanX;
    for (const dx of [0, 8, -8, 16, -16, 24]) {
      x = DEPOT.vanX + dx;
      if (!others.some((v) => Math.hypot(v.pos.x - x, v.pos.z - DEPOT.vanZ) < 6)) break;
    }
    const v = g.vehicles.spawn('van', x, DEPOT.vanZ, DEPOT.vanHeading, { id: `island-express-van-${++this.vans}`, color: 0xf2f2ee });
    const it = g.interactions.get(`car:${v.id}`);
    if (it) {
      it.label = () => (this.shift?.van === v ? 'Drive your Island Express van' : `Drive the ${v.def.name}`);
      it.sub = () => (this.shift?.van === v ? 'On shift' : '');
    }
    return v;
  }

  /** Take away the last shift's van once nobody's in it (and, unless `now`, once you're well clear). */
  private clearOldVan(now: boolean): void {
    const g = this.game;
    const v = this.oldVan;
    if (!v) return;
    if (!g.vehicles.list.includes(v)) {
      this.oldVan = null;
      return;
    }
    if (g.vehicles.driving === v) return;
    const p = g.player.pos;
    if (!now && Math.hypot(p.x - v.pos.x, p.z - v.pos.z) < 160) return;
    g.vehicles.remove(v);
    this.oldVan = null;
  }

  private endShift(why: string): void {
    const g = this.game;
    const s = this.shift;
    if (!s) return;
    this.shift = null;
    g.clearUserWaypoint();
    this.oldVan = s.van;
    const best = s.earned > 0 && s.earned > s.bestBefore;
    audio.play(s.delivered ? 'win' : 'objective');
    g.hud.banner('SHIFT OVER', `${s.delivered} PARCEL${s.delivered === 1 ? '' : 'S'} · ${money(s.earned)}${best && s.bestBefore > 0 ? ' · NEW BEST' : ''}`, 4200, best ? 'gold' : '');
    if (why) g.hud.toast(why, 'info', 4200);
    this.showCard(s, best);
    g.save();
  }

  private showCard(s: Shift, best: boolean): void {
    const r = this.record;
    this.cardT = CARD_TIME;
    this.card.innerHTML =
      `<div class="dc-tag">ISLAND EXPRESS · SHIFT OVER</div>` +
      `<div class="dc-big">${money(s.earned)}</div>` +
      `<div class="dc-rows">` +
      `<div><span>Delivered</span><b>${s.delivered}</b></div>` +
      `<div><span>Early bonuses</span><b>${money(s.bonus)}</b></div>` +
      (s.failed ? `<div><span>Jobs lost</span><b class="bad">${s.failed}</b></div>` : '') +
      `<div><span>Best shift</span><b>${money(r.bestShift)}${best ? ' ★' : ''}</b></div>` +
      `<div><span>Parcels, all time</span><b>${r.delivered}</b></div>` +
      `</div>`;
  }

  // ---------------------------------------------------------------- jobs

  private offerJob(s: Shift): void {
    const g = this.game;
    const job = pickJob(this.addresses, s.van.pos, this.rng, { last: s.last, wanted: g.combat.wanted > 0 });
    if (!job) {
      s.nextT = 5;
      return;
    }
    s.run = { job, left: job.time, damage: 0, knockT: 0 };
    s.prevHealth = s.van.health;
    const a = job.to;
    g.interactions.move('deliveries:door', a.doorX, g.world.groundY(a.doorX, a.doorZ), a.doorZ);
    g.setUserWaypoint(a.kerb.x, a.kerb.z, a.street);
    audio.play('objective');
    g.hud.toast(`${job.kind.icon} ${job.kind.name} for ${a.street} · ${fmtDist(job.dist)}`, 'info', 4200);
  }

  private updateShift(dt: number): void {
    const g = this.game;
    const s = this.shift!;
    const van = s.van;
    if (!g.vehicles.list.includes(van)) return this.endShift('Your van is gone');
    const inVan = g.vehicles.driving === van;
    // E in the ring: the game has just let you out of the van; hand the parcel over and get back in.
    if (!inVan && s.inRing && s.run && g.player.mode === 'walk' && g.input.pressed('KeyE')) {
      s.inRing = false;
      this.deliver(s);
      g.vehicles.enter(van);
      return;
    }
    s.inRing = false;
    if (inVan) {
      s.away = 0;
      if (!s.boarded) {
        s.boarded = true;
        if (!s.run) g.clearUserWaypoint();
      }
    } else {
      const p = g.player.pos;
      if (Math.hypot(p.x - this.front.x, p.z - this.front.z) < DEPOT_NEAR) s.away = 0;
      else s.away += dt;
      if (s.away > AWAY_LIMIT) return this.endShift('You left the van: the shift is over');
    }
    const r = s.run;
    // A heavy load: the van keeps only part of whatever speed it just gained.
    if (inVan && r?.job.kind.rule === 'heavy') van.speed = heavySpeed(s.prevSpeed, van.speed);
    s.prevSpeed = van.speed;
    const knock = Math.max(0, s.prevHealth - van.health);
    s.prevHealth = van.health;
    if (!r) {
      if (!inVan) return;
      s.nextT -= dt;
      if (s.nextT <= 0) this.offerJob(s);
      return;
    }
    const kind = r.job.kind;
    if (g.player.mode === 'dead') return this.failJob(s, 'Knocked out: the parcel went back to the depot');
    if (kind.rule === 'valuable' && g.combat.wanted > 0) return this.failJob(s, `Wanted: the ${kind.name.toLowerCase()} were seized`);
    r.left -= dt;
    if (r.left <= 0) return this.failJob(s, 'Out of time: the customer cancelled');
    r.knockT = Math.max(0, r.knockT - dt);
    if (knock > 0 && kind.rule === 'fragile') {
      r.damage += knock;
      const c = condition(r.damage);
      if (c <= 0) return this.failJob(s, `Smashed: the ${kind.name.toLowerCase()} didn’t survive that`);
      if (r.knockT <= 0) {
        r.knockT = 1.5;
        audio.play('error');
        g.hud.toast(`${kind.icon} Careful! ${kind.name} at ${Math.round(c * 100)}%`, 'bad', 2400);
      }
    }
    const k = r.job.to.kerb;
    s.inRing = inVan && Math.hypot(van.pos.x - k.x, van.pos.z - k.z) < RING_R + 0.5 && Math.abs(van.speed) < STOP_SPEED;
    s.ringT = s.inRing ? s.ringT + dt : 0;
    if (g.input.touchMode && s.ringT >= TOUCH_DROP) this.deliver(s);
  }

  private deliver(s: Shift): void {
    const g = this.game;
    const r = s.run;
    if (!r) return;
    const job = r.job;
    const pay = payout(job, r.left, r.damage);
    s.run = null;
    s.inRing = false;
    s.ringT = 0;
    s.delivered++;
    s.earned += pay.total;
    s.bonus += pay.early;
    s.last = job.to.lotId;
    s.nextT = NEXT_JOB;
    const rec = this.record;
    rec.delivered++;
    rec.earned += pay.total;
    rec.bestShift = Math.max(rec.bestShift, s.earned);
    rec.bestCount = Math.max(rec.bestCount, s.delivered);
    g.stats.deliveries = (g.stats.deliveries ?? 0) + 1;
    g.addMoney(pay.total, 'for a delivery');
    const parts = [`Pay ${money(pay.base)}`];
    if (pay.early > 0) parts.push(`+ ${money(pay.early)} early`);
    if (pay.broken > 0) parts.push(`− ${money(pay.broken)} breakage`);
    g.hud.toast(`${job.kind.icon} Delivered: ${parts.join(' ')}`, pay.broken > 0 ? 'info' : 'good', 4200);
    audio.play('cash');
    g.clearUserWaypoint();
    g.save();
  }

  private failJob(s: Shift, why: string): void {
    const g = this.game;
    if (!s.run) return;
    s.run = null;
    s.inRing = false;
    s.ringT = 0;
    s.failed++;
    s.nextT = NEXT_JOB + 2;
    g.clearUserWaypoint();
    audio.play('error');
    g.hud.toast(why, 'bad', 3800);
  }

  // ---------------------------------------------------------------- the loop

  update(dt: number): void {
    const g = this.game;
    if (g.mode === 'loading') return;
    if (!this.built) this.build();
    const playing = g.mode === 'play' && !g.director.playing;
    if (playing) {
      this.t += dt;
      if (this.shift) this.updateShift(dt);
      if (!this.shift) this.clearOldVan(false);
      this.cardT = Math.max(0, this.cardT - dt);
    }
    this.draw(playing, dt);
  }

  private draw(playing: boolean, dt: number): void {
    const g = this.game;
    const s = this.shift;
    const a = s?.run?.job.to ?? null;
    this.ring.visible = this.door.visible = !!a;
    if (s && a) {
      const k = a.kerb;
      this.ring.position.set(k.x, g.world.groundY(k.x, k.z), k.z);
      const pulse = 1 + Math.sin(this.t * 3) * 0.04;
      this.ringTorus.scale.set(pulse, pulse, 1);
      const inside = Math.hypot(s.van.pos.x - k.x, s.van.pos.z - k.z) < RING_R + 2;
      this.wallMat.opacity += ((inside ? 0.12 : 0.4) - this.wallMat.opacity) * Math.min(1, dt * 5);
      this.door.position.set(a.doorX, g.world.groundY(a.doorX, a.doorZ), a.doorZ);
      const parcel = this.door.getObjectByName('parcel')!;
      parcel.rotation.y = this.t * 1.5;
      parcel.position.y = 1.5 + Math.sin(this.t * 2.2) * 0.12;
    }
    this.hud.classList.toggle('on', playing && !!s);
    if (playing && s) this.drawHud(s);
    this.card.classList.toggle('on', playing && this.cardT > 0);
  }

  private drawHud(s: Shift): void {
    const g = this.game;
    const r = s.run;
    const van = s.van;
    const inVan = g.vehicles.driving === van;
    set(this.hudCount, `${s.delivered} · ${money(s.earned)}`);
    let warn = '';
    let warnKind = '';
    if (!r) {
      set(this.hudIcon, '📦');
      set(this.hudKind, !s.boarded ? 'Get in your van' : s.nextT > 0.5 ? `Next job in ${Math.ceil(s.nextT)} s` : 'Finding a job…');
      set(this.hudRule, '');
      set(this.hudHint, !s.boarded ? 'It’s at the kerb by the depot' : 'Parcels come one at a time');
      this.hudRule.className = 'dl-rule';
    } else {
      const job = r.job;
      const kind = job.kind;
      set(this.hudIcon, kind.icon);
      set(this.hudKind, kind.name);
      set(this.hudRule, RULE_NAMES[kind.rule]);
      this.hudRule.className = `dl-rule ${kind.rule}`;
      set(this.hudHint, kind.hint);
      set(this.hudStreet, job.to.street);
      set(this.hudArea, job.to.area);
      const k = job.to.kerb;
      const p = inVan ? van.pos : g.player.pos;
      set(this.hudDist, fmtDist(Math.hypot(k.x - p.x, k.z - p.z)));
      set(this.hudTime, clock(r.left));
      set(this.hudPay, money(payout(job, r.left, r.damage).total));
      this.hudTimeBox.classList.toggle('late', r.left < LOW_TIME);
      const c = condition(r.damage);
      this.hudCondBar.style.width = `${Math.round(c * 100)}%`;
      this.hudCond.classList.toggle('low', c < 0.5);
      if (inVan && Math.hypot(van.pos.x - k.x, van.pos.z - k.z) < RING_R + 6) {
        warn = Math.abs(van.speed) >= STOP_SPEED ? 'Stop in the ring to drop off' : g.input.touchMode ? 'Hold still to drop off' : 'Press E to drop off';
        warnKind = 'hint';
      } else if (kind.rule === 'valuable' && g.combat.wanted > 0) {
        warn = 'Police! Valuables are lost';
      }
    }
    this.hudAddr.classList.toggle('on', !!r);
    this.hudRow.classList.toggle('on', !!r);
    this.hudCond.classList.toggle('on', r?.job.kind.rule === 'fragile');
    if (!inVan && s.boarded) {
      const p = g.player.pos;
      if (Math.hypot(p.x - this.front.x, p.z - this.front.z) >= DEPOT_NEAR) {
        warn = `Back in the van in ${Math.max(0, Math.ceil(AWAY_LIMIT - s.away))} s or the shift ends`;
        warnKind = '';
      }
    }
    set(this.hudWarn, warn);
    this.hudWarn.className = `dl-warn${warn ? ' on' : ''}${warnKind ? ` ${warnKind}` : ''}`;
  }

  // ---------------------------------------------------------------- map and saves

  markers(full: boolean): MapMarker[] {
    if (!this.built) return [];
    full ||= this.game.minimap.big;
    const out: MapMarker[] = [{ x: this.front.x, z: this.front.z, icon: '📦', color: '#ff7a1a', label: full ? 'Island Express' : undefined, big: full || !!this.shift }];
    const s = this.shift;
    if (s && this.game.vehicles.driving !== s.van) out.push({ x: s.van.pos.x, z: s.van.pos.z, icon: '🚐', color: '#ff7a1a', label: full ? 'Your van' : undefined, big: true });
    return out;
  }

  save(): unknown {
    return { ...this.record };
  }

  load(data: unknown): void {
    this.record = readRecord(data);
  }
}

// ------------------------------------------------------------------ helpers

function set(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}
