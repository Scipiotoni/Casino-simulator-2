import * as THREE from 'three';
import type { Game } from '../game/game';
import { Actor, CAST } from './actors';
import { playIntro } from './intro';
import type { Director } from './director';
import { money } from '../ui/dom';
import { SPECIAL_SITES, lotFrontPoint } from '../world/layout';

/**
 * Story mode. Chapters are lists of steps; each step has an objective (with an optional
 * waypoint and a progress readout), a condition that completes it, and optional scenes
 * when it starts or ends. Progress is saved after every step.
 */

export interface Step {
  id: string;
  text: string;
  waypoint?: (g: Game) => { x: number; z: number; label: string } | null;
  progress?: (g: Game) => string;
  done: (g: Game) => boolean;
  start?: (g: Game, d: Director) => Promise<void> | void;
  finish?: (g: Game, d: Director) => Promise<void> | void;
}

export interface Chapter {
  title: string;
  subtitle: string;
  steps: Step[];
}

function site(g: Game, key: string): { x: number; z: number } {
  const lot = g.world.terrain.lots.find((l) => l.special === key);
  if (!lot) {
    const s = SPECIAL_SITES.find((x) => x.key === key)!;
    return { x: s.x, z: s.z };
  }
  const fp = lotFrontPoint(lot);
  return { x: fp.x + Math.sin(fp.yaw) * 4, z: fp.z + Math.cos(fp.yaw) * 4 };
}

function venueDoor(g: Game, key: string): { x: number; z: number } {
  const v = g.world.venues.find((x) => x.opts.id === key);
  if (!v) return site(g, key);
  return { x: v.door.x + Math.sin(v.yaw) * 6, z: v.door.z + Math.cos(v.yaw) * 6 };
}

function near(g: Game, p: { x: number; z: number }, r: number): boolean {
  return Math.hypot(g.player.pos.x - p.x, g.player.pos.z - p.z) < r;
}

/** Sal behind the bar at the Driftwood (placed for scenes there). */
async function tavernScene(g: Game, d: Director): Promise<void> {
  const v = g.world.venues.find((x) => x.opts.id === 'driftwood');
  if (!v) return;
  await d.play(async (dd) => {
    const sal = new Actor(CAST.sal, g.renderer.scene, g.world);
    g.story.actors.push(sal);
    const barPos = v.toWorld(-v.W / 2 + 7, -v.D + 3.2 + 0.6);
    const inFront = v.toWorld(-v.W / 2 + 7, -v.D + 3.2 + 3.2);
    sal.place(barPos.x, barPos.z, 0, v.floorY);
    sal.lookAt(inFront.x, inFront.z).pose('lean');
    g.player.mode = 'scripted';
    g.player.anchor.set(inFront.x, v.floorY, inFront.z);
    g.player.anchorYaw = Math.atan2(barPos.x - inFront.x, barPos.z - inFront.z);
    const side = new THREE.Vector3().copy(inFront).lerp(barPos, 0.5);
    const cam = v.toWorld(-v.W / 2 + 9.6, -v.D + 3.2 + 2.6);
    dd.cut([cam.x, v.floorY + 1.7, cam.z], [side.x, v.floorY + 1.4, side.z], 45);
    await dd.fade(false, 0.6);
    sal.pose('talk').face('grin');
    await dd.say('UNCLE SAL', 'You made it! And you only got lost twice, I bet. Pull up a stool.', '#ff9f2e');
    await dd.say('UNCLE SAL', "Here's the deal, kid. On this island money talks, and right now you're whispering. So I'm lending you a hundred bucks.", '#ff9f2e');
    sal.pose('point').face('smirk');
    await dd.say('UNCLE SAL', "Turn it into a thousand. Play the blackjack table or the machines back there, or run deliveries for me in the pickup. Your call.", '#ff9f2e');
    await dd.say('YOU', 'And then?', '#3aa7ff');
    sal.pose('shrug').face('happy');
    await dd.say('UNCLE SAL', "And then we talk about getting you a piece of this island. Land, kid. Everything starts with land.", '#ff9f2e');
    sal.remove();
    g.story.actors.splice(g.story.actors.indexOf(sal), 1);
    g.player.mode = 'walk';
    g.player.teleport(inFront.x, v.floorY, inFront.z, g.player.anchorYaw);
  });
}

export function chapters(): Chapter[] {
  return [
    {
      title: 'CHAPTER 1',
      subtitle: 'NOTHING BUT THE CLOTHES ON YOUR BACK',
      steps: [
        {
          id: 'drive',
          text: 'Drive Sal’s pickup to the Driftwood Tavern in Coral Cove',
          waypoint: (g) => ({ ...venueDoor(g, 'driftwood'), label: 'Driftwood Tavern' }),
          done: (g) => near(g, venueDoor(g, 'driftwood'), 14),
        },
        {
          id: 'meetSal',
          text: 'Go inside and talk to Uncle Sal',
          waypoint: (g) => {
            const v = g.world.venues.find((x) => x.opts.id === 'driftwood');
            return v ? { x: v.door.x, z: v.door.z, label: 'Uncle Sal' } : null;
          },
          done: (g) => !!g.world.venues.find((x) => x.opts.id === 'driftwood')?.contains(g.player.pos.x, g.player.pos.z),
          finish: async (g, d) => {
            await tavernScene(g, d);
            g.addMoney(100, 'from Uncle Sal');
          },
        },
        {
          id: 'grand',
          text: 'Turn Sal’s $100 into $1,000 (gamble, or run deliveries for Sal)',
          progress: (g) => `${money(g.money)} / $1,000`,
          done: (g) => g.money >= 1000,
        },
      ],
    },
    {
      title: 'CHAPTER 2',
      subtitle: 'A PLACE OF YOUR OWN',
      steps: [
        {
          id: 'realtor',
          text: 'Visit Paradise Realty downtown',
          waypoint: (g) => ({ ...site(g, 'realEstate'), label: 'Paradise Realty' }),
          start: (g) => g.hud.toast('Sal: "Go see Rosa at Paradise Realty. Tell her I sent you."', 'info', 6000),
          done: (g) => near(g, site(g, 'realEstate'), 12),
        },
        {
          id: 'buyLot',
          text: 'Buy your first lot (look for the FOR SALE signs, or browse in Paradise Realty)',
          done: (g) => g.business.owned.length > 0,
        },
        {
          id: 'build',
          text: 'Decide what to build on it, and build it',
          done: (g) => g.business.owned.some((b) => b.save.building <= 0 && b.save.type !== 'empty'),
        },
        {
          id: 'earn',
          text: 'Earn $5,000 from your business',
          progress: (g) => `${money(g.business.totalEarned())} / $5,000`,
          done: (g) => g.business.totalEarned() >= 5000,
        },
      ],
    },
    {
      title: 'CHAPTER 3',
      subtitle: 'GRAND OPENING',
      steps: [
        {
          id: 'casino',
          text: 'Own a casino (buy a lot and build one)',
          done: (g) => g.business.owned.some((b) => b.save.type === 'casino' && b.save.building <= 0),
        },
        {
          id: 'floor',
          text: 'Put 6 slot machines and 2 tables on your casino floor',
          progress: (g) => {
            const c = g.business.owned.find((b) => b.save.type === 'casino');
            if (!c) return '';
            const slots = c.save.items.filter((i) => i.kind === 'slots' || i.kind === 'videopoker').length;
            const tables = c.save.items.length - slots;
            return `${Math.min(6, slots)}/6 machines · ${Math.min(2, tables)}/2 tables`;
          },
          done: (g) => g.business.owned.some((b) => b.save.type === 'casino' && b.save.items.filter((i) => i.kind === 'slots' || i.kind === 'videopoker').length >= 6 && b.save.items.filter((i) => i.kind !== 'slots' && i.kind !== 'videopoker').length >= 2),
        },
        {
          id: 'profit',
          text: 'Make $25,000 from your casino',
          progress: (g) => `${money(g.business.casinoEarned())} / $25,000`,
          done: (g) => g.business.casinoEarned() >= 25000,
        },
      ],
    },
    {
      title: 'CHAPTER 4',
      subtitle: 'THE GOLDEN VIPER',
      steps: [
        {
          id: 'viper',
          text: 'Visit the Golden Viper on the Strip',
          waypoint: (g) => ({ ...venueDoor(g, 'goldenViper'), label: 'The Golden Viper' }),
          done: (g) => !!g.world.venues.find((x) => x.opts.id === 'goldenViper')?.contains(g.player.pos.x, g.player.pos.z),
        },
        {
          id: 'beatViper',
          text: 'Win $20,000 at the Golden Viper’s tables and machines',
          progress: (g) => `${money(Math.max(0, g.stats.viperNet ?? 0))} / $20,000`,
          done: (g) => (g.stats.viperNet ?? 0) >= 20000,
        },
        {
          id: 'gun',
          text: 'Victor Vane wants you gone. Buy a gun at Bullseye Guns',
          waypoint: (g) => ({ ...site(g, 'gunShop'), label: 'Bullseye Guns' }),
          done: (g) => g.combat.owned.length > 0,
        },
      ],
    },
    {
      title: 'CHAPTER 5',
      subtitle: 'FORT HAMMERHEAD',
      steps: [
        {
          id: 'toBase',
          text: 'Drive to Fort Hammerhead in the north-west',
          waypoint: (g) => ({ x: g.world.base.gate.x, z: g.world.base.gate.z + 40, label: 'Fort Hammerhead' }),
          done: (g) => near(g, { x: g.world.base.gate.x, z: g.world.base.gate.z + 40 }, 40),
        },
        {
          id: 'chip',
          text: 'Get into the armory and take the Golden Chip',
          waypoint: (g) => ({ ...g.world.base.armoryPos(), label: 'Armory' }),
          done: (g) => (g.stats.goldenChip ?? 0) > 0,
        },
        {
          id: 'escape',
          text: 'Get the Golden Chip off the base and back to Sal',
          waypoint: (g) => ({ ...venueDoor(g, 'driftwood'), label: 'Uncle Sal' }),
          done: (g) => near(g, venueDoor(g, 'driftwood'), 12),
        },
      ],
    },
    {
      title: 'CHAPTER 6',
      subtitle: 'ISLAND KINGPIN',
      steps: [
        {
          id: 'three',
          text: 'Own three businesses',
          progress: (g) => `${g.business.owned.length}/3`,
          done: (g) => g.business.owned.length >= 3,
        },
        {
          id: 'million',
          text: 'Be worth $1,000,000 (cash plus everything you own)',
          progress: (g) => `${money(g.netWorth(), true)} / $1M`,
          done: (g) => g.netWorth() >= 1_000_000,
        },
        {
          id: 'lighthouse',
          text: 'Meet Sal at Point Fortuna Lighthouse',
          waypoint: (g) => ({ x: g.world.landmarks.lighthouse.x, z: g.world.landmarks.lighthouse.z + 25, label: 'Lighthouse' }),
          done: (g) => near(g, { x: g.world.landmarks.lighthouse.x, z: g.world.landmarks.lighthouse.z + 25 }, 30),
        },
      ],
    },
  ];
}

export class Story {
  readonly chapters = chapters();
  chapter = 0;
  step = 0;
  flags: Record<string, number> = {};
  readonly actors: Actor[] = [];
  private busy = false;
  private started = false;

  constructor(private game: Game) {}

  load(s: { chapter: number; step: number; flags: Record<string, number> }): void {
    this.chapter = s.chapter;
    this.step = s.step;
    this.flags = s.flags ?? {};
    this.started = true;
  }

  serialize(): { chapter: number; step: number; flags: Record<string, number> } {
    return { chapter: this.chapter, step: this.step, flags: this.flags };
  }

  get finished(): boolean {
    return this.chapter >= this.chapters.length;
  }

  get current(): Step | null {
    const c = this.chapters[this.chapter];
    return c ? c.steps[this.step] ?? null : null;
  }

  /** A brand new game: the intro, then chapter 1. */
  async begin(): Promise<void> {
    const g = this.game;
    this.started = true;
    await g.director.play((d) => playIntro(g, d));
    await this.chapterCard();
    await this.startStep();
    g.save();
  }

  private async chapterCard(): Promise<void> {
    const c = this.chapters[this.chapter];
    if (!c) return;
    this.game.hud.banner(c.title, c.subtitle, 4200);
  }

  private async startStep(): Promise<void> {
    const s = this.current;
    if (!s?.start) return;
    await s.start(this.game, this.game.director);
  }

  update(dt: number): void {
    const g = this.game;
    for (const a of this.actors) a.sync(dt);
    if (!this.started || this.busy || g.mode !== 'play') return;
    const s = this.current;
    if (!s) {
      g.hud.setObjectives('', []);
      g.setStoryWaypoint(null);
      return;
    }
    const c = this.chapters[this.chapter];
    g.hud.setObjectives(`${c.title} · ${c.subtitle}`, [{ text: s.text, progress: s.progress?.(g) }]);
    g.setStoryWaypoint(s.waypoint?.(g) ?? null);
    if (s.done(g)) void this.advance();
  }

  private async advance(): Promise<void> {
    const g = this.game;
    const s = this.current;
    if (!s) return;
    this.busy = true;
    try {
      g.audioCue('objective');
      if (s.finish) await s.finish(g, g.director);
      this.step++;
      const c = this.chapters[this.chapter];
      if (this.step >= c.steps.length) {
        g.hud.banner(`${c.title} COMPLETE`, c.subtitle, 3600, 'gold');
        g.addMoney(this.chapter === 0 ? 0 : 2500 * (this.chapter + 1), `${c.title.toLowerCase()} bonus`);
        this.chapter++;
        this.step = 0;
        await new Promise((r) => setTimeout(r, 3800));
        if (this.chapter < this.chapters.length) await this.chapterCard();
        else await g.finale();
      } else g.hud.toast('Objective complete', 'good');
      await this.startStep();
      g.save();
    } finally {
      this.busy = false;
    }
  }
}
