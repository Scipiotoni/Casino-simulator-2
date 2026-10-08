import * as THREE from 'three';
import type { Game } from '../game/game';
import type { Business } from './business';
import { FLOOR_ITEMS, floorItem, type FloorItem } from './catalog';
import { FACTORIES } from '../world/venues';
import type { TableBase } from '../casino/table';
import { el, esc, money } from '../ui/dom';
import { audio } from '../core/audio';

/**
 * Build mode for your casino: the roof lifts off, the camera looks down on the floor, and
 * you place machines and tables from a tray at the bottom. Click to place, R or the mouse
 * wheel to turn, right-click (or the Sell button) on a placed item to sell it back.
 */

const SELL_BACK = 0.6;

export class FloorEditor {
  biz: Business | null = null;
  private tray: HTMLDivElement | null = null;
  private pick: FloorItem | null = null;
  private yaw = Math.PI;
  private ghost: TableBase | null = null;
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private cam = { x: 0, z: 0, zoom: 1 };
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private local = new THREE.Vector3();
  private valid = false;
  private dirty = false;

  constructor(private game: Game) {
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false });
    this.ring = new THREE.Mesh(new THREE.CircleGeometry(1, 40), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 4;
    this.ring.visible = false;
  }

  get active(): boolean {
    return !!this.biz;
  }

  open(b: Business): void {
    const g = this.game;
    const v = b.venue;
    if (!v) return;
    if (this.biz) this.close();
    this.biz = b;
    g.session.stand(true);
    g.mode = 'build';
    g.camera.mode = 'cinematic';
    g.input.wantLock = false;
    g.input.exitLock();
    g.hud.setMinimal(true);
    v.setCutaway(true);
    v.interior.visible = true;
    v.interior.add(this.ring);
    this.cam = { x: 0, z: -v.D / 2, zoom: 1 };
    this.pick = null;
    this.buildTray();
  }

  close(): void {
    const g = this.game;
    const b = this.biz;
    if (!b) return;
    this.clearGhost();
    this.ring.removeFromParent();
    b.venue?.setCutaway(false);
    this.tray?.remove();
    this.tray = null;
    this.biz = null;
    if (this.dirty) {
      g.business.rebuildFloor(b);
      g.save();
      this.dirty = false;
    }
    g.mode = 'play';
    g.camera.mode = g.player.firstPerson ? 'first' : 'third';
    g.input.wantLock = true;
    g.hud.setMinimal(false);
  }

  private buildTray(): void {
    const g = this.game;
    const b = this.biz!;
    this.tray?.remove();
    const tray = el('div', 'build-tray');
    const head = el('div', 'bt-head', `<div class="bt-title">${esc(b.save.name)} · FLOOR</div><div class="bt-help">Click to place · <b>R</b>/wheel to turn · <b>right-click</b> an item to sell · <b>WASD</b> to move · <b>Esc</b> when done</div>`);
    const done = el('button', 'pbtn primary', 'Done');
    done.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    head.appendChild(done);
    const items = el('div', 'bt-items');
    for (const f of FLOOR_ITEMS) {
      const c = el('div', `bt-item ${this.pick === f ? 'sel' : ''} ${g.money < f.price ? 'poor' : ''}`, `<div class="ic">${f.icon}</div><div class="nm">${esc(f.name)}</div><div class="pr">${money(f.price)}</div>`);
      c.title = f.desc;
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        this.choose(this.pick === f ? null : f);
      });
      items.appendChild(c);
    }
    const stats = el('div', 'bt-stats');
    const slots = b.save.items.filter((i) => i.kind === 'slots' || i.kind === 'videopoker').length;
    stats.innerHTML = `<span>${slots} machines</span><span>${b.save.items.length - slots} tables</span><span>${money(g.money)}</span>`;
    tray.append(head, items, stats);
    tray.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.game.uiRoot.appendChild(tray);
    this.tray = tray;
  }

  private choose(f: FloorItem | null): void {
    this.clearGhost();
    this.pick = f;
    const v = this.biz?.venue;
    if (f && v) {
      const t = FACTORIES[f.kind]?.(1, { min: f.minBet, max: f.maxBet });
      if (t) {
        this.ghost = t;
        v.interior.add(t.group);
      }
    }
    this.buildTray();
  }

  private clearGhost(): void {
    if (!this.ghost) return;
    this.ghost.group.removeFromParent();
    this.ghost = null;
  }

  /** Can an item of clearance r go at hall-local (x, z)? */
  fits(x: number, z: number, r: number, ignore = -1): boolean {
    const b = this.biz!;
    const v = b.venue!;
    const W = v.W;
    const D = v.D;
    if (x - r < -W / 2 + 0.6 || x + r > W / 2 - 0.6 || z + r > -0.6 || z - r < -D + 0.6) return false;
    // Keep the entrance, the bar, the cashier, the office and the columns clear.
    const rects: [number, number, number, number][] = [
      [-5, 5, -4.5, 0],
      [-W / 2, -W / 2 + 12, -D, -D + 6.2],
      [W / 2 - 10, W / 2, -D, -D + 4],
      [W / 2 - 4.5, W / 2, -5, 0],
    ];
    for (const [x0, x1, z0, z1] of rects) {
      const cx = Math.max(x0, Math.min(x1, x));
      const cz = Math.max(z0, Math.min(z1, z));
      if (Math.hypot(cx - x, cz - z) < r) return false;
    }
    for (const sx of [-1, 1]) for (let cz = -8; cz > -D + 4; cz -= 12) if (Math.hypot(x - sx * (W / 2 - 5), z - cz) < r + 0.5) return false;
    for (let i = 0; i < b.save.items.length; i++) {
      if (i === ignore) continue;
      const it = b.save.items[i];
      if (Math.hypot(it.x - x, it.z - z) < r + floorItem(it.kind).r - 0.02) return false;
    }
    return true;
  }

  update(dt: number): void {
    const g = this.game;
    const b = this.biz;
    const v = b?.venue;
    if (!b || !v) return;
    const inp = g.input;
    if (inp.pressed('Escape')) {
      if (this.pick) this.choose(null);
      else this.close();
      return;
    }
    // Camera: above the hall, looking down at a slant.
    const ax = inp.moveAxes();
    const sp = 14 * dt * this.cam.zoom;
    this.cam.x = Math.max(-v.W / 2, Math.min(v.W / 2, this.cam.x + ax.x * sp));
    this.cam.z = Math.max(-v.D, Math.min(0, this.cam.z - ax.y * sp));
    if (inp.pressed('KeyR')) this.rotate();
    if (inp.wheel) {
      if (this.pick && !inp.down('ShiftLeft')) this.rotate(Math.sign(inp.wheel));
      else this.cam.zoom = Math.max(0.45, Math.min(1.6, this.cam.zoom * (inp.wheel > 0 ? 1.1 : 0.9)));
    }
    const h = Math.max(v.W, v.D) * 0.75 * this.cam.zoom + 4;
    const look = v.toWorld(this.cam.x, this.cam.z);
    const eye = v.toWorld(this.cam.x, this.cam.z + h * 0.45);
    g.camera.cinePos.set(eye.x, v.floorY + h, eye.z);
    g.camera.cineLook.copy(look);
    g.camera.cineFov = 50;
    // Pointer on the floor.
    const cam = g.renderer.camera;
    const nx = (inp.mouseX / window.innerWidth) * 2 - 1;
    const ny = -(inp.mouseY / window.innerHeight) * 2 + 1;
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), cam);
    this.plane.constant = -v.floorY;
    const ok = this.ray.ray.intersectPlane(this.plane, this.hit);
    if (!ok) return;
    this.local.copy(this.hit);
    v.group.worldToLocal(this.local);
    const lx = Math.round(this.local.x * 4) / 4;
    const lz = Math.round(this.local.z * 4) / 4;
    if (this.pick) {
      const r = this.pick.r;
      this.valid = this.fits(lx, lz, r) && g.money >= this.pick.price;
      if (this.ghost) {
        this.ghost.group.position.set(lx, v.floorY, lz);
        this.ghost.group.rotation.y = this.yaw;
      }
      this.ring.visible = true;
      this.ring.scale.setScalar(r);
      this.ring.position.set(lx, v.floorY + 0.03, lz);
      this.ringMat.color.setHex(this.valid ? 0x3ddc84 : 0xff4d5a);
      if (inp.clicks.some((c) => c.button === 0)) this.place(lx, lz);
    } else {
      // Hover a placed item to sell it.
      let best = -1;
      let bd = Infinity;
      b.save.items.forEach((it, i) => {
        const d = Math.hypot(it.x - this.local.x, it.z - this.local.z);
        if (d < floorItem(it.kind).r && d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best >= 0) {
        const it = b.save.items[best];
        this.ring.visible = true;
        this.ring.scale.setScalar(floorItem(it.kind).r);
        this.ring.position.set(it.x, v.floorY + 0.03, it.z);
        this.ringMat.color.setHex(0xffd23d);
        g.hud.setPrompt(`Sell ${floorItem(it.kind).name}`, `+${money(Math.round(floorItem(it.kind).price * SELL_BACK))} · right-click`, '🖱');
        if (inp.clicks.some((c) => c.button === 2)) this.sell(best);
      } else {
        this.ring.visible = false;
        g.hud.setPrompt(null);
      }
    }
    if (this.pick && inp.clicks.some((c) => c.button === 2)) this.choose(null);
  }

  private rotate(dir = 1): void {
    const step = this.pick && (this.pick.kind === 'slots' || this.pick.kind === 'videopoker') ? Math.PI / 2 : Math.PI / 4;
    this.yaw = (this.yaw + dir * step + Math.PI * 2) % (Math.PI * 2);
  }

  private place(x: number, z: number): void {
    const g = this.game;
    const b = this.biz!;
    const f = this.pick!;
    if (!this.valid) {
      audio.play('error');
      if (g.money < f.price) g.hud.toast(`You need ${money(f.price)}`, 'bad');
      return;
    }
    g.money -= f.price;
    b.save.items.push({ kind: f.kind, x, z, yaw: this.yaw, level: 1 });
    audio.play('purchase');
    // Show it straight away (a real table, merged on Done).
    const v = b.venue!;
    const t = FACTORIES[f.kind]?.(9000 + b.save.items.length, { min: f.minBet, max: f.maxBet });
    if (t) {
      v.addTable(t, x, z, this.yaw);
    }
    this.dirty = true;
    if (g.money < f.price) this.choose(null);
    else this.buildTray();
  }

  private sell(i: number): void {
    const g = this.game;
    const b = this.biz!;
    const it = b.save.items[i];
    const back = Math.round(floorItem(it.kind).price * SELL_BACK);
    b.save.items.splice(i, 1);
    g.money += back;
    audio.play('coin');
    g.business.rebuildFloor(b);
    b.venue?.setCutaway(true);
    b.venue?.interior.add(this.ring);
    this.dirty = false;
    g.hud.setPrompt(null);
    this.buildTray();
    g.save();
  }
}
