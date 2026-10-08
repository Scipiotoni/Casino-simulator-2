import * as THREE from 'three';
import type { Game } from '../game/game';
import { tweens, ease, type Ease } from '../core/tween';
import { el, esc } from '../ui/dom';

/**
 * Cutscenes. A cutscene is an async script that frames shots (cuts, dolly moves, tracking
 * shots, orbits), moves actors, shows letterbox bars, fades, title cards and dialogue. Esc
 * (or the Skip button) fast-forwards: every wait resolves at once and the script's final
 * state is applied, so a skipped cutscene leaves the world exactly as a watched one.
 */

export type Vec = THREE.Vector3 | [number, number, number];

function v(p: Vec): THREE.Vector3 {
  return Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : p.clone();
}

interface Shot {
  update(dt: number, pos: THREE.Vector3, look: THREE.Vector3): void;
  fov?: number;
}

export class Director {
  private root: HTMLDivElement;
  private bars: HTMLDivElement;
  private fadeEl: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private skipEl: HTMLButtonElement;
  private captionEl: HTMLDivElement;
  private shot: Shot | null = null;
  playing = false;
  skipped = false;
  private skipHold = 0;

  constructor(private game: Game, parent: HTMLElement) {
    this.root = el('div', 'cine');
    this.bars = el('div', 'cine-bars', '<i></i><i></i>');
    this.fadeEl = el('div', 'cine-fade');
    this.titleEl = el('div', 'cine-title');
    this.captionEl = el('div', 'cine-caption');
    this.skipEl = el('button', 'cine-skip', 'Skip ▸▸ <span>Esc</span>');
    this.skipEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.skip();
    });
    this.root.append(this.bars, this.captionEl, this.titleEl, this.fadeEl, this.skipEl);
    parent.appendChild(this.root);
  }

  /** Run a cutscene. Resolves when it ends (or is skipped). */
  async play(script: (d: Director) => Promise<void>): Promise<void> {
    const g = this.game;
    this.playing = true;
    this.skipped = false;
    g.mode = 'cutscene';
    g.camera.mode = 'cinematic';
    g.input.wantLock = false;
    g.input.exitLock();
    g.hud.setMinimal(true);
    g.hud.setPrompt(null);
    this.root.classList.add('on');
    document.body.classList.add('cine-on');
    this.bars.classList.add('in');
    try {
      await script(this);
    } catch (e) {
      console.error('cutscene', e);
    }
    this.bars.classList.remove('in');
    this.titleEl.classList.remove('show');
    this.captionEl.classList.remove('show');
    this.root.classList.remove('on');
    document.body.classList.remove('cine-on');
    this.shot = null;
    g.hud.closeDialog();
    g.hud.setMinimal(false);
    this.fadeEl.style.transition = 'opacity 0.6s';
    this.fadeEl.style.opacity = '0';
    tweens.finish('cine');
    tweens.skipping.delete('cine');
    this.playing = false;
    g.mode = 'play';
    g.camera.mode = g.player.firstPerson ? 'first' : 'third';
    g.input.wantLock = true;
  }

  skip(): void {
    if (!this.playing || this.skipped) return;
    this.skipped = true;
    tweens.skipping.add('cine');
    tweens.finish('cine');
    this.game.hud.advanceDialog(true);
  }

  /** Called every frame by the game while a cutscene plays. */
  update(dt: number): void {
    if (!this.playing) return;
    const inp = this.game.input;
    if (inp.pressed('Escape')) this.skip();
    // Holding Space also skips (for gamepads-less phones: tap the button).
    if (inp.down('Space') && !this.game.hud.dialogOpen) {
      this.skipHold += dt;
      if (this.skipHold > 1.2) this.skip();
    } else this.skipHold = 0;
    const cam = this.game.camera;
    if (this.shot) {
      this.shot.update(dt, cam.cinePos, cam.cineLook);
      if (this.shot.fov) cam.cineFov = this.shot.fov;
    }
  }

  wait(seconds: number): Promise<void> {
    if (this.skipped) return Promise.resolve();
    return tweens.wait(seconds, 'cine');
  }

  /** Hard cut to a static shot. */
  cut(pos: Vec, look: Vec, fov = 50): void {
    const p = v(pos);
    const l = v(look);
    this.shot = { update: (_dt, op, ol) => (op.copy(p), ol.copy(l)), fov };
  }

  /** Move the camera from one framing to another over `seconds`. */
  dolly(from: [Vec, Vec], to: [Vec, Vec], seconds: number, fov = 50, e: Ease = ease.inOut): Promise<void> {
    const p0 = v(from[0]);
    const l0 = v(from[1]);
    const p1 = v(to[0]);
    const l1 = v(to[1]);
    let t = 0;
    this.shot = {
      update: (dt, op, ol) => {
        t = Math.min(1, t + dt / seconds);
        const k = e(t);
        op.lerpVectors(p0, p1, k);
        ol.lerpVectors(l0, l1, k);
      },
      fov,
    };
    return this.wait(seconds);
  }

  /** Follow a moving object from an offset in its own frame (behind, beside…). */
  track(target: THREE.Object3D, offset: Vec, lookOffset: Vec = [0, 1, 0], fov = 50, smooth = 6): void {
    const off = v(offset);
    const lo = v(lookOffset);
    const tmp = new THREE.Vector3();
    let first = true;
    this.shot = {
      update: (dt, op, ol) => {
        target.updateMatrixWorld(true);
        tmp.copy(off).applyMatrix4(target.matrixWorld);
        if (first) op.copy(tmp);
        else op.lerp(tmp, Math.min(1, dt * smooth));
        first = false;
        ol.copy(lo).applyMatrix4(target.matrixWorld);
      },
      fov,
    };
  }

  /** Circle round a point. */
  orbit(center: Vec, radius: number, height: number, startAngle: number, speed: number, fov = 50): void {
    const c = v(center);
    let a = startAngle;
    this.shot = {
      update: (dt, op, ol) => {
        a += speed * dt;
        op.set(c.x + Math.cos(a) * radius, c.y + height, c.z + Math.sin(a) * radius);
        ol.copy(c);
      },
      fov,
    };
  }

  /** Look at a moving target from a fixed spot. */
  pan(pos: Vec, target: THREE.Object3D, lookOffset: Vec = [0, 1, 0], fov = 45): void {
    const p = v(pos);
    const lo = v(lookOffset);
    this.shot = {
      update: (_dt, op, ol) => {
        op.copy(p);
        target.updateMatrixWorld(true);
        ol.copy(lo).applyMatrix4(target.matrixWorld);
      },
      fov,
    };
  }

  async fade(toBlack: boolean, seconds = 0.8): Promise<void> {
    this.fadeEl.style.transition = `opacity ${this.skipped ? 0 : seconds}s`;
    this.fadeEl.style.opacity = toBlack ? '1' : '0';
    await this.wait(seconds);
  }

  /** Black screen immediately (start of a scene). */
  black(): void {
    this.fadeEl.style.transition = 'none';
    this.fadeEl.style.opacity = '1';
  }

  async title(big: string, small = '', seconds = 3): Promise<void> {
    this.titleEl.innerHTML = `<div class="t1">${esc(big)}</div>${small ? `<div class="t2">${esc(small)}</div>` : ''}`;
    this.titleEl.classList.add('show');
    await this.wait(seconds);
    this.titleEl.classList.remove('show');
    await this.wait(0.5);
  }

  /** A caption in the corner ("Interstate 15 · 7:12 PM"). */
  caption(text: string, seconds = 4): void {
    this.captionEl.textContent = text;
    this.captionEl.classList.add('show');
    setTimeout(() => this.captionEl.classList.remove('show'), seconds * 1000);
  }

  /** A line of dialogue (waits for the player to read it, or auto-advances). */
  async say(who: string, text: string, color = '#ffd23d', auto = 0): Promise<void> {
    if (this.skipped) return;
    await this.game.hud.say(who, text, color, auto);
    this.game.hud.closeDialog();
  }
}
