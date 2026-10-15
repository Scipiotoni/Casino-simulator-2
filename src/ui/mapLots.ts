import type { Game } from '../game/game';
import type { Business } from '../business/business';
import { districtName } from '../business/business';
import { bizDef } from '../business/catalog';
import { lotFrontPoint, type Lot } from '../world/layout';
import { audio } from '../core/audio';
import { isDealer } from '../world/dealers';
import { el, esc, money } from './dom';
import { DEFAULT_FILTER, DISTRICTS, PRICE_STEPS, lotArea, lotAt, parseFilter, visibleLots, type LotFilter, type LotSize, type LotView } from './lotFilter';

/**
 * Property on the big map: filters for the lots you could buy (for sale, within your cash,
 * big enough for a casino, by price, size and district) and your own, drawn at their real
 * size and coloured by whether you can afford them. Click one for its card: buy it, mark it,
 * manage it, or teleport to its street.
 */

const KEY = 'cs2.mapLots';
const COLOR = { mine: 'rgba(255, 197, 61, 0.92)', afford: 'rgba(53, 224, 138, 0.82)', pricey: 'rgba(214, 92, 104, 0.55)' };
const EDGE = { mine: '#7a5200', afford: '#0d5a31', pricey: '#5a1d26' };

export class MapLots {
  readonly bar: HTMLDivElement;
  readonly card: HTMLDivElement;
  private count: HTMLSpanElement;
  private f: LotFilter;
  private views: LotView[] = [];
  private open: Lot | null = null;
  private lastMoney = -1;
  private hadHome = false;

  constructor(private game: Game, private close: () => void) {
    this.f = load();
    this.bar = el('div', 'mm-lots');
    this.card = el('div', 'mm-card');
    this.card.style.display = 'none';
    this.count = el('span', 'mm-count');
    for (const e of [this.bar, this.card]) {
      e.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      e.addEventListener('wheel', (ev) => ev.stopPropagation());
    }
    this.drawBar();
  }

  // ---------------------------------------------------------------- the filter bar

  private drawBar(): void {
    const f = this.f;
    const b = this.bar;
    b.innerHTML = '';
    const chip = (text: string, on: boolean, title: string, fn: () => void) => {
      const e = el('button', `mm-chip ${on ? 'on' : ''}`, text);
      e.title = title;
      e.addEventListener('click', (ev) => {
        ev.stopPropagation();
        fn();
        save(this.f);
        audio.play('click');
        this.drawBar();
      });
      return e;
    };
    b.append(
      chip('🏷 For sale', f.sale, 'Show the lots for sale', () => (f.sale = !f.sale)),
      chip('💵 I can afford', f.afford, 'Only lots you can pay for with your cash', () => (f.afford = !f.afford)),
      chip('🎰 Fits a casino', f.casino, `Only lots of ${bizDef('casino').minArea.toLocaleString('en-US')} m² or more`, () => (f.casino = !f.casino)),
      chip('⭐ Mine', f.mine, 'Your lots and businesses', () => (f.mine = !f.mine)),
    );
    const sizes = el('span', 'mm-group');
    for (const s of ['S', 'M', 'L'] as LotSize[]) {
      sizes.appendChild(chip(s, f.sizes.includes(s), { S: 'Small: under 1,200 m²', M: 'Medium: under 3,000 m²', L: 'Large: 3,000 m² and up' }[s], () => {
        f.sizes = f.sizes.includes(s) ? f.sizes.filter((x) => x !== s) : [...f.sizes, s];
      }));
    }
    b.appendChild(sizes);
    b.appendChild(this.select(PRICE_STEPS.map((p) => [String(p), p ? `Up to ${money(p, true)}` : 'Any price']), String(f.maxPrice), (v) => (f.maxPrice = Number(v))));
    b.appendChild(this.select([['', 'All districts'], ...DISTRICTS.map((d): [string, string] => [d, districtName(d)])], f.districts[0] ?? '', (v) => (f.districts = v ? [v as LotFilter['districts'][number]] : [])));
    const h = this.game.home();
    this.hadHome = !!h;
    const home = chip(h ? '🏠 Home' : '🏠 Flat for sale', false, h ? `Teleport to ${h.label.toLowerCase().startsWith('your') ? h.label.toLowerCase() : h.label}` : 'You have no home yet: teleport to the flat for sale in Palm Court (or build a house on a lot)', () => {
      const t = this.game.home();
      if (t) this.game.fastTravel(t.x, t.z, t.yaw, t.label);
      else {
        const fl = this.game.flat;
        this.game.fastTravel(fl.door.x + Math.sin(fl.yaw) * 2.5, fl.door.z + Math.cos(fl.yaw) * 2.5, fl.yaw + Math.PI, 'Palm Court');
      }
    });
    const cars = chip('🚗 Car dealers', false, 'Teleport to the nearest car dealer', () => {
      const g = this.game;
      const p = g.player.pos;
      const s = g.shops.filter((x) => isDealer(x.key)).sort((a, b) => Math.hypot(a.door.x - p.x, a.door.z - p.z) - Math.hypot(b.door.x - p.x, b.door.z - p.z))[0];
      if (s) g.fastTravel(s.door.x + Math.sin(s.yaw) * 3, s.door.z + Math.cos(s.yaw) * 3, s.yaw + Math.PI, s.name);
    });
    b.append(home, cars, this.count);
    b.appendChild(el('span', 'mm-legend', '<i class="a"></i>can buy <i class="p"></i>too pricey <i class="m"></i>yours'));
  }

  private select(opts: [string, string][], cur: string, set: (v: string) => void): HTMLSelectElement {
    const s = el('select', 'mm-sel') as HTMLSelectElement;
    for (const [v, t] of opts) {
      const o = el('option', '', esc(t)) as HTMLOptionElement;
      o.value = v;
      o.selected = v === cur;
      s.appendChild(o);
    }
    s.addEventListener('change', () => {
      set(s.value);
      save(this.f);
      audio.play('click');
    });
    s.addEventListener('keydown', (e) => e.stopPropagation());
    return s;
  }

  // ---------------------------------------------------------------- drawing

  /** Work out what to show (every frame the big map draws). */
  refresh(): void {
    const g = this.game;
    if (!!g.home() !== this.hadHome) this.drawBar();
    const b = g.business;
    this.views = visibleLots(g.world.terrain.lots, this.f, g.money, (l) => !!b.ownerOf(l), (l) => b.taken.has(l.id), bizDef('casino').minArea);
    const n = this.views.filter((v) => v.state === 'afford').length;
    this.count.textContent = this.f.sale ? `${n} lot${n === 1 ? '' : 's'} you can buy` : '';
    if (this.open && Math.round(g.money) !== this.lastMoney) this.showCard(this.open);
  }

  /** Lots as filled parcels (with their price once there's room), in canvas pixels. */
  draw(c: CanvasRenderingContext2D, X: (x: number) => number, Z: (z: number) => number, s: number, W: number, H: number, dpr: number): void {
    const tags = s > 0.35;
    c.lineWidth = Math.max(1, dpr);
    for (const v of this.views) {
      const l = v.lot;
      // Never smaller than a dot you can see (and click) on the whole-island view.
      const min = 5 * dpr;
      const w = Math.max(min, (l.x1 - l.x0) * s);
      const h = Math.max(min, (l.z1 - l.z0) * s);
      const x = X((l.x0 + l.x1) / 2) - w / 2;
      const y = Z((l.z0 + l.z1) / 2) - h / 2;
      if (x > W || y > H || x + w < 0 || y + h < 0) continue;
      c.fillStyle = COLOR[v.state];
      c.fillRect(x, y, w, h);
      c.strokeStyle = this.open === l ? '#ffffff' : EDGE[v.state];
      c.lineWidth = this.open === l ? 3 * dpr : Math.max(1, dpr);
      c.strokeRect(x, y, w, h);
    }
    if (!tags) return;
    c.font = `800 ${Math.round(10 * dpr)}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const v of this.views) {
      const l = v.lot;
      const w = (l.x1 - l.x0) * s;
      if (w < 44 * dpr) continue;
      const x = X((l.x0 + l.x1) / 2);
      const y = Z((l.z0 + l.z1) / 2);
      if (x < -40 || y < -20 || x > W + 40 || y > H + 20) continue;
      c.fillStyle = 'rgba(10, 8, 20, 0.75)';
      const t = v.state === 'mine' ? '★' : money(l.price, true);
      const tw = c.measureText(t).width + 8 * dpr;
      c.fillRect(x - tw / 2, y - 8 * dpr, tw, 16 * dpr);
      c.fillStyle = v.state === 'pricey' ? '#ffb3bb' : '#ffffff';
      c.fillText(t, x, y + dpr);
    }
  }

  // ---------------------------------------------------------------- the lot card

  /** A click on the map (world metres): open the card of the lot under it, if any. */
  click(x: number, z: number, pad: number): boolean {
    const hit = lotAt(this.views, x, z, pad);
    if (!hit) {
      if (this.open) {
        this.hideCard();
        return true;
      }
      return false;
    }
    audio.play('click');
    this.showCard(hit.lot);
    return true;
  }

  hideCard(): void {
    this.open = null;
    this.card.style.display = 'none';
  }

  private showCard(l: Lot): void {
    const g = this.game;
    this.open = l;
    this.lastMoney = Math.round(g.money);
    const biz = g.business.ownerOf(l) as Business | null;
    const area = Math.round(lotArea(l));
    const fits = area >= bizDef('casino').minArea;
    const c = this.card;
    c.style.display = '';
    c.innerHTML = '';
    const head = el('div', 'mm-card-head', `<b>${esc(biz && biz.save.type !== 'empty' ? biz.save.name : l.street)}</b><span>${esc(districtName(l.district))} · ${area.toLocaleString('en-US')} m²${fits ? ' · 🎰 fits a casino' : ''}</span>`);
    const x = el('button', 'mm-card-x', '✕');
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideCard();
    });
    head.appendChild(x);
    c.appendChild(head);
    const line = el('div', 'mm-card-line');
    if (biz) line.innerHTML = biz.save.type === 'empty' ? 'Your lot · nothing built yet' : `Yours · ${esc(bizDef(biz.save.type).name)}, level ${biz.save.level}`;
    else if (g.money >= l.price) line.innerHTML = `<b class="ok">${money(l.price)}</b> · you can afford it`;
    else line.innerHTML = `<b class="no">${money(l.price)}</b> · you need ${money(l.price - g.money)} more`;
    c.appendChild(line);
    const row = el('div', 'mm-card-btns');
    const btn = (text: string, cls: string, fn: () => void, off = false) => {
      const b = el('button', `pbtn sm ${cls}`, text);
      b.disabled = off;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!b.disabled) fn();
      });
      row.appendChild(b);
    };
    btn('📍 Teleport', 'primary', () => this.travel(l));
    btn('Waypoint', '', () => {
      g.setUserWaypoint((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2, biz?.save.name || l.street);
      audio.play('click');
      this.hideCard();
    });
    if (biz) {
      btn(biz.save.type === 'empty' ? 'Build' : 'Manage', 'green', () => {
        this.hideCard();
        this.close();
        if (biz.save.type === 'empty') g.ui.buildPanel(biz);
        else g.ui.bizPanel(biz);
      });
    } else {
      btn(g.money >= l.price ? `Buy ${money(l.price, true)}` : 'Too pricey', 'green', () => {
        if (!g.business.buyLot(l)) return;
        // Bought: straight on to choosing what to build on it.
        const mine = g.business.ownerOf(l) as Business | null;
        this.hideCard();
        this.close();
        if (mine) g.ui.buildPanel(mine);
      }, g.money < l.price);
    }
    c.appendChild(row);
  }

  /** Stand on the lot's street, facing it. */
  private travel(l: Lot): void {
    const fp = lotFrontPoint(l);
    const x = fp.x + Math.sin(fp.yaw) * 4;
    const z = fp.z + Math.cos(fp.yaw) * 4;
    const biz = this.game.business.ownerOf(l) as Business | null;
    if (this.game.fastTravel(x, z, fp.yaw + Math.PI, biz && biz.save.type !== 'empty' ? biz.save.name : l.street)) this.hideCard();
  }
}

function load(): LotFilter {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseFilter(JSON.parse(raw)) : { ...DEFAULT_FILTER };
  } catch {
    return { ...DEFAULT_FILTER };
  }
}

function save(f: LotFilter): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    /* storage blocked: the filter lasts this session */
  }
}
