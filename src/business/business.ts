import * as THREE from 'three';
import type { Game } from '../game/game';
import type { BusinessSave } from '../game/save';
import { lotFrontPoint, lotCenter, type Lot } from '../world/layout';
import { BIZ, bizDef, buildCost, casinoHourly, casinoLevel, dealersNeeded, floorItem, hourlyIncome, lotArea, upgradeCost, MAX_LEVEL, type BizType } from './catalog';
import { Venue, THEMES } from '../casino/venue';
import { buildHouse, buildSite, furnish, nameSign, forSaleTexture } from './visuals';
import { FACTORIES } from '../world/venues';
import { audio } from '../core/audio';

/**
 * Your property empire. Buy any lot with a FOR SALE sign (or from Paradise Realty), choose
 * what to build on it, watch it go up, then collect what it earns every game hour. Casinos
 * earn from the machines and tables you put on their floor; everything else earns by its
 * type, its level, the district and the time of day.
 */

export class Business {
  venue: Venue | null = null;
  visual: THREE.Group | null = null;
  site: THREE.Group | null = null;
  sign: THREE.Group | null = null;
  house: ReturnType<typeof buildHouse> | null = null;
  constructor(public save: BusinessSave, public lot: Lot) {}

  get def() {
    return bizDef(this.save.type);
  }
}

export class BusinessSystem {
  readonly owned: Business[] = [];
  private signs: THREE.InstancedMesh;
  private posts: THREE.InstancedMesh;
  private signIndex = new Map<string, number>();
  private hourMark = -1;
  private pending = 0;
  private reportT = 0;
  /** Lots other players own (multiplayer), so they aren't for sale. */
  readonly taken = new Set<string>();

  constructor(private game: Game) {
    const lots = this.saleLots(true);
    this.signs = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.4, 1.4), new THREE.MeshBasicMaterial({ map: forSaleTexture(), side: THREE.DoubleSide, toneMapped: false }), lots.length);
    this.posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), new THREE.MeshLambertMaterial({ color: 0xf4f4f4 }), lots.length * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    lots.forEach((l, i) => {
      const fp = lotFrontPoint(l);
      const y = game.world.terrain.lotY.get(l.id) ?? 6;
      const x = fp.x - Math.sin(fp.yaw) * 3;
      const z = fp.z - Math.cos(fp.yaw) * 3;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), fp.yaw);
      m.compose(new THREE.Vector3(x, y + 2.0, z), q, s);
      this.signs.setMatrixAt(i, m);
      const rx = Math.cos(fp.yaw);
      const rz = -Math.sin(fp.yaw);
      for (const k of [0, 1]) {
        m.compose(new THREE.Vector3(x + rx * (k ? 1.1 : -1.1), y + 1.3, z + rz * (k ? 1.1 : -1.1)), q, s);
        this.posts.setMatrixAt(i * 2 + k, m);
      }
      this.signIndex.set(l.id, i);
      game.interactions.add({
        id: `lot:${l.id}`,
        x, y, z, radius: 6,
        label: () => (this.ownerOf(l) ? 'Your lot' : `Buy this lot`),
        sub: () => (this.ownerOf(l) ? '' : `$${l.price.toLocaleString('en-US')} · ${districtName(l.district)} · ${Math.round(lotArea(l)).toLocaleString('en-US')} m²`),
        enabled: () => !this.ownerOf(l) && !this.taken.has(l.id),
        action: () => this.game.ui.lotPanel(l),
      });
    });
    game.renderer.scene.add(this.signs, this.posts);
  }

  /** Every lot that can be bought (optionally including ones you already own). */
  saleLots(all = false): Lot[] {
    return this.game.world.terrain.lots.filter((l) => l.forSale && (all || (!this.ownerOf(l) && !this.taken.has(l.id))));
  }

  ownerOf(l: Lot): Business | null {
    return this.owned.find((b) => b.lot.id === l.id) ?? null;
  }

  private hideSign(lotId: string, hidden: boolean): void {
    const i = this.signIndex.get(lotId);
    if (i === undefined) return;
    const m = new THREE.Matrix4();
    this.signs.getMatrixAt(i, m);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    m.decompose(p, q, s);
    s.setScalar(hidden ? 0.0001 : 1);
    m.compose(p, q, s);
    this.signs.setMatrixAt(i, m);
    this.signs.instanceMatrix.needsUpdate = true;
    for (const k of [0, 1]) {
      this.posts.getMatrixAt(i * 2 + k, m);
      m.decompose(p, q, s);
      s.setScalar(hidden ? 0.0001 : 1);
      m.compose(p, q, s);
      this.posts.setMatrixAt(i * 2 + k, m);
    }
    this.posts.instanceMatrix.needsUpdate = true;
  }

  /** Restore everything from a save. */
  load(saves: BusinessSave[]): void {
    for (const s of saves) {
      const lot = this.game.world.terrain.lots.find((l) => l.id === s.lot);
      if (!lot) continue;
      const b = new Business(s, lot);
      this.owned.push(b);
      this.hideSign(lot.id, true);
      this.refresh(b);
    }
  }

  serialize(): BusinessSave[] {
    return this.owned.map((b) => b.save);
  }

  buyLot(l: Lot): boolean {
    const g = this.game;
    if (this.ownerOf(l) || !l.forSale || this.taken.has(l.id)) return false;
    if (g.money < l.price) {
      g.hud.toast(`You need $${l.price.toLocaleString('en-US')} for this lot`, 'bad');
      audio.play('error');
      return false;
    }
    g.addMoney(-l.price, `for lot ${l.id}`);
    const save: BusinessSave = { lot: l.id, type: 'empty', name: '', level: 1, earned: 0, today: 0, items: [], staff: 0, style: 0, builtAt: 0, building: 0, xp: 0 };
    const b = new Business(save, l);
    this.owned.push(b);
    this.hideSign(l.id, true);
    this.refresh(b);
    audio.play('purchase');
    g.hud.banner('LOT PURCHASED', `${l.street} · ${districtName(l.district)}`, 2600);
    g.net?.publishLots();
    g.save();
    return true;
  }

  canBuild(b: Business, t: BizType): { ok: boolean; why?: string } {
    const d = bizDef(t);
    if (lotArea(b.lot) < d.minArea) return { ok: false, why: `Needs a lot of at least ${d.minArea.toLocaleString('en-US')} m²` };
    if (t === 'house' && this.owned.some((x) => x.save.type === 'house' && x !== b)) return { ok: true };
    return { ok: true };
  }

  build(b: Business, t: BizType, name: string): boolean {
    const g = this.game;
    const cost = buildCost(t, b.lot);
    if (!this.canBuild(b, t).ok) return false;
    if (g.money < cost) {
      g.hud.toast(`Building costs $${cost.toLocaleString('en-US')}`, 'bad');
      audio.play('error');
      return false;
    }
    g.addMoney(-cost, `to build a ${bizDef(t).name.toLowerCase()}`);
    b.save.type = t;
    b.save.name = name.trim().slice(0, 28) || defaultName(t, g.playerName);
    b.save.level = 1;
    b.save.building = bizDef(t).buildTime;
    b.save.builtAt = Date.now();
    b.save.items = [];
    this.refresh(b);
    audio.play('purchase');
    g.hud.toast(`Construction started: ${b.save.name}`, 'good');
    g.save();
    return true;
  }

  upgrade(b: Business): boolean {
    const g = this.game;
    if (b.save.level >= MAX_LEVEL || b.save.type === 'empty') return false;
    const cost = upgradeCost(b.save.type as BizType, b.lot, b.save.level);
    if (g.money < cost) {
      g.hud.toast(`Upgrade costs $${cost.toLocaleString('en-US')}`, 'bad');
      return false;
    }
    g.addMoney(-cost, 'upgrade');
    b.save.level++;
    this.refresh(b);
    audio.play('levelup');
    g.hud.banner(`${b.save.name.toUpperCase()}`, `LEVEL ${b.save.level}`, 2400, 'gold');
    g.save();
    return true;
  }

  /** Sell a business (or an empty lot) back for 60% of what's in it. */
  sell(b: Business): void {
    const g = this.game;
    const back = Math.round(this.value(b) * 0.6);
    this.teardown(b);
    this.owned.splice(this.owned.indexOf(b), 1);
    this.hideSign(b.lot.id, false);
    g.addMoney(back, 'from the sale');
    g.net?.publishLots();
    g.save();
  }

  /** What a business is worth (land + building + upgrades + floor). */
  value(b: Business): number {
    let v = b.lot.price;
    if (b.save.type !== 'empty') {
      const t = b.save.type as BizType;
      v += buildCost(t, b.lot);
      for (let l = 1; l < b.save.level; l++) v += upgradeCost(t, b.lot, l);
      for (const it of b.save.items) v += floorItem(it.kind).price;
    }
    return v;
  }

  totalEarned(): number {
    return this.owned.reduce((a, b) => a + b.save.earned, 0);
  }

  casinoEarned(): number {
    return this.owned.filter((b) => b.save.type === 'casino').reduce((a, b) => a + b.save.earned, 0);
  }

  private teardown(b: Business): void {
    const g = this.game;
    if (b.venue) g.world.removeVenue(b.venue);
    b.venue = null;
    for (const o of [b.visual, b.site, b.sign]) o?.removeFromParent();
    b.visual = b.site = b.sign = null;
    b.house = null;
    g.interactions.removePrefix(`biz:${b.lot.id}`);
    g.interactions.removePrefix(`seat:mine:${b.lot.id}`);
    g.world.collision.removeTagged(`biz:${b.lot.id}`);
  }

  /** (Re)build a business's look and its interactions from its save. */
  refresh(b: Business): void {
    const g = this.game;
    this.teardown(b);
    const lot = b.lot;
    const y = g.world.terrain.lotY.get(lot.id) ?? 6;
    const fp = lotFrontPoint(lot);
    const front = { x: fp.x - Math.sin(fp.yaw) * 3, z: fp.z - Math.cos(fp.yaw) * 3 };
    if (b.save.type === 'empty') {
      b.sign = nameSign(lot, y, `SOLD · ${g.playerName.toUpperCase()}`, '#3ddc84');
      g.renderer.scene.add(b.sign);
      g.interactions.add({ id: `biz:${lot.id}:build`, x: front.x, y, z: front.z, radius: 6, label: 'Build on your lot', sub: `${districtName(lot.district)} · ${Math.round(lotArea(lot)).toLocaleString('en-US')} m²`, action: () => g.ui.buildPanel(b) });
      return;
    }
    if (b.save.building > 0) {
      b.site = buildSite(lot, y, 1 - b.save.building / bizDef(b.save.type).buildTime);
      g.renderer.scene.add(b.site);
      g.interactions.add({ id: `biz:${lot.id}:site`, x: front.x, y, z: front.z, radius: 7, label: () => `Building ${b.save.name}…`, sub: () => `${Math.ceil(b.save.building)} s to go`, action: () => g.hud.toast('The builders are on it!') });
      const c = lotCenter(lot);
      g.world.collision.addBox({ minX: c.x - 15, maxX: c.x + 15, minZ: c.z - 15, maxZ: c.z + 15, minY: y - 1, maxY: y + 12, tag: `biz:${lot.id}` });
      return;
    }
    const def = b.def;
    if (b.save.type === 'house') {
      b.sign = nameSign(lot, y, b.save.name.toUpperCase(), def.color);
      g.renderer.scene.add(b.sign);
      const h = buildHouse(lot, y, [0xf4f2ee, 0xe8dcc8, 0xd8e6f0][b.save.style % 3]);
      b.house = h;
      b.visual = h.group;
      g.renderer.scene.add(h.group);
      const c = h.group.localToWorld(new THREE.Vector3(0, 0, -6));
      const rot = Math.abs(Math.sin(h.yaw)) > 0.5;
      g.world.collision.addBox({ minX: c.x - (rot ? 6 : 9), maxX: c.x + (rot ? 6 : 9), minZ: c.z - (rot ? 9 : 6), maxZ: c.z + (rot ? 9 : 6), minY: y - 1, maxY: y + 7, tag: `biz:${lot.id}` });
      g.interactions.add({ id: `biz:${lot.id}:door`, x: h.door.x, y, z: h.door.z, radius: 3, label: 'Sleep until morning', sub: 'Saves your game', action: () => g.sleep() });
      g.interactions.add({ id: `biz:${lot.id}:manage`, x: front.x, y, z: front.z, radius: 4, label: () => `Manage ${b.save.name}`, action: () => g.ui.bizPanel(b) });
      return;
    }
    // Every other type is a venue with an interior.
    const theme = THEMES[b.save.type === 'casino' ? ['classic', 'royal', 'neon', 'lagoon', 'viper'][b.save.style % 5] : def.theme];
    const lw = lot.front === 'N' || lot.front === 'S' ? lot.x1 - lot.x0 : lot.z1 - lot.z0;
    const ld = lot.front === 'N' || lot.front === 'S' ? lot.z1 - lot.z0 : lot.x1 - lot.x0;
    const lv = b.save.level;
    const width = Math.min(lw - 6, (b.save.type === 'casino' ? 26 : 20) + lv * 6);
    const depth = Math.min(ld - 14, (b.save.type === 'casino' ? 20 : 16) + lv * 4);
    const v = new Venue(
      {
        id: `mine:${lot.id}`,
        name: b.save.name,
        theme,
        lot,
        y,
        width,
        depth,
        tower: b.save.type === 'hotel' ? 6 + lv * 5 : b.save.type === 'casino' && lv >= 4 ? lv * 3 : undefined,
        bar: b.save.type !== 'shop',
        cashier: b.save.type === 'casino',
        seed: lot.id.length,
        decor: (vv, k, gl) => furnish(b.save.type as BizType, vv, k, gl),
      },
      g.world.collision,
    );
    b.venue = v;
    g.world.addVenue(v);
    if (b.save.type === 'casino') this.rebuildFloor(b);
    const office = v.toWorld(v.W / 2 - 2.5, -3);
    g.interactions.add({ id: `biz:${lot.id}:manage`, x: office.x, y: v.floorY, z: office.z, radius: 2.5, label: () => `Manage ${b.save.name}`, sub: () => `Level ${b.save.level} · earned $${Math.round(b.save.earned).toLocaleString('en-US')}`, action: () => g.ui.bizPanel(b) });
    g.interactions.add({ id: `biz:${lot.id}:front`, x: front.x, y, z: front.z, radius: 4, label: () => `${b.save.name}`, sub: 'Manage your business', action: () => g.ui.bizPanel(b) });
  }

  /** Put the casino's machines and tables back on its floor (after any change). */
  rebuildFloor(b: Business): void {
    const v = b.venue;
    if (!v) return;
    const g = this.game;
    v.clearTables();
    g.interactions.removePrefix(`seat:mine:${b.lot.id}`);
    let seed = 7000 + b.save.items.length;
    for (const it of b.save.items) {
      const fi = floorItem(it.kind);
      const f = FACTORIES[it.kind];
      if (!f) continue;
      const t = f(seed++, { min: fi.minBet * (it.level || 1), max: fi.maxBet * (it.level || 1) });
      v.addTable(t, it.x, it.z, it.yaw);
      // Guests: busier floors in better spots.
      const share = Math.min(0.75, 0.25 + 0.12 * b.save.level + (bizDef('casino').district[b.lot.district] ?? 1) * 0.15);
      t.populate(share);
    }
    v.finalize();
    g.registerSeats(v, true);
  }

  /** Called every frame: construction and income. */
  update(dt: number): void {
    const g = this.game;
    for (const b of this.owned) {
      if (b.save.building > 0) {
        const before = Math.ceil(b.save.building);
        b.save.building -= dt;
        if (b.save.building <= 0) {
          b.save.building = 0;
          this.refresh(b);
          audio.play('levelup');
          g.hud.banner('GRAND OPENING', b.save.name.toUpperCase(), 3200, 'gold');
          g.save();
        } else if (Math.ceil(b.save.building) !== before && b.site && Math.ceil(b.save.building) % 5 === 0) {
          // Let the site grow now and then.
          const old = b.site;
          b.site = buildSite(b.lot, g.world.terrain.lotY.get(b.lot.id) ?? 6, 1 - b.save.building / bizDef(b.save.type).buildTime);
          g.renderer.scene.add(b.site);
          old.removeFromParent();
        }
      }
    }
    // Income lands every game hour.
    const hourNow = Math.floor(g.day * 24 + g.hours);
    if (this.hourMark < 0) this.hourMark = hourNow;
    while (this.hourMark < hourNow) {
      this.hourMark++;
      const h = this.hourMark % 24;
      let sum = 0;
      for (const b of this.owned) {
        if (b.save.type === 'empty' || b.save.building > 0) continue;
        let inc = 0;
        if (b.save.type === 'casino') {
          const lvBoost = 1 + 0.15 * (casinoLevel(b.save.earned) - 1) + 0.1 * (b.save.level - 1);
          const hotels = this.owned.filter((x) => x.save.type === 'hotel' && x.save.building <= 0).length;
          inc = casinoHourly(b.save.items, b.lot, h, true) * lvBoost * (1 + hotels * 0.2) - dealersNeeded(b.save.items) * 6;
        } else inc = hourlyIncome(b.save.type as BizType, b.lot, b.save.level, h);
        inc = Math.round(inc);
        b.save.earned += Math.max(0, inc);
        b.save.today += inc;
        sum += inc;
      }
      if (h === 0) for (const b of this.owned) b.save.today = 0;
      if (sum !== 0) {
        g.money += sum;
        this.pending += sum;
      }
    }
    this.reportT -= dt;
    if (this.reportT <= 0 && this.pending !== 0) {
      this.reportT = 45;
      g.hud.toast(`${this.pending > 0 ? '+' : ''}$${Math.round(this.pending).toLocaleString('en-US')} from your businesses`, this.pending > 0 ? 'money' : 'bad', 3500);
      this.pending = 0;
    }
  }
}

export function districtName(d: string): string {
  return { strip: 'The Strip', downtown: 'Downtown', midtown: 'Midtown', beach: 'Ocean Drive', harbor: 'Harbor District', heights: 'Palm Heights', oldtown: 'Coral Cove' }[d] ?? d;
}

export function defaultName(t: BizType | string, player: string): string {
  const first = (player || 'Lucky').split(' ')[0];
  switch (t) {
    case 'casino': return `${first}'s Casino`;
    case 'bar': return `${first}'s Lounge`;
    case 'shop': return `${first}'s Mart`;
    case 'restaurant': return `Chez ${first}`;
    case 'nightclub': return `Club ${first}`;
    case 'hotel': return `The ${first} Hotel`;
    default: return `${first}'s Place`;
  }
}

export { BIZ };
