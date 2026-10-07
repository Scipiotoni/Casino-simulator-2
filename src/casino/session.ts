import * as THREE from 'three';
import type { TableBase, GameHost, GameKind } from './table';
import { OptionsBar } from '../ui/optionsBar';
import type { Game } from '../game/game';
import { audio } from '../core/audio';

/**
 * Sitting at a table or machine: the camera drops to your eyes in the seat, the cursor is
 * freed so you can reach out and click the felt (or a machine's buttons), and the options
 * bar shows what you can do. Esc stands you back up.
 */
export class GamblingSession {
  readonly options: OptionsBar;
  table: TableBase | null = null;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private tmp = new THREE.Vector3();
  private seatIndex = -1;
  /** Practice chips when playing at your own tables. */
  practice = false;
  private practiceBank = 10000;
  onRecord: ((kind: GameKind, staked: number, returned: number, practice: boolean) => void) | null = null;

  constructor(private game: Game, uiRoot: HTMLElement) {
    this.options = new OptionsBar(uiRoot);
    this.options.onButton = (id) => {
      if (id === 'leave') this.stand();
      else (this.table as unknown as { button?: (id: string) => void })?.button?.(id);
    };
  }

  get active(): boolean {
    return this.table !== null;
  }

  private host(): GameHost {
    const g = this.game;
    return {
      balance: () => (this.practice ? this.practiceBank : g.money),
      take: (n) => {
        if (n <= 0) return true;
        if (this.practice) {
          if (this.practiceBank < n) return false;
          this.practiceBank -= n;
          return true;
        }
        if (g.money < n) return false;
        g.money -= n;
        return true;
      },
      give: (n) => {
        if (this.practice) this.practiceBank += n;
        else g.money += n;
      },
      options: this.options,
      sound: (name, volume = 1) => audio.play(name, { volume }),
      toast: (t, kind = 'info') => g.hud.toast(t, kind),
      celebrate: (kind, amount) => g.celebrate(kind, amount),
      leave: () => this.stand(),
      practice: this.practice,
      record: (kind, staked, returned) => this.onRecord?.(kind, staked, returned, this.practice),
    };
  }

  sit(table: TableBase, seat: number, practice = false): void {
    if (this.table) return;
    const g = this.game;
    this.practice = practice;
    if (practice) this.practiceBank = 10000;
    this.table = table;
    this.seatIndex = seat;
    table.enter(this.host(), seat);
    // Put the player in the seat.
    const s = table.seats[seat];
    const p = g.player;
    const world = new THREE.Vector3(s.x, 0, s.z);
    table.group.localToWorld(world);
    const q = new THREE.Quaternion();
    table.group.getWorldQuaternion(q);
    const yawWorld = s.yaw + new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    p.mode = 'seated';
    p.anchor.copy(world);
    p.anchorYaw = yawWorld;
    p.poseOverride = s.standing ? 'idle' : 'sitTable';
    p.anim.pose = p.poseOverride;
    p.setHeadVisible(false);
    // Your own body would fill the bottom of the view: hide it while you're seated.
    p.setVisible(false);
    // Seated camera: eyes over the edge of the table, looking at its middle.
    const cam = g.camera;
    table.seatEye(seat, cam.seatEye);
    const focus = table.group.localToWorld(table.focus.clone());
    const d = focus.clone().sub(cam.seatEye);
    cam.seatYaw = Math.atan2(-d.x, -d.z);
    cam.seatPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    cam.resetSeatLook();
    cam.mode = 'seated';
    g.mode = 'seated';
    g.input.wantLock = false;
    g.input.exitLock();
    g.hud.setMinimal(true);
    g.hud.setPrompt(null);
    audio.play('pop');
  }

  stand(force = false): void {
    const t = this.table;
    if (!t) return;
    if (!force && !t.canLeave()) {
      this.game.hud.toast('Finish this round first', 'bad');
      return;
    }
    t.exit();
    this.table = null;
    this.options.hide();
    const g = this.game;
    const p = g.player;
    p.mode = 'walk';
    p.poseOverride = null;
    p.setHeadVisible(true);
    p.setVisible(true);
    // Step back from the seat.
    const s = t.seats[this.seatIndex];
    const back = new THREE.Vector3(s.x - Math.sin(s.yaw) * 0.7, 0, s.z - Math.cos(s.yaw) * 0.7);
    t.group.localToWorld(back);
    p.teleport(back.x, g.world.groundY(back.x, back.z, p.pos.y + 0.5), back.z, p.anchorYaw + Math.PI);
    g.camera.mode = p.firstPerson ? 'first' : 'third';
    g.camera.yaw = p.anchorYaw;
    g.mode = 'play';
    g.input.wantLock = true;
    g.hud.setMinimal(false);
    this.seatIndex = -1;
  }

  /** Per frame while seated: clicks on the felt, hover, keyboard shortcuts. */
  update(): void {
    const t = this.table;
    if (!t) return;
    const g = this.game;
    const inp = g.input;
    if (inp.pressed('Escape')) {
      this.stand();
      return;
    }
    for (const code of ['Space', 'KeyC', 'KeyR', 'KeyH', 'KeyS', 'KeyD', 'KeyP', 'KeyU', 'KeyY', 'KeyN', 'KeyB', 'KeyM', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'KeyF', 'KeyX', 'KeyZ', 'Enter', 'KeyA', 'KeyL']) {
      if (inp.pressed(code)) t.key(code);
    }
    const cam = g.renderer.camera;
    const rect = g.renderer.gl.domElement.getBoundingClientRect();
    this.ndc.set(((inp.mouseX - rect.left) / rect.width) * 2 - 1, -((inp.mouseY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, cam);
    const hits = this.raycaster.intersectObjects(t.pickables, true);
    const hit = hits[0];
    if (hit) {
      this.tmp.copy(hit.point);
      t.group.worldToLocal(this.tmp);
      t.hover(this.tmp, hit.object);
    } else t.hover(null, null);
    for (const c of inp.clicks) {
      this.ndc.set(((c.x - rect.left) / rect.width) * 2 - 1, -((c.y - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(this.ndc, cam);
      const h2 = this.raycaster.intersectObjects(t.pickables, true)[0];
      if (h2) {
        const local = h2.point.clone();
        t.group.worldToLocal(local);
        t.click(local, c.button, h2.object);
      }
    }
  }

  /** Where the cursor is, 0..1 across the screen (the seated view leans towards it). */
  cursor(): { x: number; y: number } {
    const inp = this.game.input;
    return { x: inp.mouseX / window.innerWidth, y: inp.mouseY / window.innerHeight };
  }
}
