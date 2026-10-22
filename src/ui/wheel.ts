import type { Game } from '../game/game';
import { el, esc } from './dom';
import { audio } from '../core/audio';
import { WEAPONS, weaponDef, CLASS_NAMES, type WeaponClass } from '../weapons/catalog';
import { getStudio } from '../weapons/studio';

/**
 * The weapon wheel: hold Tab (or tap the 🔫 button on a touch screen) and your weapons sit
 * round a circle; point at one and let go to draw it, or let go in the middle to holster.
 * With a big armory the weapons go on pages by class (scroll the mouse wheel, or tap the
 * arrows, to turn them).
 */

const PER_PAGE = 10;
const CLASS_ORDER = WEAPONS.map((w) => w.cls).filter((c, i, a) => a.indexOf(c) === i);

/** Your weapons in pages: classes kept together where they fit. */
export function wheelPages(owned: string[]): string[][] {
  const sorted = [...owned].sort((a, b) => CLASS_ORDER.indexOf(weaponDef(a).cls) - CLASS_ORDER.indexOf(weaponDef(b).cls) || WEAPONS.findIndex((w) => w.id === a) - WEAPONS.findIndex((w) => w.id === b));
  const pages: string[][] = [];
  let page: string[] = [];
  for (const cls of CLASS_ORDER) {
    const group = sorted.filter((id) => weaponDef(id).cls === cls);
    if (!group.length) continue;
    if (page.length && page.length + group.length > PER_PAGE) {
      pages.push(page);
      page = [];
    }
    for (const id of group) {
      if (page.length >= PER_PAGE) {
        pages.push(page);
        page = [];
      }
      page.push(id);
    }
  }
  if (page.length) pages.push(page);
  return pages;
}

export class WeaponWheel {
  private root: HTMLDivElement;
  private ring: HTMLDivElement;
  private center: HTMLDivElement;
  private pager: HTMLDivElement;
  private button: HTMLButtonElement;
  open = false;
  private byKey = false;
  private page = 0;
  private pages: string[][] = [];
  private hover = -1;
  private cursor = { x: 0, y: 0 };
  private items: HTMLDivElement[] = [];

  constructor(private g: Game, parent: HTMLElement) {
    this.root = el('div', 'wwheel');
    this.ring = el('div', 'ww-ring');
    this.center = el('div', 'ww-center');
    this.pager = el('div', 'ww-pager');
    this.ring.appendChild(this.center);
    this.center.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hover = -1;
      this.close(true);
    });
    this.root.append(this.ring, this.pager);
    this.button = el('button', 'ww-btn', '🔫');
    this.button.title = 'Weapons (hold Tab)';
    this.button.style.display = 'none';
    this.button.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.open) this.close(false);
      else this.show(false);
    });
    this.root.addEventListener('pointerdown', (e) => {
      if (this.byKey) return;
      e.stopPropagation();
      if (e.target === this.root) this.close(false);
    });
    this.root.addEventListener('pointermove', (e) => {
      if (this.byKey && this.g.input.locked) return;
      const r = this.ring.getBoundingClientRect();
      this.cursor.x = e.clientX - (r.left + r.width / 2);
      this.cursor.y = e.clientY - (r.top + r.height / 2);
      this.pick();
    });
    this.root.addEventListener('wheel', (e) => this.turn(e.deltaY > 0 ? 1 : -1));
    parent.append(this.root, this.button);
  }

  /** Call before the camera reads the mouse: while open, the mouse points at weapons instead of turning the view. */
  update(): void {
    const g = this.g;
    const inp = g.input;
    const can = g.mode === 'play' && g.player.mode === 'walk' && !g.vehicles.driving && g.armory.owned.length > 0;
    this.button.style.display = can && inp.touchMode ? '' : 'none';
    if (!can) {
      if (this.open) this.close(false);
      return;
    }
    if (!this.open && inp.pressed('Tab')) this.show(true);
    if (!this.open) return;
    if (this.byKey) {
      this.cursor.x += inp.lookDX;
      this.cursor.y += inp.lookDY;
      const m = Math.hypot(this.cursor.x, this.cursor.y);
      if (m > 160) {
        this.cursor.x *= 160 / m;
        this.cursor.y *= 160 / m;
      }
      inp.lookDX = 0;
      inp.lookDY = 0;
      if (inp.wheel) {
        this.turn(inp.wheel > 0 ? 1 : -1);
        inp.wheel = 0;
      }
      this.pick();
      if (!inp.down('Tab')) this.close(true);
    }
  }

  private show(byKey: boolean): void {
    this.pages = wheelPages(this.g.armory.owned);
    const cur = this.g.combat.current;
    this.page = Math.max(0, this.pages.findIndex((p) => cur !== null && p.includes(cur)));
    this.open = true;
    this.byKey = byKey;
    this.cursor = { x: 0, y: 0 };
    this.hover = -1;
    this.root.classList.add('show');
    this.root.classList.toggle('touch', !byKey);
    this.draw();
    audio.play('click');
  }

  private close(choose: boolean): void {
    this.open = false;
    this.root.classList.remove('show');
    if (!choose) return;
    const id = this.hover >= 0 ? this.pages[this.page]?.[this.hover] : null;
    this.choose(id ?? null);
  }

  private choose(id: string | null): void {
    const g = this.g;
    const p = g.player.pos;
    if (id && (g.world.venueAt(p.x, p.z) || g.gunStores.noGuns(p.x, p.z))) {
      g.hud.toast('No guns indoors (except on a store’s range lane)', 'bad');
      return;
    }
    if (id === g.combat.current) return;
    g.combat.draw(id);
  }

  private turn(d: number): void {
    if (this.pages.length < 2) return;
    this.page = (this.page + d + this.pages.length) % this.pages.length;
    this.hover = -1;
    this.draw();
    audio.play('click');
  }

  private draw(): void {
    const list = this.pages[this.page] ?? [];
    this.items.forEach((x) => x.remove());
    this.items = [];
    const studio = getStudio();
    const n = Math.max(list.length, 4);
    list.forEach((id, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const it = el('div', `ww-item ${id === this.g.combat.current ? 'cur' : ''}`);
      it.style.left = `${50 + Math.cos(a) * 38}%`;
      it.style.top = `${50 + Math.sin(a) * 38}%`;
      it.append(studio.iconImg(id), el('span', '', esc(weaponDef(id).name)));
      it.addEventListener('pointerenter', () => {
        this.hover = i;
        this.mark();
      });
      it.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hover = i;
        this.close(true);
      });
      this.ring.appendChild(it);
      this.items.push(it);
    });
    const classes = [...new Set(list.map((id) => weaponDef(id).cls))] as WeaponClass[];
    this.pager.innerHTML = '';
    if (this.pages.length > 1) {
      const prev = el('button', 'ww-arrow', '◀');
      const next = el('button', 'ww-arrow', '▶');
      prev.addEventListener('click', (e) => {
        e.stopPropagation();
        this.turn(-1);
      });
      next.addEventListener('click', (e) => {
        e.stopPropagation();
        this.turn(1);
      });
      this.pager.append(prev, el('span', '', `${classes.map((c) => CLASS_NAMES[c]).join(' · ')} <em>${this.page + 1}/${this.pages.length}${this.byKey ? ' · scroll for more' : ''}</em>`), next);
    } else this.pager.innerHTML = `<span>${classes.map((c) => CLASS_NAMES[c]).join(' · ')}</span>`;
    this.mark();
  }

  /** Which weapon the pointer is at (none in the middle). */
  private pick(): void {
    const list = this.pages[this.page] ?? [];
    const m = Math.hypot(this.cursor.x, this.cursor.y);
    const ringR = this.ring.getBoundingClientRect().width / 2;
    let h = -1;
    if (m > Math.max(28, ringR * 0.22) && list.length) {
      const n = Math.max(list.length, 4);
      const a = Math.atan2(this.cursor.y, this.cursor.x) + Math.PI / 2;
      const i = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / n)) % n;
      h = i < list.length ? i : -1;
    }
    if (h !== this.hover) {
      this.hover = h;
      this.mark();
    }
  }

  private mark(): void {
    this.items.forEach((it, i) => it.classList.toggle('on', i === this.hover));
    const id = this.hover >= 0 ? this.pages[this.page]?.[this.hover] : null;
    if (id) {
      const w = weaponDef(id);
      this.center.innerHTML = `<div class="wc-name">${esc(w.name)}</div><div class="wc-sub">${esc(w.brand)} · ${esc(CLASS_NAMES[w.cls])}</div>`;
    } else this.center.innerHTML = `<div class="wc-name">${this.g.combat.current ? 'Holster' : 'Unarmed'}</div><div class="wc-sub">${this.byKey ? 'Point at a weapon and let go of Tab' : 'Tap a weapon'}</div>`;
  }
}
