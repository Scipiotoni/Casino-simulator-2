import * as THREE from 'three';
import { Renderer } from '../render/renderer';
import { Input } from '../core/input';
import { World } from './world';
import { CharacterModel } from '../chars/model';
import { Animator, type Pose } from '../chars/anim';
import { SKINS, appearanceFromSkin } from '../chars/skins';
import { Player } from './player';
import { CameraRig } from './cameraRig';
import { Hud } from '../ui/hud';
import { Interactions, labelOf, subOf, type Interactable } from './interact';
import { audio } from '../core/audio';
import { GamblingSession } from '../casino/session';
import { tweens } from '../core/tween';
import * as THREE_NS from 'three';

export type GameMode = 'loading' | 'title' | 'play' | 'cutscene' | 'seated' | 'menu';

/** Top-level game: boots the world, runs the loop, routes input to whatever is active. */
export class Game {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly world: World;
  readonly camera: CameraRig;
  readonly interactions = new Interactions();
  hud!: Hud;
  session!: GamblingSession;
  player!: Player;
  mode: GameMode = 'loading';
  private last = performance.now();
  /** Game clock: one game hour per real minute. */
  hours = 10;
  day = 1;
  timeScale = 1 / 60;
  money = 500;
  private loading!: HTMLDivElement;
  private focused: Interactable | null = null;
  private ui!: HTMLDivElement;
  readonly fly = { x: 2600, y: 120, z: 400, yaw: 0, pitch: -0.2 };
  private debugAnims: Animator[] = [];
  private realDt = 0;
  private tmpV = new THREE.Vector3();
  private tmpE = new THREE.Vector3();

  constructor(private app: HTMLElement) {
    this.renderer = new Renderer(app);
    this.input = new Input(this.renderer.gl.domElement);
    this.world = new World(this.renderer);
    this.camera = new CameraRig(this.renderer.camera);
  }

  private makeLoading(): void {
    this.loading = document.createElement('div');
    this.loading.className = 'loading';
    this.loading.innerHTML = `
      <div class="logo"><div class="l1">CASINO SIMULATOR</div><div class="l2">2</div><div class="l3">JACKPOT ISLAND</div></div>
      <div class="bar"><div></div></div>
      <div class="msg">Loading</div>`;
    this.app.appendChild(this.loading);
  }

  async boot(): Promise<void> {
    this.makeLoading();
    const bar = this.loading.querySelector('.bar > div') as HTMLDivElement;
    const msg = this.loading.querySelector('.msg') as HTMLDivElement;
    await this.world.build(async (f, m) => {
      bar.style.width = `${Math.round(f * 100)}%`;
      msg.textContent = m;
      await new Promise((r) => setTimeout(r, 16));
    });
    this.ui = document.createElement('div');
    this.ui.className = 'ui-root';
    this.app.appendChild(this.ui);
    this.hud = new Hud(this.ui);
    this.hud.onPromptTap = () => this.useFocused();
    this.player = new Player(this.renderer.scene, appearanceFromSkin('rookie'));
    this.session = new GamblingSession(this, this.ui);
    this.registerVenueSeats();
    const q = new URLSearchParams(location.search);
    const sx = q.has('x') ? Number(q.get('x')) : 3520;
    const sz = q.has('z') ? Number(q.get('z')) : -300;
    this.player.teleport(sx, this.world.groundY(sx, sz), sz, -Math.PI / 2);
    this.camera.yaw = Math.PI / 2;
    if (q.has('h')) this.hours = Number(q.get('h'));
    if (q.has('fly')) {
      this.camera.mode = 'free';
      this.fly.x = sx;
      this.fly.z = sz;
      if (q.has('y')) this.fly.y = Number(q.get('y'));
      if (q.has('yaw')) this.fly.yaw = Number(q.get('yaw'));
      if (q.has('pitch')) this.fly.pitch = Number(q.get('pitch'));
    }
    if (q.has('chars')) this.debugLineup(q.get('chars') ?? '');
    this.hud.setMoney(this.money, true);
    this.mode = 'play';
    window.addEventListener('pointerdown', () => audio.unlock(), { once: false });
    window.addEventListener('keydown', () => audio.unlock(), { once: false });
    this.loading.classList.add('done');
    setTimeout(() => this.loading.remove(), 800);
    requestAnimationFrame(this.loop);
  }

  /** Every seat at every table in the island's casinos gets a "sit down" prompt. */
  private registerVenueSeats(): void {
    for (const v of this.world.venues) {
      v.tables.forEach((pt, ti) => {
        const t = pt.table;
        t.seats.forEach((s, si) => {
          const wp = t.group.localToWorld(new THREE_NS.Vector3(s.x, 0, s.z));
          this.interactions.add({
            id: `seat:${v.opts.id}:${ti}:${si}`,
            x: wp.x, y: v.floorY, z: wp.z, radius: 1.0,
            label: () => `Play ${t.name}`,
            sub: () => (t.kind === 'slots' || t.kind === 'videopoker' ? `$${t.minBet}–$${t.maxBet} a credit` : `$${t.minBet.toLocaleString('en-US')} – $${t.maxBet.toLocaleString('en-US')}`),
            enabled: () => s.who !== 'player' && !this.session.active,
            action: () => this.session.sit(t, si),
          });
        });
      });
    }
  }

  /** Confetti, a banner and a camera kick for big wins. */
  celebrate(kind: 'win' | 'big' | 'jackpot', amount: number): void {
    if (kind === 'jackpot') {
      this.hud.banner('JACKPOT!', `+$${Math.round(amount).toLocaleString('en-US')}`, 4200, 'gold');
      audio.play('jackpot');
      this.camera.shake = 1;
    } else if (kind === 'big') {
      this.hud.banner('BIG WIN!', `+$${Math.round(amount).toLocaleString('en-US')}`, 3000, 'gold');
      audio.play('bigwin');
      this.camera.shake = 0.5;
    }
  }

  private debugLineup(pose: string): void {
    const y = this.world.groundY(3500, 400);
    SKINS.forEach((s, i) => {
      const m = new CharacterModel(appearanceFromSkin(s.id));
      m.root.position.set(3500 + (i % 8) * 1.1 - 3.85, y, 400 + Math.floor(i / 8) * 2.2);
      this.renderer.scene.add(m.root);
      const an = new Animator(m);
      an.pose = (pose || 'idle') as Pose;
      if (pose === 'walk') {
        an.pose = 'idle';
        an.speed = 1.4;
      }
      if (pose === 'run') {
        an.pose = 'idle';
        an.speed = 6;
      }
      m.setExpression((['happy', 'grin', 'neutral', 'smirk', 'surprised', 'angry', 'sad', 'wink'] as const)[i % 8]);
      this.debugAnims.push(an);
    });
    this.camera.mode = 'free';
    Object.assign(this.fly, { x: 3500, y: y + 1.5, z: 405.5, yaw: 0, pitch: -0.05 });
  }

  private loop = (now: number) => {
    const raw = (now - this.last) / 1000;
    const dt = Math.min(0.1, raw);
    this.last = now;
    // Table animations run on real time so a slow frame never slows the dealer down.
    this.realDt = Math.min(0.3, raw);
    try {
      this.update(dt, now / 1000);
    } catch (e) {
      console.error(e);
    }
    this.renderer.render();
    this.input.endFrame();
    requestAnimationFrame(this.loop);
  };

  get canMove(): boolean {
    return this.mode === 'play' && !this.hud.dialogOpen;
  }

  private update(dt: number, now: number): void {
    this.renderer.trackFrame(dt, now);
    const inp = this.input;
    // Clock.
    this.hours += dt * this.timeScale;
    if (this.hours >= 24) {
      this.hours -= 24;
      this.day++;
    }
    // Dialogue advances with E / Space / Enter / click.
    if (this.hud.dialogOpen && (inp.pressed('KeyE') || inp.pressed('Space') || inp.pressed('Enter'))) this.hud.advanceDialog();

    tweens.update(this.realDt);
    if (this.camera.mode === 'free') {
      this.updateFly(dt);
    } else if (this.mode === 'seated') {
      this.session.update();
      this.camera.look(inp, inp.mouseDown[2]);
      this.player.update(dt, null, this.camera.yaw, this.world, false);
      this.player.eyePosition(this.tmpE);
      this.camera.update(dt, this.world, this.tmpV.copy(this.player.pos), this.tmpE, this.renderer.settings.fov, this.session.cursor());
    } else {
      this.camera.look(inp, this.mode === 'play');
      if (inp.pressed('KeyV') && this.mode === 'play') this.toggleFirstPerson();
      this.player.update(dt, inp, this.camera.yaw, this.world, this.canMove);
      // Interactions.
      if (this.mode === 'play' && !this.hud.dialogOpen) {
        this.focused = this.interactions.find(this.player.pos.x, this.player.pos.y, this.player.pos.z, this.player.firstPerson ? this.camera.yaw + Math.PI : this.player.yaw);
        if (this.focused) this.hud.setPrompt(labelOf(this.focused), subOf(this.focused));
        else this.hud.setPrompt(null);
        if (this.focused && inp.pressed('KeyE')) this.useFocused();
      } else this.hud.setPrompt(null);
      const focus = this.tmpV.copy(this.player.pos);
      focus.y += 1.62;
      this.player.eyePosition(this.tmpE);
      this.camera.update(dt, this.world, focus, this.tmpE, this.renderer.settings.fov);
    }
    const cam = this.renderer.camera;
    this.world.update(dt, this.hours, this.camera.mode === 'free' ? cam.position : this.player.pos);
    for (const a of this.debugAnims) a.update(dt);
    audio.listener.x = cam.position.x;
    audio.listener.z = cam.position.z;
    audio.listener.yaw = this.camera.yaw;
    this.hud.setClock(this.day, this.hours);
    this.hud.setMoney(this.money);
    this.hud.update(dt);
  }

  private updateFly(dt: number): void {
    const inp = this.input;
    const f = this.fly;
    f.yaw -= inp.lookDX * 0.003;
    f.pitch = Math.max(-1.5, Math.min(1.5, f.pitch - inp.lookDY * 0.003));
    const ax = inp.moveAxes();
    const sp = (inp.down('ShiftLeft') ? 400 : 60) * dt;
    const fx = -Math.sin(f.yaw);
    const fz = -Math.cos(f.yaw);
    f.x += (fx * ax.y + -fz * ax.x) * sp;
    f.z += (fz * ax.y + fx * ax.x) * sp;
    if (inp.down('KeyE')) f.y += sp;
    if (inp.down('KeyQ')) f.y -= sp;
    f.y = Math.max(f.y, this.world.groundY(f.x, f.z) + 0.4);
    const cam = this.renderer.camera;
    cam.position.set(f.x, f.y, f.z);
    cam.rotation.set(f.pitch, f.yaw, 0, 'YXZ');
  }

  toggleFirstPerson(): void {
    const fp = this.camera.mode !== 'first';
    this.camera.mode = fp ? 'first' : 'third';
    this.player.firstPerson = fp;
    this.player.setHeadVisible(!fp);
    this.hud.setCrosshair(fp);
  }

  private useFocused(): void {
    const f = this.focused;
    if (!f) return;
    audio.play('click');
    f.action();
  }

  addMoney(n: number, reason = ''): void {
    this.money += n;
    if (reason && n !== 0) this.hud.toast(`${n > 0 ? '+' : '-'}$${Math.abs(Math.round(n)).toLocaleString('en-US')} ${reason}`, n > 0 ? 'money' : 'bad');
  }
}
