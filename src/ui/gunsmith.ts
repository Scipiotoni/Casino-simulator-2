import * as THREE from 'three';
import type { Game } from '../game/game';
import { el, esc, money } from './dom';
import { audio } from '../core/audio';
import { weaponDef, type StatKey } from '../weapons/catalog';
import { CAMOS, CHARMS, CROSSHAIRS, CROSSHAIR_COLORS, RETICLES, RETICLE_COLORS, attachment, type Crosshair, type Reticle } from '../weapons/attachments';
import { SLOTS, SLOT_NAMES, compare, equip, finalWeapon, fitted, slotOptions, type Loadout, type Slot } from '../weapons/loadout';
import { CLASS_NAMES, STAT_LABELS, STAT_ORDER, fmtDelta, fmtStat, misfits, slotClosed, statScore } from '../weapons/fitting';
import { drawCamo, drawCrosshair, drawLens, hexCss } from '../weapons/art';
import { getStudio } from '../weapons/studio';
import { buildWeapon, type WeaponBuild } from '../weapons/standin';

/**
 * The gunsmith, Call of Duty style, opened at a gun store's workbench: a big live 3D preview
 * of the build (drag to turn it, it idles round, the camera moves in on the slot you're
 * editing), the slots with every part that fits (maker, blurb, price, and the stat changes
 * against your current build as green and red bars), the parts that don't fit and why,
 * camos, charms, the optic's reticle, the HUD crosshair and the full stats. Hovering a part
 * (or tapping it on a phone) previews it on the model and in the stats; buy it, then fit it.
 */

type Tab = 'build' | 'camo' | 'charm' | 'reticle' | 'crosshair' | 'stats';
const TABS: [Tab, string][] = [['build', 'Build'], ['camo', 'Camo'], ['charm', 'Charm'], ['reticle', 'Reticle'], ['crosshair', 'Crosshair'], ['stats', 'Stats']];
const CHARM_ICONS: Record<string, string> = { none: '∅', dice: '🎲', chip: '🪙', palm: '🌴', horseshoe: '🧲', duck: '🦆', slot: '🎰', skull: '💀' };
const CROSS_NAMES: Record<Crosshair, string> = { classic: 'Classic', dot: 'Dot', circle: 'Circle', cross: 'Cross + dot', tee: 'Tee', chevron: 'Chevron', none: 'None' };
const RETICLE_NAMES: Record<Reticle, string> = { dot: 'Dot', circleDot: 'Circle dot', chevron: 'Chevron', cross: 'Crosshair', ring: 'Ring', spade: 'Spade', triangle: 'Triangle', mil: 'Mil-dot' };

/** Where on the weapon the camera looks for each slot, as fractions of its bounding box (x, y, z from min to max). */
const FOCUS: Partial<Record<Slot | Tab, [number, number, number, number]>> = {
  optic: [0.5, 0.95, 0.45, 0.42], muzzle: [0.5, 0.6, 0.0, 0.4], barrel: [0.5, 0.6, 0.2, 0.55], underbarrel: [0.5, 0.2, 0.3, 0.5],
  laser: [0.9, 0.5, 0.3, 0.45], magazine: [0.5, 0.15, 0.5, 0.5], stock: [0.5, 0.5, 0.92, 0.5], charm: [0.6, 0.3, 0.7, 0.45], reticle: [0.5, 0.95, 0.45, 0.42],
};

export class Gunsmith {
  readonly root: HTMLDivElement;
  private weapon: string;
  private tab: Tab = 'build';
  private slot: Slot | null = null;
  /** The part being looked at (hover or tap), previewed on the model and in the stats. */
  private preview: Loadout | null = null;
  private selected: string | null = null;
  private body: HTMLDivElement;
  private stats: HTMLDivElement;
  private head: HTMLDivElement;
  private tabsEl: HTMLDivElement;
  private view: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private build: WeaponBuild | null = null;
  private builtKey = '';
  private raf = 0;
  private last = performance.now();
  private yaw = 0.45;
  private pitch = 0.15;
  private idle = 0;
  private drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
  private cam = { target: new THREE.Vector3(), dist: 1, ready: false };
  private box = new THREE.Box3();
  private crossT = 0;
  private crossCanvas: HTMLCanvasElement | null = null;

  constructor(private g: Game, private storeName: string, private onClose: () => void, start?: string) {
    this.weapon = start && g.armory.owns(start) ? start : g.armory.owned[g.armory.owned.length - 1];
    this.root = el('div', 'gs');
    this.head = el('div', 'gs-head');
    this.tabsEl = el('div', 'gs-tabs');
    this.body = el('div', 'gs-body');
    this.stats = el('div', 'gs-stats');
    this.view = el('div', 'gs-view');
    const studio = getStudio();
    this.canvas = studio.renderer.domElement;
    this.canvas.className = 'gs-canvas';
    this.view.append(this.canvas, el('div', 'gs-hint', 'Drag to turn'));
    const left = el('div', 'gs-left');
    left.append(this.tabsEl, this.body);
    const main = el('div', 'gs-main');
    main.append(left, this.view, this.stats);
    this.root.append(this.head, main);
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.view.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    this.view.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.dist *= e.deltaY > 0 ? 1.1 : 0.9;
    }, { passive: false });
    g.uiRoot.appendChild(this.root);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    if (this.build) {
      getStudio().scene.remove(this.build.root);
      this.build.dispose();
    }
    this.root.remove();
  }

  private get w() {
    return weaponDef(this.weapon);
  }

  private get current(): Loadout {
    return this.g.armory.loadout(this.weapon);
  }

  // ---------------------------------------------------------------- drawing the screen

  private draw(): void {
    this.drawHead();
    this.drawTabs();
    this.drawBody();
    this.drawStats();
  }

  private drawHead(): void {
    const g = this.g;
    const w = this.w;
    this.head.innerHTML = '';
    const title = el('div', 'gs-title', `<div class="gs-store">${esc(this.storeName)} · GUNSMITH</div><div class="gs-name">${esc(w.name)}</div><div class="gs-sub">${esc(w.brand)} · ${esc(CLASS_NAMES[w.cls])}</div>`);
    const pick = el('div', 'gs-pick');
    for (const id of g.armory.owned) {
      const b = el('button', `gs-wpn ${id === this.weapon ? 'on' : ''}`);
      b.title = weaponDef(id).name;
      b.append(getStudio().iconImg(id), el('span', '', esc(weaponDef(id).name)));
      b.addEventListener('click', () => {
        this.weapon = id;
        this.preview = null;
        this.selected = null;
        this.slot = null;
        audio.play('click');
        this.draw();
      });
      pick.appendChild(b);
    }
    const cash = el('div', 'gs-cash', money(g.money));
    const x = el('button', 'gs-x', '✕');
    x.title = 'Done (Esc)';
    x.addEventListener('click', () => this.onClose());
    this.head.append(title, pick, cash, x);
    requestAnimationFrame(() => pick.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }

  private drawTabs(): void {
    this.tabsEl.innerHTML = '';
    for (const [t, name] of TABS) {
      const b = el('button', `gs-tab ${t === this.tab ? 'on' : ''}`, name);
      b.addEventListener('click', () => {
        this.tab = t;
        this.preview = null;
        this.selected = null;
        audio.play('click');
        this.drawTabs();
        this.drawBody();
        this.drawStats();
      });
      this.tabsEl.appendChild(b);
    }
  }

  private drawBody(): void {
    this.body.innerHTML = '';
    this.crossCanvas = null;
    switch (this.tab) {
      case 'build': return this.drawBuild();
      case 'camo': return this.drawCamos();
      case 'charm': return this.drawCharms();
      case 'reticle': return this.drawReticles();
      case 'crosshair': return this.drawCrosshairTab();
      case 'stats': return this.drawFullStats(this.body);
    }
  }

  private refresh(): void {
    this.drawHead();
    this.drawBody();
    this.drawStats();
  }

  // ---------------------------------------------------------------- build

  private drawBuild(): void {
    const w = this.w;
    const l = this.current;
    const f = fitted(w, l);
    const chips = el('div', 'gs-slots');
    const open = SLOTS.filter((s) => !slotClosed(w, s) && slotOptions(w, s).length > 0);
    if (!this.slot || !open.includes(this.slot)) this.slot = open[0] ?? null;
    for (const s of SLOTS) {
      const closed = slotClosed(w, s) ?? (slotOptions(w, s).length ? null : 'Nothing fits');
      const fit = s === 'barrel' ? f.barrel?.name : s === 'magazine' ? f.mag?.name : s === 'stock' ? f.stock?.name : f.generic.find((a) => a.slot === s)?.name;
      const b = el('button', `gs-slot ${s === this.slot ? 'on' : ''} ${closed ? 'off' : ''}`, `<b>${SLOT_NAMES[s]}</b><span>${esc(closed ?? fit ?? 'None')}</span>`);
      if (closed) b.title = closed;
      else b.addEventListener('click', () => {
        this.slot = s;
        this.preview = null;
        this.selected = null;
        audio.play('click');
        this.drawBody();
        this.drawStats();
      });
      chips.appendChild(b);
    }
    this.body.appendChild(chips);
    if (!this.slot) {
      this.body.appendChild(el('div', 'gs-note', 'This weapon takes no attachments. Dress it up under Camo and Charm.'));
      return;
    }
    const slot = this.slot;
    const list = el('div', 'gs-opts');
    const cur = l[slot];
    for (const o of slotOptions(w, slot)) {
      const isVariant = slot === 'barrel' || slot === 'magazine' || slot === 'stock';
      const first = slotOptions(w, slot)[0]?.id;
      const fittedNow = isVariant ? (cur ?? first) === o.id : (cur ?? null) === o.id;
      const to = equip(this.weapon, l, slot, o.id);
      // A muzzle can't go on while the barrel has a can built in.
      if (o.id && slot === 'muzzle' && !to.muzzle) continue;
      list.appendChild(this.optionRow({
        key: `${slot}:${o.id}`, brand: o.brand ?? (isVariant ? w.brand : ''), name: o.name, blurb: o.blurb, to,
        price: this.g.armory.price(this.weapon, slot, o.id ?? ''), owned: o.id === null || this.g.armory.unlocked(this.weapon, slot, o.id), fitted: fittedNow,
        buy: () => o.id && this.g.armory.unlock(this.weapon, slot, o.id),
        fit: () => this.g.armory.fit(this.weapon, slot, o.id),
        off: o.id !== null && o.id !== first ? () => this.g.armory.fit(this.weapon, slot, null) : undefined,
      }));
    }
    this.body.appendChild(list);
    const bad = misfits(w, slot, l);
    if (bad.length) {
      this.body.appendChild(el('div', 'gs-sec', 'Doesn’t fit'));
      const nl = el('div', 'gs-opts');
      for (const { a, reason } of bad) nl.appendChild(el('div', 'gs-opt no', `<div class="o-top"><div><div class="o-brand">${esc(a.brand)}</div><div class="o-name">${esc(a.name)}</div></div><div class="o-price">${money(a.price)}</div></div><div class="o-why">⛔ ${esc(reason)}</div>`));
      this.body.appendChild(nl);
    }
  }

  /** One part in a list: its maker, name, blurb, price or state, and what it does to the stats. */
  private optionRow(o: { key: string; brand: string; name: string; blurb: string; to: Loadout; price: number; owned: boolean; fitted: boolean; buy: () => void; fit: () => void; off?: () => void }): HTMLDivElement {
    const g = this.g;
    const row = el('div', `gs-opt ${o.fitted ? 'fit' : ''} ${this.selected === o.key ? 'sel' : ''}`);
    const state = o.fitted ? 'Fitted ✓' : o.owned ? 'Owned' : money(o.price);
    row.innerHTML = `<div class="o-top"><div><div class="o-brand">${esc(o.brand)}</div><div class="o-name">${esc(o.name)}</div></div><div class="o-price ${o.owned ? 'own' : ''}">${state}</div></div>${o.blurb ? `<div class="o-blurb">${esc(o.blurb)}</div>` : ''}`;
    const deltas = compare(this.weapon, this.current, o.to).filter((d) => d.better !== null);
    const removed = this.removedBy(o.to);
    if (deltas.length || removed.length) {
      const dl = el('div', 'o-deltas');
      for (const d of deltas) dl.appendChild(el('span', `dl ${d.better ? 'up' : 'down'}`, `${esc(STAT_LABELS[d.key])} ${fmtDelta(d.key, d.from, d.to)}`));
      for (const r of removed) dl.appendChild(el('span', 'dl warn', `Takes off the ${esc(r)}`));
      row.appendChild(dl);
    }
    if (this.selected === o.key) {
      const act = el('div', 'o-act');
      const button = (label: string, cls: string, fn: () => void, disabled = false) => {
        const b = el('button', `gs-btn ${cls}`, label);
        b.disabled = disabled;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          fn();
        });
        act.appendChild(b);
      };
      if (o.fitted) {
        if (o.off) button('Take off', '', () => this.apply(o.off!));
        else act.appendChild(el('span', 'o-dim', 'Fitted'));
      } else if (o.owned) button('Fit', 'go', () => this.apply(o.fit));
      else
        button(g.money >= o.price ? `Buy and fit · ${money(o.price)}` : `Need ${money(o.price)}`, 'buy', () => {
          g.addMoney(-o.price, `for the ${o.name}`);
          o.buy();
          audio.play('purchase');
          this.apply(o.fit);
          g.save();
        }, g.money < o.price);
      row.appendChild(act);
    }
    row.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.preview = o.to;
      this.drawStats();
    });
    row.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.preview = this.selected ? this.preview : null;
      if (!this.selected) this.drawStats();
    });
    row.addEventListener('click', () => {
      this.selected = this.selected === o.key ? null : o.key;
      this.preview = this.selected ? o.to : null;
      audio.play('click');
      this.drawBody();
      this.drawStats();
    });
    return row;
  }

  /** The generic parts a change would push off (an SD barrel takes the muzzle device off). */
  private removedBy(to: Loadout): string[] {
    const out: string[] = [];
    for (const s of ['optic', 'muzzle', 'underbarrel', 'laser'] as const) {
      const before = this.current[s];
      if (before && !to[s] && attachment(before)) out.push(attachment(before)!.name);
    }
    return out;
  }

  private apply(fn: () => void): void {
    fn();
    this.selected = null;
    this.preview = null;
    audio.play('reload', { volume: 0.4 });
    this.g.save();
    this.refresh();
  }

  // ---------------------------------------------------------------- cosmetics

  private drawCamos(): void {
    const g = this.g;
    const grid = el('div', 'gs-swatches');
    const l = this.current;
    const kills = g.armory.kills[this.weapon] ?? 0;
    for (const c of CAMOS) {
      const owned = g.armory.unlocked(this.weapon, 'camo', c.id);
      const on = l.camo === c.id;
      const cell = el('div', `gs-sw ${on ? 'on' : ''} ${owned ? '' : 'locked'}`);
      const cv = document.createElement('canvas');
      cv.width = 120;
      cv.height = 72;
      drawCamo(cv.getContext('2d')!, c, 120, 72);
      cell.appendChild(cv);
      let state = on ? 'Equipped' : owned ? 'Owned' : money(c.price);
      if (c.kills && !owned) state = `${Math.min(kills, c.kills)}/${c.kills} KOs`;
      cell.appendChild(el('div', 'sw-name', esc(c.name)));
      cell.appendChild(el('div', `sw-state ${owned ? 'own' : ''}`, state));
      if (c.kills) {
        const bar = el('div', 'sw-bar');
        bar.appendChild(el('i', ''));
        (bar.firstChild as HTMLElement).style.width = `${Math.min(100, (kills / c.kills) * 100)}%`;
        cell.appendChild(bar);
        cell.title = `Earned: ${c.kills} knockouts with the ${this.w.name}`;
      }
      cell.addEventListener('pointerenter', () => this.previewDress({ camo: c.id }));
      cell.addEventListener('pointerleave', () => this.previewDress(null));
      cell.addEventListener('click', () => this.dress('camo', c.id, c.price, c.name, owned, !!c.kills));
      grid.appendChild(cell);
    }
    this.body.append(el('div', 'gs-note', 'Camos cover the painted parts. Earned camos unlock with knockouts using this weapon.'), grid);
  }

  private drawCharms(): void {
    const grid = el('div', 'gs-swatches');
    const l = this.current;
    for (const c of CHARMS) {
      const owned = this.g.armory.unlocked(this.weapon, 'charm', c.id);
      const on = l.charm === c.id;
      const cell = el('div', `gs-sw charm ${on ? 'on' : ''} ${owned ? '' : 'locked'}`, `<div class="ch-ic">${CHARM_ICONS[c.id] ?? '✦'}</div><div class="sw-name">${esc(c.name)}</div><div class="sw-state ${owned ? 'own' : ''}">${on ? 'Equipped' : owned ? 'Owned' : money(c.price)}</div>`);
      cell.addEventListener('pointerenter', () => this.previewDress({ charm: c.id }));
      cell.addEventListener('pointerleave', () => this.previewDress(null));
      cell.addEventListener('click', () => this.dress('charm', c.id, c.price, c.name, owned, false));
      grid.appendChild(cell);
    }
    this.body.append(el('div', 'gs-note', 'A little something hanging off the gun.'), grid);
  }

  private previewDress(patch: Partial<Loadout> | null): void {
    this.preview = patch ? { ...this.current, ...patch } : null;
  }

  private dress(kind: 'camo' | 'charm', id: string, price: number, name: string, owned: boolean, earned: boolean): void {
    const g = this.g;
    if (!owned) {
      if (earned) return g.hud.toast('Earn this one with knockouts', 'bad');
      if (g.money < price) return g.hud.toast(`You need ${money(price)}`, 'bad');
      g.addMoney(-price, `for ${name}`);
      g.armory.unlock(this.weapon, kind, id);
      audio.play('purchase');
    } else audio.play('click');
    g.armory.dress(this.weapon, { [kind]: id });
    this.preview = null;
    g.save();
    this.refresh();
  }

  private drawReticles(): void {
    const l = this.current;
    const optic = fitted(this.w, l).generic.find((a) => a.slot === 'optic');
    const ok = !!optic?.reticle;
    this.body.appendChild(el('div', 'gs-note', ok ? `The reticle in your ${esc(optic!.name)}.` : 'Fit an optic with a reticle (Build → Optic) to choose one. Iron and fixed sights keep their own.'));
    const big = document.createElement('canvas');
    big.className = 'gs-lens';
    big.width = big.height = 220;
    drawLens(big.getContext('2d')!, l.reticle, l.reticleColor, 220, 220);
    this.body.appendChild(big);
    const grid = el('div', `gs-swatches small ${ok ? '' : 'disabled'}`);
    for (const r of RETICLES) {
      const cell = el('div', `gs-sw ${l.reticle === r ? 'on' : ''}`);
      const cv = document.createElement('canvas');
      cv.width = cv.height = 72;
      drawLens(cv.getContext('2d')!, r, l.reticleColor, 72, 72);
      cell.append(cv, el('div', 'sw-name', RETICLE_NAMES[r]));
      if (ok) cell.addEventListener('click', () => this.setDress({ reticle: r }));
      grid.appendChild(cell);
    }
    this.body.appendChild(grid);
    this.body.appendChild(this.colorRow(RETICLE_COLORS, l.reticleColor, ok, (c) => this.setDress({ reticleColor: c })));
  }

  private setDress(p: Partial<Pick<Loadout, 'reticle' | 'reticleColor'>>): void {
    this.g.armory.dress(this.weapon, p);
    audio.play('click');
    this.g.save();
    this.drawBody();
  }

  private colorRow(colors: number[], on: number, enabled: boolean, pick: (c: number) => void): HTMLDivElement {
    const row = el('div', `gs-colors ${enabled ? '' : 'disabled'}`);
    for (const c of colors) {
      const b = el('button', `gs-col ${c === on ? 'on' : ''}`);
      b.style.background = hexCss(c);
      if (enabled) b.addEventListener('click', () => pick(c));
      row.appendChild(b);
    }
    return row;
  }

  private drawCrosshairTab(): void {
    const a = this.g.armory;
    const c = a.crosshair;
    this.body.appendChild(el('div', 'gs-note', 'Your HUD crosshair, the same for every weapon. It opens up as your aim spreads.'));
    const pv = document.createElement('canvas');
    pv.className = 'gs-xpv';
    pv.width = 320;
    pv.height = 160;
    this.crossCanvas = pv;
    this.body.appendChild(pv);
    const grid = el('div', 'gs-swatches small');
    for (const s of CROSSHAIRS) {
      const cell = el('div', `gs-sw ${c.style === s ? 'on' : ''}`);
      const cv = document.createElement('canvas');
      cv.width = cv.height = 72;
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = '#2a3a4a';
      ctx.fillRect(0, 0, 72, 72);
      drawCrosshair(ctx, { ...c, style: s, size: 1, gap: 1 }, 36, 36, 0);
      if (s === 'none') {
        ctx.fillStyle = '#8a9ab0';
        ctx.font = '900 12px Nunito';
        ctx.textAlign = 'center';
        ctx.fillText('NONE', 36, 40);
      }
      cell.append(cv, el('div', 'sw-name', CROSS_NAMES[s]));
      cell.addEventListener('click', () => this.setCross({ style: s }));
      grid.appendChild(cell);
    }
    this.body.appendChild(grid);
    this.body.appendChild(this.colorRow(CROSSHAIR_COLORS, c.color, true, (col) => this.setCross({ color: col })));
    const slider = (label: string, key: 'size' | 'gap', lo: number, hi: number) => {
      const r = el('label', 'gs-slider', `<span>${label}</span>`);
      const inp = document.createElement('input');
      inp.type = 'range';
      inp.min = String(lo);
      inp.max = String(hi);
      inp.step = '0.05';
      inp.value = String(c[key]);
      const v = el('b', '', `${Math.round(c[key] * 100)}%`);
      inp.addEventListener('input', () => {
        a.setCrosshair({ [key]: Number(inp.value) });
        v.textContent = `${Math.round(Number(inp.value) * 100)}%`;
      });
      inp.addEventListener('change', () => this.g.save());
      r.append(inp, v);
      return r;
    };
    this.body.append(slider('Size', 'size', 0.6, 1.6), slider('Gap', 'gap', 0, 1.5));
  }

  private setCross(p: Parameters<Game['armory']['setCrosshair']>[0]): void {
    this.g.armory.setCrosshair(p);
    audio.play('click');
    this.g.save();
    this.drawBody();
  }

  // ---------------------------------------------------------------- stats

  /** The side panel: the build's stats, with what the previewed part changes. */
  private drawStats(): void {
    this.stats.innerHTML = '';
    this.stats.appendChild(el('div', 'gs-sec', this.preview ? 'With this part' : 'Your build'));
    this.drawStatBars(this.stats, this.preview, false);
  }

  private drawFullStats(into: HTMLElement): void {
    const f = finalWeapon(this.weapon, this.current);
    into.appendChild(el('div', 'gs-note', `${esc(this.w.blurb)}<br>${esc(f.fire === 'auto' ? 'Full auto' : f.fire === 'burst' ? `${f.burst}-round burst` : f.fire === 'semi' ? 'Semi-automatic' : f.fire === 'pump' ? 'Pump action' : f.fire === 'bolt' ? 'Bolt action' : 'Single shot')}${f.suppressed ? ' · suppressed' : ''}${f.zoom > 1 ? ` · ${f.zoom}× sight` : ''}${f.thermal ? ' · thermal' : ''}`));
    this.drawStatBars(into, null, true);
  }

  private drawStatBars(into: HTMLElement, to: Loadout | null, full: boolean): void {
    const base = finalWeapon(this.weapon, { camo: 'factory', charm: 'none', reticle: 'dot', reticleColor: this.current.reticleColor }).stats;
    const rows = compare(this.weapon, this.current, to ?? this.current);
    for (const key of STAT_ORDER) {
      const r = rows.find((x) => x.key === key)!;
      if ((key === 'splash' || key === 'velocity' || key === 'spinUp') && base[key] === 0) continue;
      if (key === 'pellets' && base.pellets <= 1) continue;
      const a = statScore(key, key === 'damage' ? r.from * base.pellets : r.from);
      const b = statScore(key, key === 'damage' ? r.to * base.pellets : r.to);
      const line = el('div', `gs-stat ${r.better === null ? '' : r.better ? 'up' : 'down'}`);
      const bar = el('div', 'st-bar');
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      bar.innerHTML = `<i class="st-base" style="width:${(lo * 100).toFixed(1)}%"></i>${r.better === null ? '' : `<i class="st-d" style="left:${(lo * 100).toFixed(1)}%;width:${((hi - lo) * 100).toFixed(1)}%"></i>`}`;
      const val = r.better === null ? fmtStat(key, r.from) : `${fmtStat(key, r.to)} <em>${fmtDelta(key, r.from, r.to)}</em>`;
      line.innerHTML = `<div class="st-top"><span>${STAT_LABELS[key]}</span><b>${val}</b></div>`;
      line.appendChild(bar);
      if (full) line.appendChild(el('div', 'st-base-v', `Base ${fmtStat(key, base[key as StatKey])}`));
      into.appendChild(line);
    }
  }

  // ---------------------------------------------------------------- the 3D preview

  private onDown = (e: PointerEvent) => {
    this.drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch };
    this.view.setPointerCapture?.(e.pointerId);
  };
  private onMove = (e: PointerEvent) => {
    if (!this.drag) return;
    this.yaw = this.drag.yaw - (e.clientX - this.drag.x) * 0.01;
    this.pitch = Math.max(-0.9, Math.min(0.9, this.drag.pitch + (e.clientY - this.drag.y) * 0.006));
    this.idle = 0;
  };
  private onUp = () => {
    this.drag = null;
  };

  private frame = () => {
    this.raf = requestAnimationFrame(this.frame);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const studio = getStudio();
    const want = this.preview ?? this.current;
    const key = `${this.weapon}|${JSON.stringify(want)}`;
    if (key !== this.builtKey) {
      this.builtKey = key;
      if (this.build) {
        studio.scene.remove(this.build.root);
        this.build.dispose();
      }
      this.build = buildWeapon(this.weapon, want);
      studio.scene.add(this.build.root);
      this.box.setFromObject(this.build.root);
    }
    // Size the canvas to its box.
    const r = this.view.getBoundingClientRect();
    const cw = Math.max(1, Math.round(r.width));
    const ch = Math.max(1, Math.round(r.height));
    const size = studio.renderer.getSize(new THREE.Vector2());
    if (size.x !== cw || size.y !== ch) studio.renderer.setSize(cw, ch, true);
    // Idle turn, and the camera moving in on the slot being edited.
    this.idle += dt;
    if (!this.drag && this.idle > 2.5) this.yaw += dt * 0.25;
    const b = this.box;
    const sz = b.getSize(new THREE.Vector3());
    const focusKey = this.tab === 'build' ? this.slot : this.tab;
    const f = (focusKey && FOCUS[focusKey as Slot]) || [0.5, 0.5, 0.5, 1];
    const target = new THREE.Vector3(b.min.x + sz.x * f[0], b.min.y + sz.y * f[1], b.min.z + sz.z * f[2]);
    const cam = studio.camera;
    cam.aspect = cw / ch;
    cam.fov = 30;
    const vf = THREE.MathUtils.degToRad(cam.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * cam.aspect);
    const fit = Math.max((Math.max(sz.z, 0.15) * 1.15) / 2 / Math.tan(hf / 2), (sz.y * 1.4) / 2 / Math.tan(vf / 2)) + sz.x;
    const dist = fit * f[3];
    if (!this.cam.ready) {
      this.cam.target.copy(target);
      this.cam.dist = dist;
      this.cam.ready = true;
    }
    const k = Math.min(1, dt * 4);
    this.cam.target.lerp(target, k);
    this.cam.dist += (dist - this.cam.dist) * k;
    const dir = new THREE.Vector3(Math.cos(this.pitch) * Math.cos(this.yaw), Math.sin(this.pitch), -Math.cos(this.pitch) * Math.sin(this.yaw));
    // Start looking at the weapon's right side (+x).
    cam.position.copy(this.cam.target).addScaledVector(dir, this.cam.dist);
    cam.near = this.cam.dist / 40;
    cam.far = this.cam.dist * 20;
    cam.lookAt(this.cam.target);
    cam.updateProjectionMatrix();
    studio.renderer.setClearColor(0x000000, 0);
    studio.renderer.render(studio.scene, cam);
    // The crosshair preview breathes as if you were moving and firing.
    if (this.crossCanvas) {
      this.crossT += dt;
      const ctx = this.crossCanvas.getContext('2d')!;
      const W = this.crossCanvas.width;
      const H = this.crossCanvas.height;
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#5a7a9a');
      grad.addColorStop(0.6, '#a8b8c0');
      grad.addColorStop(0.61, '#5a6a4a');
      grad.addColorStop(1, '#3a4a2a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      const spread = (Math.sin(this.crossT * 2) * 0.5 + 0.5) * 14;
      drawCrosshair(ctx, this.g.armory.crosshair, W / 2, H / 2, spread, 1.4);
    }
  };
}
