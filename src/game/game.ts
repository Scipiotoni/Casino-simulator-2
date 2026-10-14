import * as THREE from 'three';
import { Renderer } from '../render/renderer';
import { Input } from '../core/input';
import { World } from './world';
import { CharacterModel, BONES } from '../chars/model';
import { loadBodies } from '../chars/bodies';
import { loadCars } from '../vehicles/carModels';
import { setFaceDetail } from '../chars/faces';
import { Animator, ROLL_TIME, rollSwell, type Pose } from '../chars/anim';
import { SKINS, appearanceFromSkin, lockPieces, skinById, type Appearance } from '../chars/skins';
import { Player } from './player';
import { CameraRig } from './cameraRig';
import { Hud } from '../ui/hud';
import { Interactions, labelOf, subOf, type Interactable } from './interact';
import { audio, type SfxName } from '../core/audio';
import { GamblingSession } from '../casino/session';
import { tweens } from '../core/tween';
import { Director } from '../story/director';
import { playIntro } from '../story/intro';
import { Flat } from '../world/flat';
import { Waypoint } from './waypoint';
import { VehicleSystem } from './vehicles';
import { BusinessSystem } from '../business/business';
import { FloorEditor } from '../business/floorEditor';
import { Combat } from '../combat/combat';
import { buildGun } from '../combat/gunModel';
import { gunDef } from '../combat/guns';
import { FortHammerhead } from '../world/base';
import { Crowd } from '../world/crowd';
import { Traffic } from '../world/traffic';
import { buildShops, type ShopSite } from '../world/shops';
import { GameUI } from '../ui/menus';
import { Panel } from '../ui/panel';
import { IslandMap, Minimap, type MapMarker } from '../ui/map';
import { loadSave, newSave, writeSave, type SaveData, type SavedLook } from './save';
import { VEHICLES, vehicleDef } from '../vehicles/models';
import { BIZ } from '../business/catalog';
import { el, money as fmtMoney } from '../ui/dom';
import type { Venue } from '../casino/venue';
import type { Activity } from '../activities/activity';
import { createActivities } from '../activities';
import { Multiplayer } from '../net/multiplayer';
import { Chat } from '../ui/chat';
import { LoadingScreen } from '../ui/loading';

export type GameMode = 'loading' | 'title' | 'play' | 'cutscene' | 'seated' | 'menu' | 'build';

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
  director!: Director;
  /** Your flat in Palm Court (where everyone starts). */
  flat!: Flat;
  waypoint!: Waypoint;
  vehicles!: VehicleSystem;
  business!: BusinessSystem;
  floorEditor!: FloorEditor;
  combat!: Combat;
  crowd!: Crowd;
  traffic!: Traffic;
  ui!: GameUI;
  map!: IslandMap;
  minimap!: Minimap;
  shops: ShopSite[] = [];
  /** Side activities (shoplifting, docks, collectibles, jobs…). */
  activities: Activity[] = [];
  /** Multiplayer hooks for shared lots (not used yet). */
  net: { publishLots(): void } | null = null;
  /** Everyone else on the island, and the chat. */
  mp!: Multiplayer;
  chat!: Chat;
  mode: GameMode = 'loading';
  private last = performance.now();
  /** Game clock: one game hour per real minute. */
  hours = 19.1;
  day = 1;
  timeScale = 1 / 60;
  money = 0;
  playerName = 'Rookie';
  appearance: Appearance = appearanceFromSkin('rookie');
  ownedSkins: string[] = ['rookie', 'rookieF'];
  /** Looks saved in the wardrobe. */
  looks: SavedLook[] = [];
  /** The wardrobe's editor is open: the camera frames the player, the HUD steps aside. */
  editingLook = false;
  /** Which way the player faces in the creator (dragged round to see the back). */
  previewYaw: number | null = null;
  /** What Esc does while the wardrobe's editor is open. */
  onEditEscape: (() => void) | null = null;
  stats: Record<string, number> = {};
  settings = { music: 0.45, sfx: 0.9, sensitivity: 1, invertY: false };
  uiRoot!: HTMLDivElement;
  private loading!: LoadingScreen;
  private focused: Interactable | null = null;
  readonly fly = { x: 2600, y: 120, z: 400, yaw: 0, pitch: -0.2 };
  private debugAnims: Animator[] = [];
  /** ?chars=roll holds the roll at this phase (?phase=0.4); otherwise it loops. */
  private debugPhase: number | null = null;
  private realDt = 0;
  private tmpV = new THREE.Vector3();
  private tmpE = new THREE.Vector3();
  /** Past the title screen (a game is loaded or started). */
  started = false;
  private saveT = 30;
  private titleT = 0;
  private userWp: { x: number; z: number; label: string } | null = null;

  constructor(private app: HTMLElement) {
    this.renderer = new Renderer(app);
    setFaceDetail(this.renderer.settings.quality === 'low');
    this.input = new Input(this.renderer.gl.domElement);
    this.world = new World(this.renderer);
    this.camera = new CameraRig(this.renderer.camera);
  }

  async boot(): Promise<void> {
    this.loading = new LoadingScreen(this.app);
    const step = async (f: number, m: string) => {
      this.loading.progress(f, m);
      await new Promise((r) => setTimeout(r, 16));
    };
    await step(0.02, 'Dressing the locals');
    await loadBodies((n) => (BONES as readonly string[]).indexOf(n));
    await step(0.03, 'Waxing the cars');
    await loadCars(VEHICLES);
    await this.world.build((f, m) => step(f * 0.85, m));
    this.uiRoot = document.createElement('div');
    this.uiRoot.className = 'ui-root';
    this.app.appendChild(this.uiRoot);
    this.hud = new Hud(this.uiRoot);
    this.hud.onPromptTap = () => this.useFocused();
    this.player = new Player(this.renderer.scene, this.appearance);
    this.session = new GamblingSession(this, this.uiRoot);
    this.session.onRecord = (_kind, staked, returned, practice) => this.onGamble(staked, returned, practice);
    this.ui = new GameUI(this);
    this.director = new Director(this, this.uiRoot);
    this.waypoint = new Waypoint(this.renderer.scene, this.uiRoot);
    this.vehicles = new VehicleSystem(this);
    await step(0.88, 'Opening the shops');
    this.shops = buildShops(this);
    this.business = new BusinessSystem(this);
    this.floorEditor = new FloorEditor(this);
    this.combat = new Combat(this, this.uiRoot);
    await step(0.92, 'Posting guards at Fort Hammerhead');
    this.world.base = new FortHammerhead(this);
    this.world.base.spawnVehicles();
    await step(0.95, 'Filling the streets');
    this.crowd = new Crowd(this, this.renderer.spec.crowd);
    this.traffic = new Traffic(this, this.renderer.spec.traffic);
    this.flat = new Flat(this);
    await step(0.97, 'Setting up side jobs');
    this.activities = createActivities(this);
    await step(0.98, 'Drawing the map');
    this.map = new IslandMap(this.world.terrain);
    this.minimap = new Minimap(this, this.uiRoot, this.map);
    this.mp = new Multiplayer(this);
    this.chat = new Chat(this, this.uiRoot);
    this.registerSeats();
    window.addEventListener('pointerdown', () => audio.unlock());
    window.addEventListener('keydown', () => audio.unlock());
    window.addEventListener('beforeunload', () => this.save());
    document.addEventListener('visibilitychange', () => document.hidden && this.save());
    this.loading.done();
    requestAnimationFrame(this.loop);

    const q = new URLSearchParams(location.search);
    if (q.has('fly') || q.has('chars') || q.has('dev')) return this.devStart(q);
    await this.titleFlow();
  }

  /** Title screen → new game (creator + intro) or continue. */
  private async titleFlow(): Promise<void> {
    const save = loadSave();
    this.mode = 'title';
    this.camera.mode = 'cinematic';
    this.hud.setVisible(false);
    this.minimap.setVisible(false);
    this.input.wantLock = false;
    const summary = save ? `${save.name} · Day ${save.day} · ${fmtMoney(save.money)}` : '';
    const choice = await this.ui.title(!!save, summary);
    if (choice === 'continue' && save) {
      this.applySave(save);
      this.hud.setVisible(true);
      this.minimap.setVisible(true);
      // Down from the title's fly-over to the player (it was left up in the sky).
      this.camera.mode = this.player.firstPerson ? 'first' : 'third';
      this.mode = 'play';
      this.input.wantLock = true;
      this.hud.banner('WELCOME BACK', save.name.toUpperCase(), 2600);
      this.mp.start();
      return;
    }
    // New game: frame the player on the bridge's welcome plaza while they choose a look.
    this.mode = 'title';
    this.titleT = -1;
    const px = 3560;
    const pz = -290;
    this.player.teleport(px, this.world.groundY(px, pz, 60), pz, Math.PI / 2);
    this.camera.cinePos.set(px + 3.2, this.player.pos.y + 1.5, pz + 0.6);
    this.camera.cineLook.set(px, this.player.pos.y + 1.05, pz);
    this.camera.cineFov = 40;
    this.hours = 18.6;
    const made = await this.ui.creator();
    this.playerName = made.name;
    this.setAppearance(made.appearance);
    const s = newSave(made.name, made.appearance);
    this.money = s.money;
    this.day = s.day;
    this.hours = s.hours;
    this.ownedSkins = [...s.ownedSkins];
    this.looks = [];
    this.stats = {};
    this.started = true;
    this.hud.setVisible(true);
    this.minimap.setVisible(true);
    this.hud.setMoney(this.money, true);
    this.mp.start();
    await this.director.play((d) => playIntro(this, d));
    this.save();
  }

  /** Dev entry points (?fly, ?chars, ?dev&x=..&z=..). */
  private devStart(q: URLSearchParams): void {
    const sx = q.has('x') ? Number(q.get('x')) : 3520;
    const sz = q.has('z') ? Number(q.get('z')) : -300;
    this.player.teleport(sx, this.world.groundY(sx, sz), sz, -Math.PI / 2);
    this.camera.yaw = Math.PI / 2;
    if (q.has('h')) this.hours = Number(q.get('h'));
    if (q.has('money')) this.money = Number(q.get('money'));
    this.hud.setMoney(this.money, true);
    if (q.has('fly')) {
      this.camera.mode = 'free';
      this.fly.x = sx;
      this.fly.z = sz;
      if (q.has('y')) this.fly.y = Number(q.get('y'));
      if (q.has('yaw')) this.fly.yaw = Number(q.get('yaw'));
      if (q.has('pitch')) this.fly.pitch = Number(q.get('pitch'));
    }
    if (q.has('phase')) this.debugPhase = Number(q.get('phase'));
    if (q.has('chars')) this.debugLineup(q.get('chars') ?? '');
    this.started = q.has('save');
    this.mode = 'play';
    if (q.has('mp')) this.mp.start();
  }

  // ---------------------------------------------------------------- saving

  save(manual = false): void {
    if (!this.started) return;
    const p = this.player.pos;
    const v = this.vehicles.driving;
    const pos = v ? { x: v.exitPoint().x, y: v.pos.y, z: v.exitPoint().z, yaw: v.heading } : { x: p.x, y: p.y, z: p.z, yaw: this.player.yaw };
    const data: SaveData = {
      version: 1,
      name: this.playerName,
      appearance: this.appearance,
      ownedSkins: this.ownedSkins,
      money: Math.round(this.money),
      day: this.day,
      hours: this.hours,
      pos,
      businesses: this.business.serialize(),
      vehicles: this.vehicles.list.filter((c) => c.owned).map((c) => ({ id: c.id, def: c.def.id, color: c.color, x: c.pos.x, z: c.pos.z, heading: c.heading })),
      weapons: [...this.combat.owned],
      stats: this.stats,
      activities: Object.fromEntries(this.activities.filter((a) => a.save).map((a) => [a.id, a.save!()])),
      looks: this.looks,
      settings: this.settings,
      savedAt: Date.now(),
    };
    writeSave(data);
    if (manual) audio.play('coin');
  }

  private applySave(s: SaveData): void {
    this.playerName = s.name;
    this.ownedSkins = s.ownedSkins;
    this.setAppearance(lockPieces(s.appearance, s.ownedSkins));
    this.looks = s.looks ?? [];
    this.money = s.money;
    this.day = s.day;
    this.hours = s.hours;
    this.stats = s.stats;
    this.settings = { ...this.settings, ...s.settings };
    this.camera.sensitivity = this.settings.sensitivity;
    this.camera.invertY = this.settings.invertY;
    this.applyAudio();
    for (const c of s.vehicles) this.vehicles.spawn(c.def, c.x, c.z, c.heading, { owned: true, color: c.color, id: c.id });
    this.business.load(s.businesses);
    for (const w of s.weapons) if (!this.combat.owned.includes(w)) this.combat.owned.push(w);
    for (const w of this.combat.owned) this.combat.ammo[w] = 999;
    this.combat.ammo = Object.fromEntries(this.combat.owned.map((w) => [w, 99]));
    for (const a of this.activities) if (a.load && s.activities?.[a.id] !== undefined) a.load(s.activities[a.id]);
    if ((this.stats.goldenChip ?? 0) > 0) this.world.base.takeChip(false);
    const y = this.world.groundY(s.pos.x, s.pos.z, s.pos.y + 1.5);
    this.player.teleport(s.pos.x, y, s.pos.z, s.pos.yaw);
    this.camera.yaw = s.pos.yaw + Math.PI;
    this.hud.setMoney(this.money, true);
    this.started = true;
  }

  // ---------------------------------------------------------------- systems glue

  /** Every seat at every table gets a "sit down" prompt. Your own casino's tables are practice tables. */
  registerSeats(only?: Venue, mine = false): void {
    for (const v of only ? [only] : this.world.venues) {
      this.interactions.removePrefix(`seat:${v.opts.id}:`);
      v.tables.forEach((pt, ti) => {
        const t = pt.table;
        t.seats.forEach((s, si) => {
          const wp = t.group.localToWorld(new THREE.Vector3(s.x, 0, s.z));
          this.interactions.add({
            id: `seat:${v.opts.id}:${ti}:${si}`,
            x: wp.x, y: v.floorY, z: wp.z, radius: 1.0,
            label: () => (mine ? `Try your ${t.name}` : `Play ${t.name}`),
            sub: () => (mine ? 'Practice chips: it’s your own house' : t.kind === 'slots' || t.kind === 'videopoker' ? `$${t.minBet}–$${t.maxBet} a credit` : `$${t.minBet.toLocaleString('en-US')} – $${t.maxBet.toLocaleString('en-US')}`),
            enabled: () => s.who !== 'player' && !this.session.active,
            action: () => this.session.sit(t, si, mine),
          });
        });
      });
    }
  }

  private onGamble(staked: number, returned: number, practice: boolean): void {
    if (practice) return;
    const net = returned - staked;
    this.stats.wagered = (this.stats.wagered ?? 0) + staked;
    this.stats.gambleNet = (this.stats.gambleNet ?? 0) + net;
    const v = this.world.venueAt(this.player.pos.x, this.player.pos.z) ?? this.world.venueAt(this.player.anchor.x, this.player.anchor.z);
    if (v?.opts.id === 'goldenViper') this.stats.viperNet = (this.stats.viperNet ?? 0) + net;
  }

  setUserWaypoint(x: number, z: number, label: string): void {
    this.userWp = { x, z, label };
    this.refreshWaypoint();
    audio.play('blip');
  }

  clearUserWaypoint(): void {
    this.userWp = null;
    this.refreshWaypoint();
  }

  private refreshWaypoint(): void {
    const w = this.userWp;
    if (!w) {
      if (this.waypoint.target) this.waypoint.clear();
      return;
    }
    const t = this.waypoint.target;
    if (t && t.x === w.x && t.z === w.z && this.waypoint.label === w.label) return;
    this.waypoint.set(w.x, this.world.groundY(w.x, w.z), w.z, w.label);
  }

  /** Markers for the minimap (and the big map when `full`). */
  mapMarkers(full = false): MapMarker[] {
    const out: MapMarker[] = [];
    for (const v of this.world.venues) {
      const mine = v.opts.id.startsWith('mine:');
      if (mine) continue;
      out.push({ x: v.door.x, z: v.door.z, icon: '🎰', color: '#b23cff', label: v.opts.name, big: full });
    }
    for (const s of this.shops) out.push({ x: s.door.x, z: s.door.z, icon: s.icon, color: '#2a6ad8', label: s.name, big: false });
    out.push({ x: this.flat.door.x, z: this.flat.door.z, icon: '🏠', color: '#1f9a4c', label: 'Your flat', big: true });
    for (const b of this.business.owned) {
      const c = { x: (b.lot.x0 + b.lot.x1) / 2, z: (b.lot.z0 + b.lot.z1) / 2 };
      const def = BIZ.find((d) => d.type === b.save.type);
      out.push({ x: c.x, z: c.z, icon: def?.icon ?? '🏗️', color: '#1f9a4c', label: b.save.name, big: full });
    }
    if (full) {
      for (const l of this.business.saleLots()) out.push({ x: (l.x0 + l.x1) / 2, z: (l.z0 + l.z1) / 2, icon: '$', color: '#c89a12' });
      const b = this.world.base;
      out.push({ x: b.gate.x, z: b.gate.z, icon: '✈', color: '#5d6b3a', label: 'Fort Hammerhead', big: true });
      const L = this.world.landmarks;
      out.push({ x: L.lighthouse.x, z: L.lighthouse.z, icon: '🗼', color: '#d84a3a', label: L.lighthouse.name, big: true });
      out.push({ x: L.oldTown.x, z: L.oldTown.z, icon: '⚓', color: '#3a7bd5', label: L.oldTown.name, big: true });
    }
    for (const c of this.vehicles.list) if (c.owned && c !== this.vehicles.driving) out.push({ x: c.pos.x, z: c.pos.z, icon: '🚗', color: '#3ddc84' });
    for (const a of this.activities) if (a.markers) out.push(...a.markers(full));
    const w = this.userWp;
    if (w) out.push({ x: w.x, z: w.z, icon: '★', color: '#ffb800', label: w.label, big: true });
    return out;
  }

  netWorth(): number {
    let n = this.money;
    for (const b of this.business.owned) n += this.business.value(b);
    for (const c of this.vehicles.list) if (c.owned) n += vehicleDef(c.def.id).price;
    return n;
  }

  audioCue(name: string): void {
    audio.play(name as SfxName);
  }

  crime(what: string, stars: number): void {
    this.combat.crime(what, stars);
  }

  /** Go to the police: lose your stars, pay a fine. */
  turnIn(): void {
    if (this.combat.wanted <= 0) {
      this.hud.toast('Nobody’s looking for you. Have a nice day!', 'info');
      return;
    }
    const fine = Math.min(Math.round(this.money * 0.1), 2500 * this.combat.wanted);
    this.addMoney(-fine, 'fine');
    this.combat.reset();
    this.hud.banner('CHARGES DROPPED', `Fine paid: ${fmtMoney(fine)}`, 2600);
  }

  /** After a knockout: hospital (or the police station when you were wanted). */
  respawn(busted: boolean): void {
    const key = busted ? 'police' : 'hospital';
    const s = this.shops.find((x) => x.key === key);
    const loss = Math.min(Math.round(this.money * 0.1), busted ? 10000 : 5000);
    this.money -= loss;
    this.combat.reset();
    const p = this.player;
    p.mode = 'walk';
    p.poseOverride = null;
    if (s) p.teleport(s.door.x + Math.sin(s.yaw) * 3, s.door.y, s.door.z + Math.cos(s.yaw) * 3, s.yaw);
    this.camera.yaw = (s?.yaw ?? 0) + Math.PI;
    this.hud.toast(busted ? `Busted: ${fmtMoney(loss)} in fines` : `Hospital bill: ${fmtMoney(loss)}`, 'bad', 4000);
    this.save();
  }

  /** Sleep at home until 8 AM (your businesses keep earning). */
  sleep(): void {
    const target = this.hours < 8 ? 8 : 32;
    const d = this.director;
    void d.play(async (dd) => {
      dd.black();
      await dd.title('Zzz…', '', 1.4);
      this.hours = target;
      while (this.hours >= 24) {
        this.hours -= 24;
        this.day++;
      }
      this.combat.reset();
      this.business.update(0);
    }).then(() => {
      this.hud.banner('GOOD MORNING', `DAY ${this.day}`, 2400);
      this.save();
    });
  }

  buyCar(id: string): void {
    const def = vehicleDef(id);
    if (this.money < def.price) {
      this.hud.toast(`You need ${fmtMoney(def.price)}`, 'bad');
      return;
    }
    const s = this.shops.find((x) => x.key === 'carDealer');
    if (!s) return;
    this.addMoney(-def.price, `for the ${def.name}`);
    // Delivered to the kerb in front of the dealer.
    const x = s.door.x + Math.sin(s.yaw) * 24;
    const z = s.door.z + Math.cos(s.yaw) * 24;
    const v = this.vehicles.spawn(id, x, z, s.yaw + Math.PI / 2, { owned: true });
    audio.play('purchase');
    this.hud.banner('NEW CAR', def.name.toUpperCase(), 2400, 'gold');
    this.setUserWaypoint(v.pos.x, v.pos.z, def.name);
    this.save();
  }

  setAppearance(a: Appearance): void {
    this.appearance = a;
    this.player.setAppearance(a);
    this.player.setHeadVisible(!this.player.firstPerson);
    this.combat?.reattach();
  }

  /**
   * Quick travel from the map: a short fade to black and you're standing there on foot, facing
   * `yaw` (a car you were driving stays where you left it). Not with the police after you.
   */
  fastTravel(x: number, z: number, yaw: number, label: string): boolean {
    if (this.combat.wanted > 0) {
      this.hud.toast('Lose the police first', 'bad');
      audio.play('error');
      return false;
    }
    if (this.player.mode === 'dead' || this.director.playing || this.mode === 'seated' || this.mode === 'build' || this.travelling) return false;
    const v = this.vehicles.driving;
    if (v) {
      if (v.isBoat) {
        this.hud.toast('Bring the boat back to land first', 'bad');
        return false;
      }
      v.speed = 0;
      this.vehicles.exit();
      if (this.vehicles.driving) return false;
    }
    this.minimap.setBig(false);
    this.travelling = true;
    const fade = el('div', 'travel-fade');
    this.uiRoot.appendChild(fade);
    requestAnimationFrame(() => fade.classList.add('on'));
    audio.play('whoosh');
    window.setTimeout(() => {
      this.player.teleport(x, this.world.groundY(x, z), z, yaw);
      this.camera.yaw = yaw + Math.PI;
      this.camera.pitch = -0.12;
      this.hud.toast(`📍 ${label}`, 'info');
      fade.classList.remove('on');
      window.setTimeout(() => fade.remove(), 450);
      this.travelling = false;
      this.save();
    }, 380);
    return true;
  }

  private travelling = false;

  /** The most open direction round the player, and how far it is to a wall that way (for framing them). */
  openFacing(): { yaw: number; room: number } {
    const p = this.player.pos;
    let best = { yaw: this.player.yaw, room: -1 };
    for (let i = 0; i < 12; i++) {
      const yaw = this.player.yaw + (i * Math.PI) / 6;
      const d = this.world.collision.raycast(p.x, p.y + 1.4, p.z, Math.sin(yaw), 0, Math.cos(yaw), 6);
      if (d > best.room + 0.3) best = { yaw, room: d };
    }
    return best;
  }

  /** Put on a catalog outfit; your own body, face and hair stay as they are. */
  wear(id: string): void {
    const s = skinById(id);
    const a = this.appearance;
    this.setAppearance({ ...a, outfit: { ...s.appearance.outfit }, skinId: s.id });
  }

  unlockSkin(id: string): void {
    if (this.ownedSkins.includes(id)) return;
    this.ownedSkins.push(id);
    const s = skinById(id);
    this.hud.banner('OUTFIT UNLOCKED', s.name.toUpperCase(), 3000, 'gold');
  }

  applyQuality(): void {
    const spec = this.renderer.spec;
    setFaceDetail(this.renderer.settings.quality === 'low');
    this.world.terrainMesh.setDetail(spec.terrain);
    this.world.sky.setShadows(spec.shadows, spec.shadowSize);
  }

  applyAudio(): void {
    audio.applySettings({ master: 0.8, sfx: this.settings.sfx, music: this.settings.music });
    audio.setMusic(this.settings.music > 0.01);
  }

  enterMenu(): void {
    if (this.mode === 'play') this.mode = 'menu';
    this.input.wantLock = false;
    this.input.exitLock();
    this.hud.setPrompt(null);
  }

  leaveMenu(): void {
    // The wardrobe's editor took over from the panel that just closed: stay in the menu.
    if (this.editingLook) return;
    if (this.mode === 'menu') this.mode = 'play';
    if (this.mode === 'play') {
      this.input.wantLock = true;
      // Closing with a click (Resume, a shop's button) counts as the gesture that may grab
      // the mouse, so mouse look comes straight back; if the browser says no, the
      // "click to look around" hint asks for one more click.
      if (!this.input.touchMode && !this.input.locked) this.input.requestLock();
    }
    this.input.suppressClicks(200);
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
      if (pose === 'aimPistol' || pose === 'aimRifle') m.attach(buildGun(gunDef(pose === 'aimRifle' ? 'rifle' : 'pistol')).group);
      m.setExpression((['happy', 'grin', 'neutral', 'smirk', 'surprised', 'angry', 'sad', 'wink'] as const)[i % 8]);
      this.debugAnims.push(an);
    });
    this.camera.mode = 'free';
    Object.assign(this.fly, { x: 3500, y: y + 1.5, z: 405.5, yaw: 0, pitch: -0.05 });
  }

  // ---------------------------------------------------------------- loop

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
    this.updateLockHint(dt);
    this.input.endFrame();
    requestAnimationFrame(this.loop);
  };

  private lockHint: HTMLDivElement | null = null;
  private unlockedT = 0;

  /** Playing with a mouse that isn't captured (after Esc, or a refused lock): say how to get it back. */
  private updateLockHint(dt: number): void {
    if (!this.uiRoot) return;
    const inp = this.input;
    const want = this.mode === 'play' && inp.wantLock && !inp.locked && !inp.touchMode && !this.director.playing && !this.chat.open && (this.camera.mode === 'third' || this.camera.mode === 'first' || this.camera.mode === 'vehicle');
    this.unlockedT = want ? this.unlockedT + dt : 0;
    if (!this.lockHint) {
      this.lockHint = document.createElement('div');
      this.lockHint.className = 'lock-hint';
      this.lockHint.textContent = 'Click to look around';
      this.uiRoot.appendChild(this.lockHint);
    }
    this.lockHint.classList.toggle('on', this.unlockedT > 0.6);
  }

  get canMove(): boolean {
    return this.mode === 'play' && !this.hud.dialogOpen && this.player.mode !== 'dead';
  }

  private update(dt: number, now: number): void {
    this.renderer.trackFrame(dt, now);
    const inp = this.input;
    if (this.mode === 'loading') return;
    // Clock.
    this.hours += dt * this.timeScale;
    if (this.hours >= 24) {
      this.hours -= 24;
      this.day++;
    }
    if (this.hud.dialogOpen && (inp.pressed('KeyE') || inp.pressed('Space') || inp.pressed('Enter'))) this.hud.advanceDialog();
    tweens.update(this.realDt);
    this.director.update(dt);
    // Menus: Esc closes the open panel; Esc / P / M open the pause menu and the map.
    if (this.mode === 'menu' && this.editingLook) {
      if (inp.pressed('Escape')) this.onEditEscape?.();
    } else if (this.mode === 'menu' && this.minimap.big && (inp.pressed('Escape') || inp.pressed('KeyM'))) this.minimap.setBig(false);
    else if (this.mode === 'menu' && (inp.pressed('Escape') || (inp.pressed('KeyP') && Panel.open?.isPause))) Panel.open?.close();
    else if (this.mode === 'play' && !this.hud.dialogOpen) {
      if (inp.pressed('KeyP') || (inp.pressed('Escape') && !inp.locked)) this.ui.pauseMenu();
      else if (inp.pressed('KeyM')) this.minimap.setBig(true);
    }
    const driving = this.vehicles.driving;
    if (this.mode === 'title') {
      this.updateTitle(dt);
    } else if (this.camera.mode === 'free') {
      this.updateFly(dt);
    } else if (this.mode === 'build') {
      this.floorEditor.update(dt);
      this.camera.update(dt, this.world, this.player.pos, this.player.pos, this.renderer.settings.fov);
    } else if (this.mode === 'seated') {
      this.session.update();
      this.camera.look(inp, inp.mouseDown[2]);
      this.player.update(dt, null, this.camera.yaw, this.world, false);
      this.player.eyePosition(this.tmpE);
      this.camera.update(dt, this.world, this.tmpV.copy(this.player.pos), this.tmpE, this.renderer.settings.fov, this.session.cursor());
    } else if (driving && this.mode !== 'cutscene') {
      this.camera.look(inp, this.mode === 'play');
      this.vehicles.update(dt, this.canMove);
      this.player.update(dt, null, this.camera.yaw, this.world, false);
      if (this.vehicles.driving) {
        const focus = this.vehicles.focus(this.tmpV);
        const eye = this.vehicles.cockpitEye(this.tmpE);
        this.camera.update(dt, this.world, focus, eye, this.renderer.settings.fov);
      }
      this.hud.setPrompt(this.mode === 'play' && this.vehicles.driving ? null : null);
    } else {
      this.camera.look(inp, this.mode === 'play');
      if (inp.pressed('KeyV') && this.mode === 'play') this.toggleFirstPerson();
      if (this.mode === 'cutscene') this.vehicles.update(dt, false);
      else this.vehicles.update(dt, false);
      this.player.update(dt, inp, this.camera.yaw, this.world, this.canMove);
      this.updatePrompts();
      const focus = this.tmpV.copy(this.player.pos);
      // A dodge roll dips the view a little (and tumbles it in first person).
      focus.y += 1.62 - rollSwell(this.player.rollPhase) * 0.3;
      Object.assign(this.camera.tumble, this.player.rollTumble(this.camera.yaw));
      this.player.eyePosition(this.tmpE);
      this.camera.update(dt, this.world, focus, this.tmpE, this.renderer.settings.fov);
    }
    if (this.mode !== 'title') {
      this.combat.update(dt, this.canMove);
      this.flat.update();
      this.business.update(dt);
      this.world.base.update(dt);
      this.crowd.update(dt);
      this.traffic.update(dt);
      for (const a of this.activities) a.update(dt);
      this.mp.update(dt);
    }
    const cam = this.renderer.camera;
    const focusPos = this.camera.mode === 'free' || this.mode === 'title' ? cam.position : driving ? driving.pos : this.player.pos;
    this.world.update(dt, this.hours, focusPos);
    for (const a of this.debugAnims) {
      if (a.pose === 'roll') a.action = this.debugPhase ?? Math.min(1, (now % (ROLL_TIME + 0.5)) / ROLL_TIME);
      a.update(dt);
    }
    audio.listener.x = cam.position.x;
    audio.listener.z = cam.position.z;
    audio.listener.yaw = this.camera.yaw;
    const showHud = (this.mode === 'play' || this.mode === 'menu') && !this.editingLook;
    this.waypoint.update(cam, this.player.pos, showHud);
    if (showHud && (this.mode === 'play' || this.minimap.big)) {
      const heading = driving ? driving.heading : this.player.yaw;
      this.minimap.update(dt, focusPos.x, focusPos.z, heading, this.mapMarkers(false), driving ? Math.abs(driving.speed) : 0);
    }
    this.minimap.setVisible(this.mode === 'play' || this.minimap.big);
    this.hud.setClock(this.day, this.hours);
    this.hud.setMoney(this.money);
    this.hud.update(dt);
    // Autosave.
    this.saveT -= dt;
    if (this.saveT <= 0) {
      this.saveT = 45;
      if (this.mode === 'play') this.save();
    }
  }

  /** The "use" prompt: the nearest interactable you face, or a car in traffic to take. */
  private updatePrompts(): void {
    const inp = this.input;
    if (this.mode !== 'play' || this.hud.dialogOpen || this.player.mode !== 'walk') {
      this.hud.setPrompt(null);
      return;
    }
    const p = this.player.pos;
    this.focused = this.interactions.find(p.x, p.y, p.z, this.player.firstPerson || this.combat.armed ? this.camera.yaw + Math.PI : this.player.yaw);
    if (this.focused) {
      this.hud.setPrompt(labelOf(this.focused), subOf(this.focused));
      if (inp.pressed('KeyE')) this.useFocused();
      return;
    }
    const car = this.traffic.nearest(p.x, p.z, 3.6);
    if (car) {
      this.hud.setPrompt(`Take the ${car.def.name}`, 'The driver won’t like it (and neither will the police)');
      if (inp.pressed('KeyE')) this.traffic.carjack(car);
      return;
    }
    this.hud.setPrompt(null);
  }

  /** The title screen's slow fly-over of the Strip at dusk. */
  private updateTitle(dt: number): void {
    if (this.titleT < 0) {
      // Creator: the camera holds on the player; let them idle.
      this.player.update(dt, null, 0, this.world, false);
      this.player.model.root.rotation.y = this.previewYaw ?? Math.PI / 2 + Math.sin(performance.now() / 2400) * 0.4;
      this.camera.update(dt, this.world, this.player.pos, this.player.pos, this.renderer.settings.fov);
      return;
    }
    this.titleT += dt;
    const a = this.titleT * 0.03;
    const cx = 2550;
    const cz = -200;
    this.camera.cinePos.set(cx + Math.cos(a) * 1100, 260, cz + Math.sin(a) * 1100);
    this.camera.cineLook.set(cx, 40, cz);
    this.camera.cineFov = 45;
    this.hours = 19.3;
    this.camera.update(dt, this.world, this.player.pos, this.player.pos, this.renderer.settings.fov);
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
    this.hud.setCrosshair(fp || this.combat.armed);
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
