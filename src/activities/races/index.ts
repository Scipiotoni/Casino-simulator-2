import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Activity } from '../activity';
import type { MapMarker } from '../../ui/map';
import type { Vehicle } from '../../vehicles/vehicle';
import { labelTexture } from '../../render/signs';
import { audio } from '../../core/audio';
import { el, esc, money } from '../../ui/dom';
import {
  MEDALS, MEDAL_ICON, MEDAL_NAME, ROUTES, buildCourse, formatTime, gateRadius, medalFor, medalRank, payout, readRecords, segmentDistance, splitDelta,
  type Course, type Gate, type Medal, type RaceRecord,
} from './routes';
import './style.css';

/**
 * Street races: time trials along the island's roads. Each route has a glowing start ring on
 * the road (and a flag on the map). Roll into it slowly in a car and the start card comes up
 * with the route, your best and the medal times, then a 3-2-1 countdown (drive off and it's
 * cancelled). Then it's you against the clock: one checkpoint ring at a time, the next one
 * faint behind it, the waypoint on the one you need. Get out, draw the police or go a minute
 * without a checkpoint and the race is over.
 *
 * Medals pay by route length, but only the step up from the best medal you've already won
 * on that route, so a route can't be farmed.
 */

/** Radius of a start ring (m). */
const START_R = 6;
/** Slow enough to line up at the start (m/s). */
const START_SPEED = 7;
/** Show the start card this close to a start, in a car. */
const CARD_RANGE = 25;
/** Start rings further away than this aren't drawn. */
const DRAW_RANGE = 900;
const COUNTDOWN = 3;
/** The race is lost after this long without a checkpoint (s). */
const CP_TIMEOUT = 60;
/** How long the result card stays up after a finish (s). */
const RESULT_TIME = 7;
/** How long a checkpoint's split stays on the HUD (s). */
const SPLIT_TIME = 3;

const PINK = 0xff3d6e;
const AMBER = 0xffb020;
/** The medals in the order of a route's target times. */
const PODIUM = ['gold', 'silver', 'bronze'] as const;

interface StartSite {
  course: Course;
  group: THREE.Group;
  ring: THREE.Mesh;
  flag: THREE.Mesh;
  x: number;
  y: number;
  z: number;
}

interface Run {
  course: Course;
  site: StartSite;
  car: Vehicle;
  phase: 'countdown' | 'racing';
  /** Countdown left, then the race clock. */
  t: number;
  /** Index of the checkpoint to reach. */
  next: number;
  sinceCp: number;
  /** Ground height at each checkpoint. */
  ys: number[];
  /** Race clock at each checkpoint passed. */
  splits: number[];
  /** Where the car was last frame (checkpoints test the line it drove). */
  lastX: number;
  lastZ: number;
  /** Last countdown number beeped. */
  shown: number;
}

interface Result {
  course: Course;
  time: number;
  medal: Medal;
  paid: number;
  best: boolean;
  t: number;
}

interface Hint {
  course: Course;
  text: string;
  kind: string;
}

export class Races implements Activity {
  readonly id = 'races';
  private built = false;
  private courses: Course[] = [];
  private starts: StartSite[] = [];
  private records: Record<string, RaceRecord> = {};
  private run: Run | null = null;
  private result: Result | null = null;
  /** What to say on the card at the start you're at (rebuilt every frame). */
  private hint: Hint | null = null;
  /** A start that has to be left before it can start a race again (after a finish, a fail or a cancel). */
  private lock: StartSite | null = null;
  private t = 0;
  /** "GO!" stays up this long after the countdown. */
  private goT = 0;
  /** The last checkpoint's split against the best run, and how long it stays up. */
  private split = '';
  private splitT = 0;
  // Checkpoint rings: the one to drive through, the faint one after it, the burst when you pass one.
  private gateRing!: THREE.Mesh;
  private gateFilm!: THREE.Mesh;
  private nextRing!: THREE.Mesh;
  private burst!: THREE.Mesh;
  private burstT = 0;
  private gateMat!: THREE.MeshBasicMaterial;
  private finishMat!: THREE.MeshBasicMaterial;
  private burstMat!: THREE.MeshBasicMaterial;
  private finishSign!: THREE.Sprite;
  // HUD.
  private card: HTMLDivElement;
  private cardKey = '';
  private hud: HTMLDivElement;
  private hudName: HTMLDivElement;
  private hudTime: HTMLDivElement;
  private hudCp: HTMLSpanElement;
  private hudTarget: HTMLSpanElement;
  private hudSplit: HTMLDivElement;
  private hudWarn: HTMLDivElement;
  private count: HTMLDivElement;

  constructor(readonly game: Game) {
    this.card = el('div', 'race-card');
    this.hud = el(
      'div',
      'race-hud',
      '<div class="rh-name"></div><div class="rh-time">0:00.00</div><div class="rh-row"><span class="rh-cp"></span><span class="rh-target"></span></div><div class="rh-split"></div><div class="rh-warn"></div>',
    );
    this.hudName = this.hud.querySelector('.rh-name')!;
    this.hudTime = this.hud.querySelector('.rh-time')!;
    this.hudCp = this.hud.querySelector('.rh-cp')!;
    this.hudTarget = this.hud.querySelector('.rh-target')!;
    this.hudSplit = this.hud.querySelector('.rh-split')!;
    this.hudWarn = this.hud.querySelector('.rh-warn')!;
    this.count = el('div', 'race-count');
    game.uiRoot.append(this.card, this.hud, this.count);
  }

  // ---------------------------------------------------------------- building

  private build(): void {
    this.built = true;
    const g = this.game;
    this.courses = ROUTES.map((r) => buildCourse(g.world.terrain.roads, r));
    const checker = checkerTexture();
    // Every start shares its meshes' geometry and materials; only the name differs.
    const ringGeo = new THREE.TorusGeometry(START_R, 0.3, 8, 56);
    const discGeo = new THREE.CircleGeometry(START_R, 48);
    const wallGeo = new THREE.CylinderGeometry(START_R, START_R, 4.5, 48, 1, true);
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 5.2, 8);
    const flagGeo = new THREE.PlaneGeometry(2.4, 1.5);
    flagGeo.translate(1.2, 0, 0);
    const ringMat = additive(PINK, 0.95);
    const discMat = additive(PINK, 0.55, gradientTexture(true));
    const wallMat = additive(PINK, 0.45, gradientTexture(false));
    const poleMat = new THREE.MeshLambertMaterial({ color: 0xd8dce4 });
    const flagMat = new THREE.MeshBasicMaterial({ map: checker, side: THREE.DoubleSide, toneMapped: false });
    for (const c of this.courses) {
      const s = c.start;
      const y = g.world.groundY(s.x, s.z);
      const group = new THREE.Group();
      group.position.set(s.x, y, s.z);
      group.rotation.y = Math.atan2(s.dx, s.dz);
      // A ring on the road, a glow inside it and a curtain of light rising from it.
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.25;
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.12;
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.y = 2.25;
      // A chequered flag on a pole at the right-hand kerb, and the route's name above the ring.
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(-START_R - 0.6, 2.6, 0);
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.set(-START_R - 0.6, 4.4, 0);
      const name = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: labelTexture(c.route.name.toUpperCase(), { width: 1024, height: 160, font: 'Lilita One', size: 92, color: '#ffffff', bg: '#e8285c', radius: 40 }),
          toneMapped: false,
          depthWrite: false,
        }),
      );
      name.scale.set(9, 1.4, 1);
      name.position.y = 6.6;
      group.add(ring, disc, wall, pole, flag, name);
      g.renderer.scene.add(group);
      this.starts.push({ course: c, group, ring, flag, x: s.x, y, z: s.z });
    }
    // Checkpoint rings (unit radius, scaled per checkpoint): stand across the road, facing the way you drive.
    const torus = new THREE.TorusGeometry(1, 0.06, 10, 64);
    this.gateMat = additive(AMBER, 0.95);
    const finishTex = checker.clone();
    finishTex.repeat.set(16, 1);
    finishTex.needsUpdate = true;
    this.finishMat = new THREE.MeshBasicMaterial({ map: finishTex, toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false });
    this.gateRing = new THREE.Mesh(torus, this.gateMat);
    this.gateFilm = new THREE.Mesh(new THREE.CircleGeometry(1, 48), additive(AMBER, 0.12, null, true));
    this.gateRing.add(this.gateFilm);
    this.nextRing = new THREE.Mesh(torus, additive(AMBER, 0.28));
    this.burstMat = additive(0xfff0b0, 1);
    this.burst = new THREE.Mesh(torus, this.burstMat);
    this.finishSign = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: labelTexture('FINISH', { width: 512, height: 128, font: 'Lilita One', size: 96, color: '#ffffff', bg: '#111318', radius: 24, border: '#ffffff' }),
        toneMapped: false,
        depthWrite: false,
      }),
    );
    this.finishSign.scale.set(5, 1.25, 1);
    for (const m of [this.gateRing, this.nextRing, this.burst, this.finishSign]) {
      m.visible = false;
      g.renderer.scene.add(m);
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
      this.hint = null;
      if (this.run) this.updateRun(dt);
      else this.updateStarts();
      if (this.result) {
        this.result.t -= dt;
        if (this.result.t <= 0) this.result = null;
      }
      this.goT = Math.max(0, this.goT - dt);
      this.splitT = Math.max(0, this.splitT - dt);
      this.burstT = Math.max(0, this.burstT - dt);
    }
    this.draw(playing);
  }

  /** Not racing: watch the start rings (and say what to do at the nearest one). */
  private updateStarts(): void {
    const g = this.game;
    const v = g.vehicles.driving;
    const car = v && !v.isBoat ? v : null;
    const p = v ? v.pos : g.player.pos;
    if (this.lock && Math.hypot(p.x - this.lock.x, p.z - this.lock.z) > START_R + 4) this.lock = null;
    let near: StartSite | null = null;
    let nd = Infinity;
    for (const s of this.starts) {
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d < nd && Math.abs(p.y - s.y) < 6) {
        nd = d;
        near = s;
      }
    }
    if (!near || (v && v.isBoat)) return;
    const inside = nd < START_R;
    if (car ? nd > CARD_RANGE : !inside) return;
    const site = near;
    const say = (text: string, kind = ''): void => {
      this.hint = { course: site.course, text, kind };
    };
    if (!car) return say('You need a car to race', 'warn');
    if (!inside) return say('Roll into the ring slowly to start');
    if (this.lock === site) return say('Drive out of the ring and back in to race again');
    if (g.combat.wanted > 0) return say('Lose the police first', 'warn');
    if (Math.abs(car.speed) > START_SPEED) return say('Slow down to line up', 'warn');
    // Lined up: the countdown starts.
    const c = site.course;
    this.run = {
      course: c, site, car, phase: 'countdown', t: COUNTDOWN, next: 0, sinceCp: 0,
      ys: c.gates.map((q) => g.world.groundY(q.x, q.z)), splits: [],
      lastX: car.pos.x, lastZ: car.pos.z, shown: 0,
    };
    this.result = null;
    this.lock = site;
  }

  private updateRun(dt: number): void {
    const r = this.run!;
    const car = r.car;
    const why = this.failReason(r);
    if (why) return r.phase === 'countdown' ? this.stop(null, `Start cancelled: ${why.toLowerCase()}`) : this.stop(`${why}: race over`, '');
    if (r.phase === 'countdown') {
      if (Math.hypot(car.pos.x - r.site.x, car.pos.z - r.site.z) > START_R + 1) return this.stop(null, 'Start cancelled: stay in the ring until GO');
      r.t -= dt;
      const n = Math.ceil(r.t);
      if (n !== r.shown && n > 0) {
        r.shown = n;
        audio.play('keyBeep', { pitch: 0.5 });
      }
      if (r.t <= 0) {
        r.phase = 'racing';
        r.t = 0;
        r.sinceCp = 0;
        r.lastX = car.pos.x;
        r.lastZ = car.pos.z;
        this.goT = 0.9;
        audio.play('keyBeep');
        audio.play('whoosh');
        this.aim(r);
      }
      return;
    }
    r.t += dt;
    r.sinceCp += dt;
    // Checkpoints: anywhere along the line the car drove this frame (it covers metres at speed).
    const gates = r.course.gates;
    while (r.next < gates.length) {
      const q = gates[r.next];
      const d = segmentDistance(r.lastX, r.lastZ, car.pos.x, car.pos.z, q.x, q.z);
      if (d > gateRadius(q) || Math.abs(car.pos.y - r.ys[r.next]) > 10) break;
      this.passed(r, q);
      if (r.next >= gates.length) return this.finish(r);
    }
    r.lastX = car.pos.x;
    r.lastZ = car.pos.z;
    if (r.sinceCp > CP_TIMEOUT) this.stop('Too slow: a minute without a checkpoint', '');
  }

  /** Through a checkpoint: split, sound, burst, and on to the next. */
  private passed(r: Run, q: Gate): void {
    r.splits.push(r.t);
    const best = this.records[r.course.route.id]?.splits;
    if (best && best.length === r.course.gates.length) {
      this.split = splitDelta(r.t, best[r.next]);
      this.splitT = SPLIT_TIME;
    }
    this.burstT = 0.5;
    this.placeGate(this.burst, q, r.ys[r.next]);
    r.next++;
    r.sinceCp = 0;
    if (r.next >= r.course.gates.length) return;
    audio.play('ping', { pitch: r.next === r.course.gates.length - 1 ? 1.25 : 1 });
    this.aim(r);
  }

  /** Why the race (or the countdown) can't go on, if it can't. */
  private failReason(r: Run): string {
    const g = this.game;
    if (g.player.mode === 'dead') return 'Knocked out';
    if (g.vehicles.driving !== r.car || !g.vehicles.list.includes(r.car)) return 'You left the car';
    if (g.combat.wanted > 0) return 'The police are onto you';
    return '';
  }

  /** Point the waypoint at the checkpoint to reach. */
  private aim(r: Run): void {
    const q = r.course.gates[r.next];
    const last = r.next === r.course.gates.length - 1;
    this.game.setUserWaypoint(q.x, q.z, last ? 'Finish' : `Checkpoint ${r.next + 1}/${r.course.gates.length}`);
  }

  /** End a race or countdown early: `fail` is a lost race, `note` a quiet cancel. */
  private stop(fail: string | null, note: string): void {
    const g = this.game;
    const r = this.run;
    this.run = null;
    if (r?.phase === 'racing') g.clearUserWaypoint();
    if (fail) {
      audio.play('error');
      g.hud.toast(fail, 'bad', 3600);
    } else if (note) g.hud.toast(note, 'info');
  }

  private finish(r: Run): void {
    const g = this.game;
    const c = r.course;
    this.run = null;
    g.clearUserWaypoint();
    const time = r.t;
    const medal = medalFor(time, c.route.medals);
    const prev = this.records[c.route.id];
    const paid = payout(prev?.medal, medal, c.length);
    const best = !prev || time < prev.time;
    const top = prev && medalRank(prev.medal) > medalRank(medal) ? prev.medal : medal;
    this.records[c.route.id] = !prev || best ? { time, medal: top, splits: r.splits } : { ...prev, medal: top };
    g.stats.racesFinished = (g.stats.racesFinished ?? 0) + 1;
    const title = medal === 'finish' ? 'FINISHED' : `${MEDAL_NAME[medal].toUpperCase()} MEDAL`;
    g.hud.banner(title, `${formatTime(time)}${best && prev ? ' · NEW BEST' : ''}`, 4200, medal === 'gold' ? 'gold' : '');
    audio.play(medal === 'gold' ? 'bigwin' : medal === 'finish' ? 'objective' : 'win');
    if (paid > 0) g.addMoney(paid, medal === 'finish' ? `for finishing the ${c.route.name}` : `for ${MEDAL_NAME[medal].toLowerCase()} on the ${c.route.name}`);
    else if (prev) g.hud.toast(prev.medal === 'gold' ? 'Gold already won here: racing for the record now' : `No prize: beat your ${MEDAL_NAME[prev.medal].toLowerCase()} to earn more`, 'info', 4200);
    this.result = { course: c, time, medal, paid, best, t: RESULT_TIME };
    this.lock = r.site;
    g.save();
  }

  // ---------------------------------------------------------------- drawing

  private draw(playing: boolean): void {
    const g = this.game;
    const r = this.run;
    const racing = r?.phase === 'racing';
    // Start rings: pulse; hidden while racing and when far away.
    const v = g.vehicles.driving;
    const p = v ? v.pos : g.player.pos;
    const pulse = 1 + Math.sin(this.t * 3) * 0.04;
    for (const s of this.starts) {
      s.group.visible = !racing && Math.abs(p.x - s.x) < DRAW_RANGE && Math.abs(p.z - s.z) < DRAW_RANGE;
      if (!s.group.visible) continue;
      s.ring.scale.set(pulse, pulse, 1);
      s.flag.rotation.y = Math.sin(this.t * 2.3 + s.x) * 0.25;
    }
    // Checkpoint rings.
    const gates = r && racing ? r.course.gates : null;
    const cur = gates ? gates[r!.next] : null;
    const after = gates ? gates[r!.next + 1] ?? null : null;
    this.placeGate(this.gateRing, cur, cur ? r!.ys[r!.next] : 0);
    this.placeGate(this.nextRing, after, after ? r!.ys[r!.next + 1] : 0);
    const isFinish = !!cur && r!.next === gates!.length - 1;
    this.gateRing.material = isFinish ? this.finishMat : this.gateMat;
    this.gateFilm.visible = !isFinish;
    this.gateRing.rotation.z = isFinish ? this.t * 0.4 : 0;
    this.finishSign.visible = isFinish;
    if (isFinish) this.finishSign.position.set(this.gateRing.position.x, this.gateRing.position.y + this.gateRing.scale.x + 1.4, this.gateRing.position.z);
    this.gateMat.opacity = 0.8 + Math.sin(this.t * 6) * 0.15;
    // The burst: the ring just passed swells and fades.
    this.burst.visible = this.burstT > 0;
    if (this.burst.visible) {
      const k = 1 - this.burstT / 0.5;
      this.burstMat.opacity = 1 - k;
      this.burst.scale.multiplyScalar(1 + 0.04 * (1 - k));
    }
    // HUD.
    this.hud.classList.toggle('on', playing && racing);
    if (playing && r && racing) this.drawHud(r);
    const counting = playing && r?.phase === 'countdown';
    const label = counting ? String(Math.max(1, Math.ceil(r!.t))) : playing && this.goT > 0 ? 'GO!' : '';
    if (this.count.dataset.n !== label) {
      this.count.dataset.n = label;
      this.count.textContent = label;
      this.count.classList.remove('pop');
      if (label) {
        void this.count.offsetWidth;
        this.count.classList.add('pop');
      }
    }
    this.count.classList.toggle('on', !!label);
    this.count.classList.toggle('go', label === 'GO!');
    // The card: the countdown's, a result just in, or what to do at the nearest start.
    if (!playing || racing) this.showCard(null, '');
    else if (r) this.showCard(r.course, 'Get ready…', 'go');
    else if (this.result) this.showResult(this.result);
    else if (this.hint) this.showCard(this.hint.course, this.hint.text, this.hint.kind);
    else this.showCard(null, '');
  }

  private placeGate(m: THREE.Object3D, q: Gate | null, y: number): void {
    m.visible = !!q;
    if (!q) return;
    const R = Math.max(6.5, Math.min(9.5, q.half + 1.5));
    m.position.set(q.x, y + R * 0.72, q.z);
    m.rotation.set(0, Math.atan2(q.dx, q.dz), m.rotation.z);
    m.scale.setScalar(R);
  }

  private drawHud(r: Run): void {
    const c = r.course;
    const n = c.gates.length;
    if (this.hudName.textContent !== c.route.name) this.hudName.textContent = c.route.name;
    this.hudTime.textContent = formatTime(r.t);
    const cp = r.next === n - 1 ? 'FINAL STRETCH' : `CHECKPOINT ${r.next + 1}/${n}`;
    if (this.hudCp.textContent !== cp) this.hudCp.textContent = cp;
    // The best medal still in reach, else your best time.
    const k = c.route.medals.findIndex((t) => r.t <= t);
    const best = this.records[c.route.id];
    const target = k >= 0 ? `${MEDAL_ICON[PODIUM[k]]} ${formatTime(c.route.medals[k])}` : best ? `BEST ${formatTime(best.time)}` : '';
    if (this.hudTarget.textContent !== target) this.hudTarget.textContent = target;
    const split = this.splitT > 0 ? this.split : '';
    if (this.hudSplit.textContent !== split) {
      this.hudSplit.textContent = split;
      this.hudSplit.className = `rh-split${split ? (split.startsWith('-') ? ' ahead' : ' behind') : ''}`;
    }
    const left = CP_TIMEOUT - r.sinceCp;
    const warn = left < 15 ? `Checkpoint in ${Math.ceil(left)} s or you're out` : '';
    if (this.hudWarn.textContent !== warn) this.hudWarn.textContent = warn;
    this.hudWarn.classList.toggle('on', !!warn);
  }

  /** The start card: route, best, medal times and what each would pay now, and a line on what to do. */
  private showCard(c: Course | null, hint: string, kind = ''): void {
    const key = c ? `${c.route.id}|${hint}|${kind}` : '';
    if (key === this.cardKey) return;
    this.cardKey = key;
    this.card.classList.toggle('on', !!c);
    this.card.classList.remove('result');
    if (!c) return;
    const rec = this.records[c.route.id];
    const won = medalRank(rec?.medal);
    const rows = PODIUM.map((m, i) => {
      const got = won >= MEDALS.indexOf(m);
      return `<div class="rc-m ${m}${got ? ' got' : ''}"><span class="i">${MEDAL_ICON[m]}</span><span class="t">${formatTime(c.route.medals[i])}</span><span class="p">${got ? 'WON' : money(payout(rec?.medal, m, c.length))}</span></div>`;
    });
    const best = rec ? `<div class="rc-best">Best <b>${formatTime(rec.time)}</b> ${MEDAL_ICON[rec.medal]}</div>` : '<div class="rc-best">No time set yet</div>';
    this.card.innerHTML =
      `<div class="rc-tag">🏁 STREET RACE</div><div class="rc-name">${esc(c.route.name)}</div>` +
      `<div class="rc-sub">${esc(c.route.blurb)}</div>` +
      `<div class="rc-facts">${(c.length / 1000).toFixed(1)} km · ${c.gates.length} checkpoints${c.route.loop ? ' · loop' : ''}</div>` +
      best +
      `<div class="rc-ms">${rows.join('')}</div>` +
      (hint ? `<div class="rc-hint ${kind}">${esc(hint)}</div>` : '');
  }

  private showResult(res: Result): void {
    const key = `result|${res.course.route.id}|${res.time}`;
    if (key === this.cardKey) return;
    this.cardKey = key;
    const rec = this.records[res.course.route.id];
    this.card.classList.add('on', 'result');
    this.card.innerHTML =
      `<div class="rc-tag">🏁 ${esc(res.course.route.name.toUpperCase())}</div>` +
      `<div class="rc-medal ${res.medal}">${MEDAL_ICON[res.medal]} ${MEDAL_NAME[res.medal].toUpperCase()}</div>` +
      `<div class="rc-time">${formatTime(res.time)}</div>` +
      `<div class="rc-best">${res.best ? 'New best time' : `Best <b>${formatTime(rec?.time ?? res.time)}</b>`}</div>` +
      `<div class="rc-hint ${res.paid > 0 ? 'go' : ''}">${res.paid > 0 ? `Prize ${money(res.paid)}` : 'No prize this time'}</div>`;
  }

  // ---------------------------------------------------------------- map and saves

  markers(full: boolean): MapMarker[] {
    const r = this.run;
    if (r && r.phase === 'racing') {
      // The waypoint marks the checkpoint to reach; show the one after it and the finish.
      const gs = r.course.gates;
      const out: MapMarker[] = [];
      const q = gs[r.next + 1];
      if (q && r.next + 1 < gs.length - 1) out.push({ x: q.x, z: q.z, icon: String(r.next + 2), color: 'rgba(255,176,32,0.6)' });
      const f = gs[gs.length - 1];
      if (r.next < gs.length - 1) out.push({ x: f.x, z: f.z, icon: '🏁', color: '#e8285c', label: 'Finish', big: full });
      return out;
    }
    return this.starts.map((s) => {
      const rec = this.records[s.course.route.id];
      return { x: s.x, z: s.z, icon: '🏁', color: '#e8285c', big: full, label: full ? `${s.course.route.name}${rec ? ` ${MEDAL_ICON[rec.medal]}` : ''}` : undefined };
    });
  }

  save(): unknown {
    return { best: this.records };
  }

  load(data: unknown): void {
    this.records = readRecords(data);
    this.run = null;
    this.result = null;
    this.cardKey = '';
  }
}

// ------------------------------------------------------------------ materials and textures

/** A glowing, unlit, see-through material (adds light rather than covering what's behind). */
function additive(color: number, opacity: number, map: THREE.Texture | null = null, doubleSided = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, map, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    side: doubleSided || map ? THREE.DoubleSide : THREE.FrontSide,
  });
}

/** Black and white squares, for the flag and the finish ring. */
function checkerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? '#111318' : '#f4f4f4';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** A soft glow: radial (bright rim, clear middle) for the ring's floor, or vertical (fading upwards) for its curtain. */
function gradientTexture(radial: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = radial ? g.createRadialGradient(32, 32, 0, 32, 32, 32) : g.createLinearGradient(0, 0, 0, 64);
  if (radial) {
    gr.addColorStop(0, 'rgba(255,255,255,0.08)');
    gr.addColorStop(0.75, 'rgba(255,255,255,0.35)');
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
