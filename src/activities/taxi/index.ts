import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Activity } from '../activity';
import type { MapMarker } from '../../ui/map';
import type { Vehicle } from '../../vehicles/vehicle';
import { Kit } from '../../render/kit';
import { labelTexture } from '../../render/signs';
import { CharacterModel } from '../../chars/model';
import { Animator } from '../../chars/anim';
import { randomAppearance } from '../../chars/skins';
import { mulberry32 } from '../../core/noise';
import { dampAngle } from '../../core/math';
import { audio } from '../../core/audio';
import { el, money } from '../../ui/dom';
import {
  BASE_FARE, PLACES, STAND, chooseStop, clock, emptyRecord, hotelPlaces, meterFare, payment, pickupKerb, placeStop, readRecord, timeLimit, waitLimit,
  type Ground, type Kerb, type Place, type Stop, type TaxiRecord,
} from './fares';
import './style.css';

/**
 * Sunshine Cabs: drive a taxi for fares. Clock on at the cab stand on the Golden Viper's
 * forecourt (E) and a cab is waiting at the kerb. Drive it and the fares come one at a time:
 * a passenger waits at a kerb a few blocks away, in a ring; pull up slowly beside them and
 * they get in. Then it's across town (or now and then out of town) on the meter, against
 * the clock: the fare is the flag fall plus the distance, with tips for a quick ride and for
 * not hitting anything. Run out of time, or draw the police, and the fare is off.
 *
 * Clock off with E at the stand, or by leaving the cab for more than 20 seconds. Nobody says a
 * word: it's all on the meter, the toasts and the banners.
 */

/** Radius of the pickup and drop-off rings (m). */
const RING_R = 4.5;
/** Slow enough to count as stopped (m/s). */
const STOP_SPEED = 2.5;
/** A passenger only gets in this close to the cab. */
const BOARD_RANGE = 9;
/** Out of the cab longer than this and the shift is over (s). Before you first get in, a bit more. */
const AWAY_LIMIT = 20;
const FIRST_LIMIT = 40;
/** Seconds to the next fare after one ends. */
const NEXT_FARE = 4;
/** How long getting in and getting out take (s). */
const BOARD_TIME = 1.4;
const LEAVE_TIME = 6;
/** The passenger waves the cab down once it's this close. */
const WAVE_RANGE = 45;
/** How long the shift summary stays up (s). */
const CARD_TIME = 7;
const YELLOW = 0xffc21a;

interface Rider {
  model: CharacterModel;
  anim: Animator;
  pos: THREE.Vector3;
  yaw: number;
}

interface Fare {
  kerb: Kerb;
  stop: Stop;
  /** waiting at the kerb → getting in → riding → (paid or failed). */
  phase: 'waiting' | 'boarding' | 'riding';
  rider: Rider;
  /** How long they'll still wait for the cab. */
  wait: number;
  /** Pickup to drop-off as the crow flies (m). */
  crow: number;
  limit: number;
  left: number;
  /** Metres driven with the passenger aboard. */
  driven: number;
  lastX: number;
  lastZ: number;
  /** The cab's health when they got in (what's lost since costs the careful-driving tip). */
  health0: number;
  boardT: number;
  /** Where they walk to get in. */
  doorX: number;
  doorZ: number;
}

interface Shift {
  cab: Vehicle;
  fares: number;
  earned: number;
  tips: number;
  failed: number;
  fare: Fare | null;
  nextT: number;
  /** Seconds out of the cab. */
  away: number;
  /** Has been in the cab at least once. */
  boarded: boolean;
  lastPlace: string;
  /** The best shift before this one (to call a new best). */
  bestBefore: number;
}

/** A passenger who's just got out (or given up), walking off before they vanish. */
interface Leaver extends Rider {
  t: number;
  /** Walk to the kerb first, then on to the place. */
  path: { x: number; z: number }[];
}

export class Taxi implements Activity {
  readonly id = 'taxi';
  private built = false;
  private record: TaxiRecord = emptyRecord();
  private shift: Shift | null = null;
  /** The last shift's cab, cleared away once you're well clear of it. */
  private oldCab: Vehicle | null = null;
  private cabs = 0;
  private stops: Stop[] = [];
  /** Kerbs for your own businesses, found once each. */
  private bizStops = new Map<string, Stop | null>();
  private leavers: Leaver[] = [];
  private ground!: Ground;
  private rng = mulberry32((Date.now() & 0xffff) + 77);
  private front = new THREE.Vector3();
  private t = 0;
  // The ring.
  private ring!: THREE.Group;
  private ringTorus!: THREE.Mesh;
  private wallMat!: THREE.MeshBasicMaterial;
  // HUD.
  private hud: HTMLDivElement;
  private hudCount: HTMLSpanElement;
  private hudStatus: HTMLDivElement;
  private hudMeter: HTMLElement;
  private hudMeterBox: HTMLDivElement;
  private hudTime: HTMLElement;
  private hudTimeLabel: HTMLElement;
  private hudTimeBox: HTMLDivElement;
  private hudWarn: HTMLDivElement;
  private card: HTMLDivElement;
  private cardT = 0;

  constructor(readonly game: Game) {
    this.hud = el(
      'div',
      'taxi-hud',
      '<div class="tx-head"><span class="tx-tag">SUNSHINE CABS</span><span class="tx-count"></span></div>' +
        '<div class="tx-status"></div>' +
        '<div class="tx-row"><div class="tx-box tx-meter"><small>METER</small><b></b></div><div class="tx-box tx-time"><small>TIME</small><b></b></div></div>' +
        '<div class="tx-warn"></div>',
    );
    this.hudCount = this.hud.querySelector('.tx-count')!;
    this.hudStatus = this.hud.querySelector('.tx-status')!;
    this.hudMeterBox = this.hud.querySelector('.tx-meter')!;
    this.hudMeter = this.hudMeterBox.querySelector('b')!;
    this.hudTimeBox = this.hud.querySelector('.tx-time')!;
    this.hudTime = this.hudTimeBox.querySelector('b')!;
    this.hudTimeLabel = this.hudTimeBox.querySelector('small')!;
    this.hudWarn = this.hud.querySelector('.tx-warn')!;
    this.card = el('div', 'taxi-card');
    game.uiRoot.append(this.hud, this.card);
  }

  // ---------------------------------------------------------------- building

  private build(): void {
    this.built = true;
    const g = this.game;
    const w = g.world;
    this.ground = {
      roads: w.terrain.roads,
      lots: w.terrain.lots,
      isLand: (x, z) => w.terrain.isLand(x, z),
      blocked: (x, z) => w.collision.blocked(x, z, 0.45, w.groundY(x, z) + 0.2, 1.6),
    };
    this.stops = [...PLACES, ...hotelPlaces(w.terrain.lots)].map((p) => placeStop(this.ground, p)).filter((s): s is Stop => !!s);
    this.buildStand();
    this.buildRing();
  }

  private buildStand(): void {
    const g = this.game;
    const y = g.world.groundY(STAND.x, STAND.z);
    // The kiosk in its own frame: +z faces the street, x runs along the kerb.
    const group = new THREE.Group();
    group.position.set(STAND.x, y, STAND.z);
    group.rotation.y = STAND.yaw;
    const k = new Kit();
    const glow = new Kit();
    const cream = 0xfff4dc;
    k.box(4.6, 0.16, 3.4, 0xb8b4aa, { y: 0.08, z: -0.2 });
    k.box(3.6, 2.5, 2.4, cream, { y: 1.41, z: -0.4 });
    k.box(3.64, 0.36, 2.44, YELLOW, { y: 2.48, z: -0.4 });
    // A yellow roof with a chequered taxi band along its front edge.
    k.box(4.4, 0.24, 3.4, YELLOW, { y: 2.78, z: -0.2 }, 'shiny');
    for (let i = 0; i < 16; i++) {
      for (let r = 0; r < 2; r++) k.box(0.275, 0.12, 0.04, (i + r) % 2 ? 0x15151a : 0xffffff, { x: -2.2 + (i + 0.5) * 0.275, y: 2.72 + r * 0.12 - 0.06, z: 1.52 });
    }
    // The window and its ledge, a door at the side.
    k.box(2.6, 1.05, 0.06, 0x9ccfe8, { y: 1.65, z: 0.82 }, 'glass');
    k.box(2.9, 0.08, 0.42, 0x2a2a2e, { y: 1.08, z: 0.98 }, 'shiny');
    k.box(0.06, 2.0, 0.9, 0x2a5a8a, { x: -1.83, y: 1.16, z: -0.6 });
    glow.box(2.5, 0.06, 0.9, 0xfff1c8, { y: 2.6, z: 0.95 }, 'glow');
    // The rank sign: a pole at the kerb end with a lit TAXI box, seen from up and down the Strip.
    const px = -2.7;
    const pz = 1.3;
    k.cyl(0.07, 0.08, 3.6, 0x8a8f99, { x: px, y: 1.8, z: pz }, 'shiny', 8);
    k.box(0.5, 0.06, 0.5, 0x8a8f99, { x: px, y: 0.03, z: pz });
    glow.box(0.16, 0.62, 1.5, YELLOW, { x: px, y: 3.75, z: pz }, 'glow');
    // A bench beside the kiosk for the queue.
    k.box(1.8, 0.07, 0.45, 0x8a5a3a, { x: 2.85, y: 0.5, z: 0.5 });
    for (const s of [-1, 1]) k.box(0.08, 0.45, 0.4, 0x2a2a2e, { x: 2.85 + s * 0.8, y: 0.25, z: 0.5 }, 'shiny');
    group.add(k.bake({ shadows: true }), glow.bake());
    // Signs: the company name over the window and TAXI either side of the pole box.
    const name = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 0.66),
      new THREE.MeshBasicMaterial({ map: labelTexture('SUNSHINE CABS', { width: 1024, height: 160, font: 'Lilita One', color: '#15151a', bg: '#ffc21a', size: 104 }), toneMapped: false }),
    );
    name.position.set(0, 3.25, 0.9);
    const back = new THREE.Mesh(new THREE.BoxGeometry(4.24, 0.7, 0.08), new THREE.MeshLambertMaterial({ color: YELLOW }));
    back.position.set(0, 3.25, 0.84);
    const taxiMat = new THREE.MeshBasicMaterial({ map: labelTexture('TAXI', { width: 512, height: 200, font: 'Lilita One', color: '#15151a', bg: '#ffc21a', size: 150 }), toneMapped: false });
    const taxiGeo = new THREE.PlaneGeometry(1.4, 0.55);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(taxiGeo, taxiMat);
      m.position.set(px + s * 0.09, 3.75, pz);
      m.rotation.y = s * Math.PI / 2;
      group.add(m);
    }
    group.add(back, name);
    group.updateMatrixWorld(true);
    g.renderer.scene.add(group);
    // Collision: the kiosk, the pole and the bench (boxes are world-aligned; the kiosk is square to the grid).
    const box = (x0: number, x1: number, z0: number, z1: number, h: number, cam = true): void => {
      const a = group.localToWorld(new THREE.Vector3(x0, 0, z0));
      const b = group.localToWorld(new THREE.Vector3(x1, 0, z1));
      g.world.collision.addBox({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z), minY: y - 1, maxY: y + h, tag: 'taxi', cam });
    };
    box(-1.8, 1.8, -1.6, 0.8, 2.9);
    box(2.0, 3.7, 0.3, 0.7, 0.55, false);
    const pole = group.localToWorld(new THREE.Vector3(px, 0, pz));
    g.world.collision.addCircle({ x: pole.x, z: pole.z, r: 0.15, minY: y - 1, maxY: y + 4, tag: 'taxi' });
    // Use the window.
    this.front.copy(group.localToWorld(new THREE.Vector3(0, 0, 2.0)));
    g.interactions.add({
      id: 'taxi:stand',
      x: this.front.x,
      y,
      z: this.front.z,
      radius: 3.2,
      label: () => (this.shift ? 'End your shift' : 'Start a Sunshine Cabs shift'),
      sub: () => {
        const s = this.shift;
        if (s) return `${s.fares} fare${s.fares === 1 ? '' : 's'} · ${money(s.earned)} this shift`;
        const r = this.record;
        return r.fares ? `Fares across the island · best shift ${money(r.bestShift)}` : 'Fares across the island, on the meter';
      },
      action: () => (this.shift ? this.endShift('') : this.startShift()),
    });
  }

  private buildRing(): void {
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
    g.renderer.scene.add(this.ring);
  }

  // ---------------------------------------------------------------- shifts

  private startShift(): void {
    const g = this.game;
    if (g.combat.wanted > 0) {
      audio.play('error');
      g.hud.toast('Lose the police first: no cab for you while they’re looking', 'bad');
      return;
    }
    this.clearOldCab(true);
    const cab = this.spawnCab();
    this.shift = { cab, fares: 0, earned: 0, tips: 0, failed: 0, fare: null, nextT: 1.5, away: 0, boarded: false, lastPlace: '', bestBefore: this.record.bestShift };
    this.cardT = 0;
    g.setUserWaypoint(cab.pos.x, cab.pos.z, 'Your cab');
    audio.play('objective');
    g.hud.banner('ON SHIFT', 'SUNSHINE CABS', 2200, 'gold');
    g.hud.toast('Your cab is at the kerb: get in to take fares', 'info');
  }

  /** The shift's cab, at the kerb in front of the stand (a little along if something's parked there). */
  private spawnCab(): Vehicle {
    const g = this.game;
    const others = [...g.vehicles.list, ...g.traffic.list];
    let z = STAND.cabZ;
    for (const dz of [0, 7, -7, 14, -14, 21]) {
      z = STAND.cabZ + dz;
      if (!others.some((v) => Math.hypot(v.pos.x - STAND.cabX, v.pos.z - z) < 5.5)) break;
    }
    return g.vehicles.spawn('taxi', STAND.cabX, z, STAND.cabHeading, { id: `sunshine-cab-${++this.cabs}` });
  }

  /** Take away the last shift's cab once nobody's in it (and, unless `now`, once you're well clear). */
  private clearOldCab(now: boolean): void {
    const g = this.game;
    const c = this.oldCab;
    if (!c) return;
    if (!g.vehicles.list.includes(c)) {
      this.oldCab = null;
      return;
    }
    if (g.vehicles.driving === c) return;
    const p = g.player.pos;
    if (!now && Math.hypot(p.x - c.pos.x, p.z - c.pos.z) < 160) return;
    g.vehicles.remove(c);
    this.oldCab = null;
  }

  private endShift(why: string): void {
    const g = this.game;
    const s = this.shift;
    if (!s) return;
    this.shift = null;
    if (s.fare) this.dropRider(s.fare, s.cab, false);
    g.clearUserWaypoint();
    this.oldCab = s.cab;
    const best = s.earned > 0 && s.earned > s.bestBefore;
    audio.play(s.fares ? 'win' : 'objective');
    g.hud.banner('SHIFT OVER', `${s.fares} FARE${s.fares === 1 ? '' : 'S'} · ${money(s.earned)}${best && s.bestBefore > 0 ? ' · NEW BEST' : ''}`, 4200, best ? 'gold' : '');
    if (why) g.hud.toast(why, 'info', 4200);
    this.showCard(s, best);
    g.save();
  }

  private showCard(s: Shift, best: boolean): void {
    const r = this.record;
    this.cardT = CARD_TIME;
    this.card.innerHTML =
      `<div class="tc-tag">SUNSHINE CABS · SHIFT OVER</div>` +
      `<div class="tc-big">${money(s.earned)}</div>` +
      `<div class="tc-rows">` +
      `<div><span>Fares</span><b>${s.fares}</b></div>` +
      `<div><span>Of which tips</span><b>${money(s.tips)}</b></div>` +
      (s.failed ? `<div><span>Fares lost</span><b class="bad">${s.failed}</b></div>` : '') +
      `<div><span>Best shift</span><b>${money(r.bestShift)}${best ? ' ★' : ''}</b></div>` +
      `<div><span>Fares, all time</span><b>${r.fares}</b></div>` +
      `</div>`;
  }

  // ---------------------------------------------------------------- fares

  /** Every place a passenger might ask for: the island's, plus your own open businesses. */
  private destinations(): Stop[] {
    const out = [...this.stops];
    for (const b of this.game.business.owned) {
      const t = b.save.type;
      if (t === 'empty' || t === 'house' || b.save.building > 0) continue;
      const key = `${b.lot.id}:${t}:${b.save.name}`;
      let s = this.bizStops.get(key);
      if (s === undefined) {
        const place: Place = { id: `biz:${b.lot.id}`, name: b.save.name, icon: b.def?.icon ?? '🏢', lot: b.lot.id };
        s = placeStop(this.ground, place);
        this.bizStops.set(key, s);
      }
      if (s) out.push(s);
    }
    return out;
  }

  private offerFare(s: Shift): void {
    const g = this.game;
    const c = s.cab.pos;
    const kerb = pickupKerb(this.ground, c.x, c.z, this.rng);
    const stop = kerb ? chooseStop(this.destinations(), kerb, this.rng, s.lastPlace) : null;
    if (!kerb || !stop) {
      s.nextT = 5;
      return;
    }
    const look = randomAppearance(this.rng, this.rng() < 0.35 ? 'gambler' : 'civilian');
    const model = new CharacterModel(look);
    const anim = new Animator(model);
    anim.pose = 'idle';
    const pos = new THREE.Vector3(kerb.px, this.game.world.groundY(kerb.px, kerb.pz), kerb.pz);
    model.root.position.copy(pos);
    model.root.rotation.y = kerb.yaw;
    g.renderer.scene.add(model.root);
    const crow = Math.hypot(stop.kerb.x - kerb.x, stop.kerb.z - kerb.z);
    const limit = timeLimit(crow);
    const dist = Math.hypot(kerb.x - c.x, kerb.z - c.z);
    s.fare = {
      kerb, stop, phase: 'waiting', rider: { model, anim, pos, yaw: kerb.yaw },
      wait: waitLimit(dist), crow, limit, left: limit, driven: 0, lastX: 0, lastZ: 0, health0: s.cab.health, boardT: 0, doorX: 0, doorZ: 0,
    };
    g.setUserWaypoint(kerb.x, kerb.z, 'Passenger');
    audio.play('objective');
    g.hud.toast(`A fare is waiting on ${this.roadName(kerb.road)}`, 'info');
  }

  private roadName(id: string): string {
    return this.ground.roads.find((r) => r.road.id === id)?.road.name ?? 'the kerb';
  }

  private updateShift(dt: number): void {
    const g = this.game;
    const s = this.shift!;
    const cab = s.cab;
    if (!g.vehicles.list.includes(cab)) return this.endShift('Your cab is gone');
    const inCab = g.vehicles.driving === cab;
    if (inCab) {
      s.away = 0;
      if (!s.boarded) {
        s.boarded = true;
        g.clearUserWaypoint();
      }
    } else {
      s.away += dt;
      if (s.away > (s.boarded ? AWAY_LIMIT : FIRST_LIMIT)) return this.endShift(s.boarded ? 'You left the cab: the shift is over' : 'You never got in the cab: the shift is over');
    }
    const f = s.fare;
    if (!f) {
      if (!inCab || g.combat.wanted > 0) return;
      s.nextT -= dt;
      if (s.nextT <= 0) this.offerFare(s);
      return;
    }
    if (g.player.mode === 'dead') return this.failFare(s, 'Knocked out: the fare is off');
    if (g.combat.wanted > 0) return this.failFare(s, f.phase === 'riding' ? 'Your passenger bailed out: not with the police on your tail' : 'Fare cancelled: no passengers with the police after you');
    const near = Math.hypot(cab.pos.x - (f.phase === 'riding' ? f.stop.kerb.x : f.kerb.x), cab.pos.z - (f.phase === 'riding' ? f.stop.kerb.z : f.kerb.z));
    const stopped = inCab && near < RING_R + 0.5 && Math.abs(cab.speed) < STOP_SPEED;
    const r = f.rider;
    if (f.phase === 'waiting') {
      f.wait -= dt;
      if (f.wait <= 0) return this.failFare(s, 'Too slow: the passenger found another ride');
      const toCab = Math.hypot(cab.pos.x - r.pos.x, cab.pos.z - r.pos.z);
      r.anim.pose = toCab < WAVE_RANGE && inCab ? 'wave' : 'idle';
      r.anim.speed = 0;
      if (stopped && toCab < BOARD_RANGE) {
        f.phase = 'boarding';
        f.boardT = 0;
        // Round to the cab's door on their side of it.
        const fx = Math.sin(cab.heading);
        const fz = Math.cos(cab.heading);
        const side = (r.pos.x - cab.pos.x) * -fz + (r.pos.z - cab.pos.z) * fx > 0 ? 1 : -1;
        f.doorX = cab.pos.x - fz * side * (cab.def.W / 2 + 0.35) - fx * 0.5;
        f.doorZ = cab.pos.z + fx * side * (cab.def.W / 2 + 0.35) - fz * 0.5;
        r.anim.pose = 'idle';
      }
    } else if (f.phase === 'boarding') {
      f.boardT += dt;
      if (!inCab || Math.abs(cab.speed) > 3.5 || Math.hypot(cab.pos.x - r.pos.x, cab.pos.z - r.pos.z) > BOARD_RANGE + 2) {
        // Drove off: back to the kerb to wait.
        f.phase = 'waiting';
        r.pos.set(f.kerb.px, g.world.groundY(f.kerb.px, f.kerb.pz), f.kerb.pz);
        r.yaw = f.kerb.yaw;
        r.anim.speed = 0;
        return;
      }
      this.walk(r, f.doorX, f.doorZ, Math.max(1.6, Math.hypot(f.doorX - r.pos.x, f.doorZ - r.pos.z) / Math.max(0.2, BOARD_TIME - f.boardT)), dt);
      if (f.boardT >= BOARD_TIME) this.pickUp(s, f);
    } else {
      f.left -= dt;
      // The meter runs on the road the cab covers (a jump, like a respawn, doesn't count).
      const step = Math.hypot(cab.pos.x - f.lastX, cab.pos.z - f.lastZ);
      if (step < 60) f.driven += step;
      f.lastX = cab.pos.x;
      f.lastZ = cab.pos.z;
      if (f.left <= 0) return this.failFare(s, 'Out of time: your passenger got out to walk');
      if (stopped) this.dropOff(s, f);
    }
  }

  private pickUp(s: Shift, f: Fare): void {
    const g = this.game;
    f.phase = 'riding';
    f.rider.model.root.visible = false;
    f.health0 = s.cab.health;
    f.driven = 0;
    f.lastX = s.cab.pos.x;
    f.lastZ = s.cab.pos.z;
    f.left = f.limit;
    g.setUserWaypoint(f.stop.kerb.x, f.stop.kerb.z, f.stop.place.name);
    audio.play('ping');
    const d = f.crow > 1000 ? `${(f.crow / 1000).toFixed(1)} km` : `${Math.round(f.crow / 10) * 10} m`;
    g.hud.toast(`${f.stop.place.icon} To ${f.stop.place.name} · ${d} · ${clock(f.limit)} on the clock`, 'info', 4200);
  }

  private dropOff(s: Shift, f: Fare): void {
    const g = this.game;
    const damage = Math.max(0, f.health0 - s.cab.health);
    const pay = payment(f.driven, f.crow, f.limit - f.left, f.limit, damage);
    const tips = pay.speedTip + pay.careTip;
    s.fares++;
    s.earned += pay.total;
    s.tips += tips;
    s.lastPlace = f.stop.place.id;
    const r = this.record;
    r.fares++;
    r.earned += pay.total;
    r.bestShift = Math.max(r.bestShift, s.earned);
    r.bestFares = Math.max(r.bestFares, s.fares);
    g.stats.taxiFares = (g.stats.taxiFares ?? 0) + 1;
    g.addMoney(pay.total, 'for a fare');
    const why = [pay.speedTip > 0 ? 'quick ride' : '', pay.careTip > 0 ? (damage < 0.5 ? 'not a scratch' : 'mostly smooth') : ''].filter(Boolean).join(', ');
    g.hud.toast(tips > 0 ? `Meter ${money(pay.fare)} + ${money(tips)} tip (${why})` : `Meter ${money(pay.fare)}, no tip: too slow and too bumpy`, tips > 0 ? 'good' : 'info', 4200);
    audio.play('cash');
    this.dropRider(f, s.cab, true);
    s.fare = null;
    s.nextT = NEXT_FARE;
    g.clearUserWaypoint();
    g.save();
  }

  private failFare(s: Shift, why: string): void {
    const g = this.game;
    const f = s.fare;
    if (!f) return;
    s.fare = null;
    s.failed++;
    s.nextT = NEXT_FARE + 2;
    this.dropRider(f, s.cab, false);
    g.clearUserWaypoint();
    audio.play('error');
    g.hud.toast(why, 'bad', 3800);
  }

  /**
   * The passenger walks off: out of the cab (onto the kerb and off to the place when they've
   * arrived, else just away from the road) or, if they never got in, off along the pavement.
   */
  private dropRider(f: Fare, cab: Vehicle | null, arrived: boolean): void {
    const r = f.rider;
    const g = this.game;
    const path: { x: number; z: number }[] = [];
    if (f.phase === 'riding') {
      if (!cab) {
        r.model.root.removeFromParent();
        r.model.dispose();
        return;
      }
      const k = f.stop.kerb;
      const fx = Math.sin(cab.heading);
      const fz = Math.cos(cab.heading);
      // Out of the kerbside door, or the passenger side (the right) if not at the kerb.
      let ox = -fz;
      let oz = fx;
      if (arrived) {
        const l = Math.hypot(k.px - k.x, k.pz - k.z) || 1;
        ox = (k.px - k.x) / l;
        oz = (k.pz - k.z) / l;
      }
      const out = cab.def.W / 2 + 0.35;
      const sx = cab.pos.x + ox * out;
      const sz = cab.pos.z + oz * out;
      r.pos.set(sx, g.world.groundY(sx, sz, cab.pos.y + 1.5), sz);
      r.yaw = Math.atan2(ox, oz);
      path.push({ x: sx + ox * 2.8, z: sz + oz * 2.8 });
      path.push(arrived ? { x: f.stop.goX, z: f.stop.goZ } : { x: sx + ox * 12, z: sz + oz * 12 });
    } else {
      // Off along the pavement.
      const ax = Math.cos(f.kerb.yaw);
      const az = -Math.sin(f.kerb.yaw);
      path.push({ x: r.pos.x + ax * 30, z: r.pos.z + az * 30 });
    }
    r.model.root.visible = true;
    r.anim.pose = 'idle';
    this.leavers.push({ ...r, t: LEAVE_TIME, path });
  }

  /** Walk a rider towards (x, z) at `speed` m/s; true once there. */
  private walk(r: Rider, x: number, z: number, speed: number, dt: number): boolean {
    const dx = x - r.pos.x;
    const dz = z - r.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) {
      r.anim.speed = 0;
      return true;
    }
    const step = Math.min(d, speed * dt);
    r.pos.x += (dx / d) * step;
    r.pos.z += (dz / d) * step;
    r.pos.y = this.game.world.groundY(r.pos.x, r.pos.z, r.pos.y + 1.5);
    r.yaw = dampAngle(r.yaw, Math.atan2(dx, dz), 10, dt);
    r.anim.speed = speed;
    return false;
  }

  private updateLeavers(dt: number): void {
    for (let i = this.leavers.length - 1; i >= 0; i--) {
      const l = this.leavers[i];
      l.t -= dt;
      const next = l.path[0];
      if (next && this.walk(l, next.x, next.z, 1.5, dt)) l.path.shift();
      if (!next) l.anim.speed = 0;
      if (l.t <= 0) {
        l.model.root.removeFromParent();
        l.model.dispose();
        this.leavers.splice(i, 1);
      }
    }
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
      this.updateLeavers(dt);
      if (!this.shift) this.clearOldCab(false);
      this.cardT = Math.max(0, this.cardT - dt);
    }
    this.draw(playing, dt);
  }

  private draw(playing: boolean, dt: number): void {
    const g = this.game;
    const s = this.shift;
    const f = s?.fare ?? null;
    // The ring: at the passenger's kerb, then at the drop-off.
    const target = f ? (f.phase === 'riding' ? f.stop.kerb : f.kerb) : null;
    this.ring.visible = !!target;
    if (target) {
      this.ring.position.set(target.x, g.world.groundY(target.x, target.z), target.z);
      const pulse = 1 + Math.sin(this.t * 3) * 0.04;
      this.ringTorus.scale.set(pulse, pulse, 1);
      const cab = s!.cab;
      const inside = Math.hypot(cab.pos.x - target.x, cab.pos.z - target.z) < RING_R + 2;
      this.wallMat.opacity += ((inside ? 0.12 : 0.4) - this.wallMat.opacity) * Math.min(1, dt * 5);
    }
    // The people: the one waiting (or getting in) and anyone walking off.
    const cam = g.renderer.camera.position;
    const riders: Rider[] = this.leavers.slice();
    if (f && f.phase !== 'riding') riders.push(f.rider);
    for (const r of riders) {
      r.model.root.position.copy(r.pos);
      r.model.root.rotation.y = r.yaw;
      r.model.updateLod(r.pos.distanceTo(cam));
      if (playing && r.model.lod < 2) r.anim.update(dt);
    }
    // HUD.
    this.hud.classList.toggle('on', playing && !!s);
    if (playing && s) this.drawHud(s);
    this.card.classList.toggle('on', playing && this.cardT > 0);
  }

  private drawHud(s: Shift): void {
    const g = this.game;
    const f = s.fare;
    const cab = s.cab;
    const inCab = g.vehicles.driving === cab;
    set(this.hudCount, `${s.fares} fare${s.fares === 1 ? '' : 's'} · ${money(s.earned)}`);
    let status = '';
    let meter = '';
    let timeLabel = 'TIME';
    let time = '';
    let late = false;
    let warn = '';
    let warnKind = '';
    const dist = (x: number, z: number) => {
      const d = Math.hypot(x - cab.pos.x, z - cab.pos.z);
      return d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
    };
    if (!f) {
      status = !s.boarded ? 'Get in your cab at the kerb' : g.combat.wanted > 0 ? 'Lose the police to take fares' : s.nextT > 0.5 ? `Next fare in ${Math.ceil(s.nextT)} s` : 'Finding a fare…';
      meter = money(0);
    } else if (f.phase === 'waiting' || f.phase === 'boarding') {
      status = f.phase === 'boarding' ? 'Your passenger is getting in…' : `Pick up the passenger · ${dist(f.kerb.x, f.kerb.z)}`;
      meter = money(BASE_FARE);
      timeLabel = 'WAITS';
      time = clock(f.wait);
      late = f.wait < 15;
      if (f.phase === 'waiting' && inCab && Math.hypot(cab.pos.x - f.kerb.x, cab.pos.z - f.kerb.z) < RING_R + 6 && Math.abs(cab.speed) >= STOP_SPEED) {
        warn = 'Stop in the ring to let them in';
        warnKind = 'hint';
      }
    } else {
      status = `${f.stop.place.icon} To ${f.stop.place.name} · ${dist(f.stop.kerb.x, f.stop.kerb.z)}`;
      meter = money(meterFare(f.driven, f.crow));
      time = clock(f.left);
      late = f.left < 15;
      if (inCab && Math.hypot(cab.pos.x - f.stop.kerb.x, cab.pos.z - f.stop.kerb.z) < RING_R + 6 && Math.abs(cab.speed) >= STOP_SPEED) {
        warn = 'Stop in the ring to drop them off';
        warnKind = 'hint';
      }
    }
    if (!inCab) {
      const left = (s.boarded ? AWAY_LIMIT : FIRST_LIMIT) - s.away;
      if (s.boarded || left < 20) {
        warn = `Back in the cab in ${Math.max(0, Math.ceil(left))} s or the shift ends`;
        warnKind = '';
      }
    }
    set(this.hudStatus, status);
    set(this.hudMeter, meter);
    set(this.hudTimeLabel, timeLabel);
    set(this.hudTime, time || '–');
    this.hudMeterBox.classList.toggle('idle', !f || f.phase !== 'riding');
    this.hudTimeBox.classList.toggle('late', late);
    set(this.hudWarn, warn);
    this.hudWarn.className = `tx-warn${warn ? ' on' : ''}${warnKind ? ` ${warnKind}` : ''}`;
  }

  // ---------------------------------------------------------------- map and saves

  markers(full: boolean): MapMarker[] {
    if (!this.built) return [];
    full ||= this.game.minimap.big;
    const out: MapMarker[] = [{ x: this.front.x, z: this.front.z, icon: '🚕', color: '#e8a800', label: full ? 'Sunshine Cabs' : undefined, big: full || !!this.shift }];
    const s = this.shift;
    if (s && this.game.vehicles.driving !== s.cab) out.push({ x: s.cab.pos.x, z: s.cab.pos.z, icon: '🚖', color: '#ffc21a', label: full ? 'Your cab' : undefined, big: true });
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

/** A glowing, unlit, see-through material. */
function additive(color: number, opacity: number, map: THREE.Texture | null = null): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, map, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: map ? THREE.DoubleSide : THREE.FrontSide,
  });
}

/** A soft glow: radial (bright rim) for the ring's floor, vertical (fading upwards) for its curtain. */
function glowTexture(radial: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = radial ? g.createRadialGradient(32, 32, 0, 32, 32, 32) : g.createLinearGradient(0, 0, 0, 64);
  if (radial) {
    gr.addColorStop(0, 'rgba(255,255,255,0.06)');
    gr.addColorStop(0.75, 'rgba(255,255,255,0.3)');
    gr.addColorStop(1, 'rgba(255,255,255,0.9)');
  } else {
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(1, 'rgba(255,255,255,0.85)');
  }
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

