import * as THREE from 'three';
import { CharacterModel } from '../chars/model';
import { Animator, type Pose } from '../chars/anim';
import { appearanceFromSkin, SKIN_TONES, type Appearance } from '../chars/skins';
import type { Expression } from '../chars/faces';
import { tweens } from '../core/tween';
import type { World } from '../game/world';

/**
 * Story characters: named people with a look of their own who can walk somewhere, turn,
 * strike a pose and pull a face. Cutscenes and missions drive them.
 */

export const CAST: Record<string, Appearance> = {
  sal: {
    ...appearanceFromSkin('tourist'),
    skinId: 'sal',
    body: 'm',
    skin: SKIN_TONES[2],
    eyes: 'brown',
    hair: 'short',
    hairColor: 0xd8d8d8,
    height: 0.97,
    build: 1.18,
    outfit: { ...appearanceFromSkin('tourist').outfit, top: 'hawaiian', bottom: 'slacks', shoes: 'loafers', hat: 'fedora', glasses: 'none', c1: 0xe8582f, c2: 0xffd23d, accent: 0x2bb5a0, pants: 0xe8dcc0, shoe: 0x6b4a2a, neck: 'chain' },
  },
  victor: {
    ...appearanceFromSkin('highroller'),
    skinId: 'victor',
    hair: 'quiff',
    hairColor: 0x15151a,
    skin: SKIN_TONES[1],
    eyes: 'green',
    height: 1.03,
    build: 1.05,
    outfit: { ...appearanceFromSkin('highroller').outfit, c1: 0x15151a, c2: 0x0b0b0e, accent: 0x2bd96b, pants: 0x15151a, glasses: 'shades', neck: 'tie' },
  },
  rosa: {
    ...appearanceFromSkin('croupier'),
    skinId: 'rosa',
    body: 'f',
    hair: 'bob',
    hairColor: 0x3a2416,
    skin: SKIN_TONES[4],
    eyes: 'hazel',
    height: 1.0,
    build: 1,
    outfit: { ...appearanceFromSkin('croupier').outfit, top: 'suit', bottom: 'skirt', shoes: 'heels', c1: 0x2a6ab8, c2: 0x15151a, accent: 0xffd23d, pants: 0x2a6ab8, shoe: 0x15151a, neck: 'none', glasses: 'round' },
  },
  sergeant: {
    ...appearanceFromSkin('commando'),
    skinId: 'sergeant',
    hair: 'buzz',
    hairColor: 0x6a3f22,
    height: 1.04,
    build: 1.15,
    outfit: { ...appearanceFromSkin('commando').outfit, hat: 'beret' },
  },
};

export class Actor {
  readonly model: CharacterModel;
  readonly anim: Animator;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  private holdPose: Pose | null = null;

  constructor(app: Appearance, private scene: THREE.Scene, private world: World) {
    this.model = new CharacterModel(app);
    this.anim = new Animator(this.model);
    scene.add(this.model.root);
  }

  place(x: number, z: number, yaw: number, y?: number): this {
    this.pos.set(x, y ?? this.world.groundY(x, z, 1e9), z);
    this.yaw = yaw;
    this.sync(0);
    return this;
  }

  pose(p: Pose | null): this {
    this.holdPose = p;
    return this;
  }

  face(e: Expression, seconds = 0): this {
    this.model.setExpression(e, seconds);
    return this;
  }

  /** Turn to look at a point. */
  lookAt(x: number, z: number): this {
    this.yaw = Math.atan2(x - this.pos.x, z - this.pos.z);
    return this;
  }

  /** Walk in a straight line to a point. */
  async walkTo(x: number, z: number, speed = 1.5, group = 'cine'): Promise<void> {
    const sx = this.pos.x;
    const sz = this.pos.z;
    const d = Math.hypot(x - sx, z - sz);
    if (d < 0.05) return;
    this.yaw = Math.atan2(x - sx, z - sz);
    this.holdPose = null;
    this.anim.speed = speed;
    await tweens.run(d / speed, (k) => {
      this.pos.x = sx + (x - sx) * k;
      this.pos.z = sz + (z - sz) * k;
      this.pos.y = this.world.groundY(this.pos.x, this.pos.z, this.pos.y + 0.5);
    }, (t) => t, group);
    this.anim.speed = 0;
  }

  sync(dt: number): void {
    this.anim.pose = this.holdPose ?? 'idle';
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    this.anim.update(dt);
  }

  remove(): void {
    this.scene.remove(this.model.root);
    this.model.dispose();
  }
}
