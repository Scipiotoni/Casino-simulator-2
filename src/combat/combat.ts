import * as THREE from 'three';
import type { Game } from '../game/game';
import { GUNS, gunDef, type GunDef } from './guns';
import { buildGun } from './gunModel';
import { Gunman } from './gunman';
import { randomAppearance } from '../chars/skins';
import { mulberry32 } from '../core/noise';
import { audio } from '../core/audio';
import { el } from '../ui/dom';

/** Anything bullets can hit (soldiers, police, people on the street). */
export interface Hittable {
  pos: THREE.Vector3;
  radius: number;
  height: number;
  alive: boolean;
  hit(dmg: number, head: boolean, fromX: number, fromZ: number): void;
}

export const MAX_HP = 100;

/**
 * Guns and getting shot. Hitscan from the centre of the screen (so what's under the
 * crosshair is what you hit), tracers from the muzzle, Fortnite-style damage numbers and
 * hit markers. Your health regenerates out of combat; a knockout sends you to the
 * hospital (or, with the police after you, to a cell and a fine).
 */
export class Combat {
  owned: string[] = [];
  current: string | null = null;
  ammo: Record<string, number> = {};
  hp = MAX_HP;
  wanted = 0;
  private wantedT = 0;
  private hurtT = 99;
  private cooldown = 0;
  private reloadT = 0;
  private trigger = false;
  private gun: { group: THREE.Group; muzzle: THREE.Object3D } | null = null;
  readonly targets = new Set<Hittable>();
  readonly police: Gunman[] = [];
  private policeT = 0;
  private tracers: { line: THREE.Line; life: number }[] = [];
  private flash: THREE.Mesh;
  private flashT = 0;
  private hud: HTMLDivElement;
  private ammoEl: HTMLDivElement;
  private hpEl: HTMLDivElement;
  private starsEl: HTMLDivElement;
  private hitEl: HTMLDivElement;
  private vignette: HTMLDivElement;
  private nums: { el: HTMLDivElement; pos: THREE.Vector3; t: number }[] = [];
  private ray = new THREE.Vector3();
  private org = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private rng = mulberry32(99);
  aimK = 0;
  koT = 0;

  constructor(private game: Game, parent: HTMLElement) {
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffe08a, toneMapped: false, transparent: true }));
    this.flash.visible = false;
    game.renderer.scene.add(this.flash);
    this.hud = el('div', 'combat-hud');
    this.hpEl = el('div', 'hp', '<div class="bar"><i></i></div><span>100</span>');
    this.ammoEl = el('div', 'ammo');
    this.starsEl = el('div', 'stars');
    this.hitEl = el('div', 'hitmark');
    this.vignette = el('div', 'hurt-vignette');
    this.hud.append(this.hpEl, this.ammoEl);
    this.hud.style.display = 'none';
    parent.append(this.hud, this.starsEl, this.hitEl, this.vignette);
  }

  // ---------------------------------------------------------------- inventory

  give(id: string): void {
    if (!this.owned.includes(id)) this.owned.push(id);
    this.ammo[id] = gunDef(id).mag;
    this.draw(id);
  }

  draw(id: string | null): void {
    const g = this.game;
    if (this.gun) {
      this.gun.group.removeFromParent();
      this.gun = null;
    }
    this.current = id;
    this.reloadT = 0;
    g.camera.armed = !!id;
    g.player.anim.upper = null;
    if (!id) {
      g.hud.setCrosshair(g.player.firstPerson);
      return;
    }
    const def = gunDef(id);
    this.gun = buildGun(def);
    g.player.model.attach(this.gun.group, 'handR');
    g.hud.setCrosshair(true);
    audio.play('reload', { volume: 0.5 });
  }

  /** The player model was rebuilt (new outfit): re-attach the gun. */
  reattach(): void {
    if (this.current) this.draw(this.current);
  }

  get armed(): boolean {
    return !!this.current;
  }

  /** Can enemies shoot at you right now? */
  get targetable(): boolean {
    const p = this.game.player;
    return p.mode === 'walk' && this.game.mode === 'play' && this.koT <= 0;
  }

  // ---------------------------------------------------------------- per frame

  update(dt: number, inputOn: boolean): void {
    const g = this.game;
    const inp = g.input;
    const p = g.player;
    const onFoot = p.mode === 'walk';
    const indoors = !!g.world.venueAt(p.pos.x, p.pos.z);
    if (inputOn && onFoot) {
      for (let i = 0; i < Math.min(7, this.owned.length); i++) {
        if (inp.pressed(`Digit${i + 1}`)) {
          if (indoors) g.hud.toast('No guns indoors', 'bad');
          else this.draw(this.current === this.owned[i] ? null : this.owned[i]);
        }
      }
      if (inp.pressed('KeyQ') && this.current) this.draw(null);
    }
    if (this.current && (!onFoot || indoors)) this.draw(null);
    const def = this.current ? gunDef(this.current) : null;
    // Aim.
    const aiming = !!def && inputOn && inp.mouseDown[2];
    this.aimK += ((aiming ? 1 : 0) - this.aimK) * Math.min(1, dt * 12);
    g.camera.aim = this.aimK;
    g.camera.aimFov = def?.adsFov ?? 50;
    if (def) {
      p.anim.upper = 'aimPistol';
      p.anim.lookPitch = g.camera.pitch + 0.12;
      // Face where the camera looks.
      p.yaw = g.camera.yaw + Math.PI;
      this.cooldown -= dt;
      if (this.reloadT > 0) {
        this.reloadT -= dt;
        if (this.reloadT <= 0) this.ammo[def.id] = def.mag;
      }
      if (inputOn && inp.pressed('KeyR') && this.reloadT <= 0 && (this.ammo[def.id] ?? 0) < def.mag) this.reload(def);
      const down = inputOn && (inp.mouseDown[0] || inp.clicks.some((c) => c.button === 0)) && (inp.locked || g.input.touchMode);
      if (down && (def.auto || !this.trigger)) this.fire(def);
      this.trigger = down;
    }
    // Health regenerates after a few quiet seconds.
    this.hurtT += dt;
    if (this.hurtT > 5 && this.hp < MAX_HP && this.koT <= 0) this.hp = Math.min(MAX_HP, this.hp + dt * 12);
    this.updateWanted(dt);
    for (const c of this.police) c.update(dt, g.renderer.camera.position);
    this.updateFx(dt);
    if (this.koT > 0) {
      this.koT -= dt;
      if (this.koT <= 0) g.respawn(this.wanted > 0);
    }
    this.updateHud();
  }

  private reload(def: GunDef): void {
    this.reloadT = def.reload;
    audio.play('reload');
  }

  private fire(def: GunDef): void {
    const g = this.game;
    if (this.cooldown > 0 || this.reloadT > 0) return;
    const ammo = this.ammo[def.id] ?? 0;
    if (ammo <= 0) {
      audio.play('empty');
      this.reload(def);
      this.cooldown = 0.25;
      return;
    }
    this.ammo[def.id] = ammo - 1;
    this.cooldown = 1 / def.rate;
    const cam = g.renderer.camera;
    const muzzle = this.gun!.muzzle.getWorldPosition(this.tmp.clone());
    audio.play(def.id === 'shotgun' ? 'shotgun' : def.id === 'smg' ? 'smg' : def.id === 'sniper' || def.id === 'goldcannon' || def.id === 'revolver' ? 'gunHeavy' : 'gunshot');
    const spread = def.spread * (1 - this.aimK * 0.6) + Math.min(0.03, Math.hypot(g.player.vel.x, g.player.vel.z) * 0.003);
    let hitAny = false;
    let head = false;
    let ko = false;
    for (let i = 0; i < def.pellets; i++) {
      cam.getWorldDirection(this.ray);
      this.ray.x += (this.rng() - 0.5) * spread * 2;
      this.ray.y += (this.rng() - 0.5) * spread * 2;
      this.ray.z += (this.rng() - 0.5) * spread * 2;
      this.ray.normalize();
      this.org.copy(cam.position);
      // Start the ray at the player, not behind them, so nothing between camera and player counts.
      const skip = this.org.distanceTo(g.player.pos) * 0.9;
      const res = this.trace(this.org, this.ray, def.range + skip, null, skip);
      const end = this.org.clone().addScaledVector(this.ray, res.t);
      this.tracer(muzzle, end, 0xffe8a0);
      if (res.target) {
        const dmg = Math.round(def.dmg * (res.head ? 2 : 1));
        const wasAlive = res.target.alive;
        res.target.hit(dmg, res.head, g.player.pos.x, g.player.pos.z);
        this.damageNumber(end, dmg, res.head);
        hitAny = true;
        head ||= res.head;
        if (wasAlive && !res.target.alive) ko = true;
        this.onHitTarget(res.target);
      } else if (res.t < def.range + skip - 0.01) this.puff(end);
    }
    if (hitAny) {
      audio.play(head ? 'headshot' : 'hitmarker', { volume: 0.7 });
      this.hitEl.className = `hitmark show ${head ? 'head' : ''} ${ko ? 'ko' : ''}`;
      setTimeout(() => (this.hitEl.className = 'hitmark'), 160);
    }
    g.camera.pitch = Math.min(0.9, g.camera.pitch + def.kick * (1 - this.aimK * 0.5));
    this.flash.position.copy(muzzle);
    this.flash.visible = true;
    this.flashT = 0.05;
    // Gunfire on the street is noticed.
    if (!g.world.base.contains(g.player.pos.x, g.player.pos.z)) this.alarmNearby(g.player.pos, 30);
  }

  /** Bullets: the first thing along the ray (target or wall or ground). */
  trace(o: THREE.Vector3, d: THREE.Vector3, max: number, ignore: Hittable | null, minT = 0): { t: number; target: Hittable | null; head: boolean } {
    const g = this.game;
    let best = g.world.collision.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max, false);
    // Ground: march.
    for (let s = Math.max(1, minT); s < best; s += 1.5) {
      const x = o.x + d.x * s;
      const y = o.y + d.y * s;
      const z = o.z + d.z * s;
      if (y < g.world.groundY(x, z, y + 2)) {
        best = s;
        break;
      }
    }
    let target: Hittable | null = null;
    let head = false;
    const consider = (h: Hittable) => {
      if (h === ignore || !h.alive) return;
      const r = rayCapsule(o, d, h.pos, h.radius, h.height);
      if (r !== null && r > minT && r < best) {
        best = r;
        target = h;
        head = o.y + d.y * r > h.pos.y + h.height - 0.34;
      }
    };
    for (const h of this.targets) consider(h);
    for (const c of this.police) consider(c);
    for (const c of g.world.base.soldiers) consider(c);
    for (const c of g.crowd.hittables()) consider(c);
    return { t: best, target, head };
  }

  /** An NPC fires at the player (and maybe hits). */
  npcFire(from: THREE.Vector3, dir: THREE.Vector3, dmg: number): void {
    const g = this.game;
    const p = g.player;
    const max = 120;
    let wall = g.world.collision.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, max, false);
    const t = rayCapsule(from, dir, p.pos, 0.42, 1.8);
    const end = from.clone().addScaledVector(dir, t !== null && t < wall ? t : Math.min(wall, 60));
    this.tracer(from, end, 0xffb070);
    if (t !== null && t < wall && this.targetable) {
      this.damagePlayer(dmg, from.x, from.z);
      wall = t;
    } else if (end.distanceTo(p.pos) < 6) audio.play('whiz', { volume: 0.5 });
  }

  damagePlayer(dmg: number, _fx: number, _fz: number): void {
    const g = this.game;
    if (this.koT > 0) return;
    this.hp -= dmg;
    this.hurtT = 0;
    audio.play('hurt', { volume: 0.6 });
    this.vignette.classList.remove('hit');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('hit');
    g.camera.shake = Math.max(g.camera.shake, 0.25);
    if (this.hp <= 0) {
      this.hp = 0;
      this.knockout();
    }
  }

  private knockout(): void {
    const g = this.game;
    this.koT = 4;
    this.draw(null);
    g.player.mode = 'dead';
    g.player.anim.pose = 'ko';
    g.player.anim.upper = null;
    audio.play(this.wanted > 0 ? 'busted' : 'knockout');
    g.hud.banner(this.wanted > 0 ? 'BUSTED' : 'KNOCKED OUT', this.wanted > 0 ? 'The police take you in' : 'You wake up in hospital', 3600, 'bad');
  }

  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const t = this.game.world.collision.raycast(ax, ay, az, dx / d, dy / d, dz / d, d, false);
    return t >= d - 0.3;
  }

  /** A soldier saw you: everyone near them comes running. */
  onSpotted(by: Gunman): void {
    const g = this.game;
    if (by.faction === 'soldier') {
      for (const s of g.world.base.soldiers) if (s !== by && s.pos.distanceTo(by.pos) < 70) s.alarm();
      g.world.base.raiseAlarm();
    }
  }

  private onHitTarget(t: Hittable): void {
    const g = this.game;
    if (t instanceof Gunman) {
      if (t.faction === 'police') this.crime('shot a police officer', 2);
      else t.alarm();
    } else if (g.crowd.isCivilian(t)) this.crime('shot someone', 1);
  }

  private alarmNearby(p: THREE.Vector3, r: number): void {
    this.game.crowd.panic(p.x, p.z, r);
  }

  // ---------------------------------------------------------------- police

  crime(_what: string, stars: number): void {
    const before = this.wanted;
    this.wanted = Math.min(5, Math.max(this.wanted, 0) + stars);
    this.wantedT = 0;
    if (this.wanted > before) {
      audio.play('siren', { volume: 0.5 });
      this.starsEl.classList.remove('flash');
      void this.starsEl.offsetWidth;
      this.starsEl.classList.add('flash');
    }
  }

  private updateWanted(dt: number): void {
    const g = this.game;
    const p = g.player;
    if (this.wanted <= 0) {
      if (this.police.length) for (const c of this.police.splice(0)) c.dispose();
      return;
    }
    this.wantedT += dt;
    const seen = this.police.some((c) => c.alive && c.alert && c.pos.distanceTo(p.pos) < 40);
    if (seen) this.wantedT = Math.min(this.wantedT, 0);
    if (this.wantedT > 22) {
      this.wanted--;
      this.wantedT = 0;
      if (this.wanted === 0) g.hud.toast('You lost the police', 'good');
    }
    // Keep 2 officers per star around you (on foot, arriving from a distance).
    this.policeT -= dt;
    const want = Math.min(8, this.wanted * 2);
    const alive = this.police.filter((c) => c.alive);
    if (this.policeT <= 0 && alive.length < want && p.mode === 'walk') {
      this.policeT = 3;
      for (let tries = 0; tries < 6; tries++) {
        const a = this.rng() * Math.PI * 2;
        const d = 55 + this.rng() * 25;
        const x = p.pos.x + Math.sin(a) * d;
        const z = p.pos.z + Math.cos(a) * d;
        if (g.world.terrain.heightAt(x, z) < 0.5 || g.world.venueAt(x, z)) continue;
        const ap = randomAppearance(this.rng, 'guard');
        ap.outfit = { ...ap.outfit, top: 'jacket', hat: 'cap', c1: 0x1d3a7a, c2: 0x142a5a, accent: 0xf2c230, pants: 0x15203a, glasses: this.rng() < 0.5 ? 'aviators' : 'none', neck: 'tie' };
        const c = new Gunman(g, ap, 'police', x, z, a + Math.PI, 'pistol');
        c.state = 'alert';
        c.sight = 60;
        this.police.push(c);
        break;
      }
    }
    // Clear out knocked-out officers that are far away.
    for (let i = this.police.length - 1; i >= 0; i--) {
      const c = this.police[i];
      if (!c.alive && c.pos.distanceTo(p.pos) > 90) {
        c.dispose();
        this.police.splice(i, 1);
      }
    }
  }

  /** Lose the police and heal (after a knockout or a sleep). */
  reset(): void {
    this.wanted = 0;
    this.wantedT = 0;
    this.hp = MAX_HP;
    this.koT = 0;
    for (const c of this.police.splice(0)) c.dispose();
  }

  // ---------------------------------------------------------------- effects and HUD

  private tracer(a: THREE.Vector3, b: THREE.Vector3, color: number): void {
    let t = this.tracers.find((x) => x.life <= 0);
    if (!t) {
      const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, toneMapped: false }));
      line.frustumCulled = false;
      this.game.renderer.scene.add(line);
      t = { line, life: 0 };
      this.tracers.push(t);
    }
    const pos = t.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, a.x, a.y, a.z);
    pos.setXYZ(1, b.x, b.y, b.z);
    pos.needsUpdate = true;
    (t.line.material as THREE.LineBasicMaterial).color.setHex(color);
    t.life = 0.07;
    t.line.visible = true;
  }

  private puffs: { m: THREE.Mesh; t: number }[] = [];
  private puff(p: THREE.Vector3): void {
    let f = this.puffs.find((x) => x.t <= 0);
    if (!f) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: 0xd8d0c0, transparent: true, depthWrite: false }));
      this.game.renderer.scene.add(m);
      f = { m, t: 0 };
      this.puffs.push(f);
    }
    f.m.position.copy(p);
    f.t = 0.35;
    f.m.visible = true;
  }

  private damageNumber(p: THREE.Vector3, dmg: number, head: boolean): void {
    const e = el('div', `dmgnum ${head ? 'head' : ''}`, String(dmg));
    this.game.uiRoot.appendChild(e);
    this.nums.push({ el: e, pos: p.clone().add(new THREE.Vector3(0, 0.4, 0)), t: 0.8 });
    if (this.nums.length > 12) this.nums.shift()!.el.remove();
  }

  private updateFx(dt: number): void {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / 0.07);
      if (t.life <= 0) t.line.visible = false;
    }
    for (const f of this.puffs) {
      if (f.t <= 0) continue;
      f.t -= dt;
      f.m.scale.setScalar(1 + (0.35 - f.t) * 6);
      (f.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, f.t / 0.35);
      if (f.t <= 0) f.m.visible = false;
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.visible = false;
    }
    const cam = this.game.renderer.camera;
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      n.t -= dt;
      n.pos.y += dt * 1.2;
      this.tmp.copy(n.pos).project(cam);
      if (n.t <= 0 || this.tmp.z > 1) {
        n.el.remove();
        this.nums.splice(i, 1);
        continue;
      }
      n.el.style.transform = `translate(${((this.tmp.x + 1) / 2) * window.innerWidth}px, ${((1 - this.tmp.y) / 2) * window.innerHeight}px) translate(-50%, -50%) scale(${0.8 + n.t * 0.4})`;
      n.el.style.opacity = String(Math.min(1, n.t * 3));
    }
  }

  private lastHud = '';
  private updateHud(): void {
    const g = this.game;
    const show = g.mode === 'play' && (this.hp < MAX_HP || this.armed || this.wanted > 0);
    this.hud.style.display = show ? '' : 'none';
    const def = this.current ? gunDef(this.current) : null;
    const key = `${Math.ceil(this.hp)}|${def?.id}|${def ? this.ammo[def.id] : ''}|${this.reloadT > 0}|${this.wanted}|${g.mode}`;
    if (key === this.lastHud) return;
    this.lastHud = key;
    const hp = Math.ceil(this.hp);
    (this.hpEl.querySelector('i') as HTMLElement).style.width = `${hp}%`;
    (this.hpEl.querySelector('span') as HTMLElement).textContent = String(hp);
    this.hpEl.classList.toggle('low', hp < 35);
    this.ammoEl.innerHTML = def ? `<b>${this.reloadT > 0 ? '…' : this.ammo[def.id]}</b><span>/ ${def.mag}</span><em>${def.name}</em>` : '';
    this.ammoEl.style.display = def ? '' : 'none';
    this.starsEl.innerHTML = this.wanted > 0 && g.mode === 'play' ? '★'.repeat(this.wanted) + '<i>' + '★'.repeat(5 - this.wanted) + '</i>' : '';
  }
}

/** Distance along a ray to a vertical capsule (feet at p), or null. */
export function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, p: THREE.Vector3, r: number, h: number): number | null {
  const hx = d.x;
  const hz = d.z;
  const l2 = hx * hx + hz * hz;
  if (l2 < 1e-6) return null;
  // Closest approach in the ground plane.
  const t = ((p.x - o.x) * hx + (p.z - o.z) * hz) / l2;
  if (t < 0) return null;
  const cx = o.x + hx * t - p.x;
  const cz = o.z + hz * t - p.z;
  const dist2 = cx * cx + cz * cz;
  if (dist2 > r * r) return null;
  // Step back to the surface of the cylinder.
  const back = Math.sqrt((r * r - dist2) / l2);
  const tt = Math.max(0, t - back);
  const y = o.y + d.y * tt;
  if (y < p.y || y > p.y + h) {
    const y2 = o.y + d.y * t;
    if (y2 < p.y || y2 > p.y + h) return null;
    return t;
  }
  return tt;
}

export { GUNS };
