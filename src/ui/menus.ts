import type { Game } from '../game/game';
import { Panel, row, btn, card } from './panel';
import { el, esc, money } from './dom';
import { type Lot } from '../world/layout';
import { BIZ, bizDef, buildCost, upgradeCost, hourlyIncome, lotArea, casinoHourly, casinoLevel, dealersNeeded, MAX_LEVEL, type BizType } from '../business/catalog';
import { districtName, defaultName, type Business } from '../business/business';
import { GUNS } from '../combat/guns';
import { VEHICLES } from '../vehicles/models';
import { SKINS, RARITY_COLORS, SKIN_TONES, HAIR_COLORS, appearanceFromSkin, skinById, type Appearance, type Hair } from '../chars/skins';
import { drawMarker } from './map';
import { audio } from '../core/audio';
import type { Quality } from '../render/renderer';
import { arrivedFromMainland, goToMainland, mainlandName } from '../activities/crossover';

/**
 * Every menu outside the gambling tables: the realtor and lots, building and running your
 * businesses, the shops (guns, cars, clothes), the map, pause and settings, the title screen
 * and the character creator. Opening one pauses movement; closing it hands control back.
 */
export class GameUI {
  constructor(private g: Game) {}

  /** Open a modal panel (pauses movement until it closes). Activities use this for their own menus. */
  panel(opts: ConstructorParameters<typeof Panel>[1]): Panel {
    const g = this.g;
    g.enterMenu();
    const onClose = opts.onClose;
    return new Panel(g.uiRoot, {
      ...opts,
      onClose: () => {
        onClose?.();
        if (!Panel.open) g.leaveMenu();
      },
    });
  }

  confirm(title: string, text: string, yes: string, onYes: () => void, danger = false): void {
    const p = this.panel({ title });
    p.body.appendChild(el('div', 'ptext', esc(text)));
    p.footer.append(
      btn('Cancel', '', () => p.close()),
      btn(yes, danger ? 'danger' : 'primary', () => {
        p.close();
        onYes();
      }),
    );
  }

  // ---------------------------------------------------------------- lots and realty

  lotPanel(l: Lot): void {
    const g = this.g;
    const p = this.panel({ title: 'Lot for sale', subtitle: `${l.street} · ${districtName(l.district)}`, accent: '#3ddc84' });
    p.body.append(
      row('Price', money(l.price)),
      row('Size', `${Math.round(lotArea(l)).toLocaleString('en-US')} m²  (${Math.round(l.x1 - l.x0)} × ${Math.round(l.z1 - l.z0)} m)`),
      row('District', districtName(l.district)),
      row('Fits', BIZ.filter((b) => lotArea(l) >= b.minArea).map((b) => b.icon).join(' ')),
    );
    p.body.appendChild(el('div', 'ptext dim', 'Buy the land first, then choose what to build on it: a casino, a bar, a shop, a restaurant, a nightclub, a hotel or a house.'));
    const can = g.money >= l.price;
    p.footer.append(
      btn('Not now', '', () => p.close()),
      btn(can ? `Buy for ${money(l.price)}` : `Need ${money(l.price - g.money)} more`, 'primary', () => {
        p.close();
        const b = g.business.buyLot(l);
        if (b) this.buildPanel(g.business.owned[g.business.owned.length - 1]);
      }, !can),
    );
  }

  realtyPanel(): void {
    const g = this.g;
    let filter = 'all';
    let sort: 'price' | 'size' = 'price';
    const p = this.panel({ title: 'Paradise Realty', subtitle: 'Every lot for sale on Jackpot Island', wide: true, accent: '#3ddc84' });
    const bar = el('div', 'pfilters');
    const list = el('div', 'pgrid');
    const render = () => {
      bar.innerHTML = '';
      for (const d of ['all', 'strip', 'downtown', 'midtown', 'beach', 'harbor', 'heights', 'oldtown']) {
        const b = btn(d === 'all' ? 'All' : districtName(d), filter === d ? 'primary sm' : 'sm', () => {
          filter = d;
          render();
        });
        bar.appendChild(b);
      }
      bar.appendChild(btn(sort === 'price' ? 'Sort: price' : 'Sort: size', 'sm', () => {
        sort = sort === 'price' ? 'size' : 'price';
        render();
      }));
      list.innerHTML = '';
      const lots = g.business.saleLots().filter((l) => filter === 'all' || l.district === filter);
      lots.sort((a, b) => (sort === 'price' ? a.price - b.price : lotArea(b) - lotArea(a)));
      for (const l of lots.slice(0, 60)) {
        const c = card({
          title: l.street,
          sub: `${districtName(l.district)} · ${Math.round(lotArea(l)).toLocaleString('en-US')} m² · ${BIZ.filter((b) => lotArea(l) >= b.minArea).map((b) => b.icon).join('')}`,
          price: money(l.price),
          color: g.money >= l.price ? '#3ddc84' : '#8e9aaf',
          onClick: () => {
            p.close();
            this.lotOffer(l);
          },
        });
        list.appendChild(c);
      }
      if (!lots.length) list.appendChild(el('div', 'ptext dim', 'Nothing for sale here right now.'));
    };
    render();
    p.body.append(bar, list);
  }

  /** A lot picked from the realty listing: buy it here, or mark it on the map. */
  private lotOffer(l: Lot): void {
    const g = this.g;
    const p = this.panel({ title: l.street, subtitle: districtName(l.district), accent: '#3ddc84' });
    p.body.append(row('Price', money(l.price)), row('Size', `${Math.round(lotArea(l)).toLocaleString('en-US')} m²`));
    const c = { x: (l.x0 + l.x1) / 2, z: (l.z0 + l.z1) / 2 };
    p.footer.append(
      btn('Show on map', '', () => {
        g.setUserWaypoint(c.x, c.z, l.street);
        p.close();
      }),
      btn(`Buy for ${money(l.price)}`, 'primary', () => {
        p.close();
        if (g.business.buyLot(l)) {
          g.setUserWaypoint(c.x, c.z, 'Your lot');
          this.buildPanel(g.business.owned[g.business.owned.length - 1]);
        }
      }, g.money < l.price),
    );
  }

  // ---------------------------------------------------------------- building

  buildPanel(b: Business): void {
    const g = this.g;
    const l = b.lot;
    let pick: BizType | null = null;
    let name = '';
    const p = this.panel({ title: 'What will you build?', subtitle: `${l.street} · ${districtName(l.district)} · ${Math.round(lotArea(l)).toLocaleString('en-US')} m²`, wide: true, accent: '#ffd23d' });
    const grid = el('div', 'pgrid');
    const nameRow = el('div', 'pname');
    const input = el('input', 'pinput') as HTMLInputElement;
    input.maxLength = 28;
    input.placeholder = 'Name it';
    input.addEventListener('input', () => (name = input.value));
    input.addEventListener('keydown', (e) => e.stopPropagation());
    nameRow.append(el('span', '', 'Name'), input);
    const go = btn('Choose a building', 'primary', () => {
      if (!pick) return;
      if (g.business.build(b, pick, name)) p.close();
    }, true);
    const render = () => {
      grid.innerHTML = '';
      for (const d of BIZ) {
        const fits = lotArea(l) >= d.minArea;
        const cost = buildCost(d.type, l);
        let per = 0;
        for (let h = 0; h < 24; h++) per += hourlyIncome(d.type, l, 1, h);
        per /= 24;
        const sub = !fits ? `Needs ${d.minArea.toLocaleString('en-US')} m²` : d.type === 'casino' ? 'Earns from the games you put in' : d.type === 'house' ? 'Sleep, save, park' : `≈ ${money(per)}/hour here`;
        grid.appendChild(card({
          icon: d.icon,
          title: d.name,
          sub: `${sub}\n${d.desc}`,
          price: money(cost),
          color: d.color,
          disabled: !fits,
          selected: pick === d.type,
          onClick: () => {
            pick = d.type;
            if (!name || BIZ.some((x) => defaultName(x.type, g.playerName) === name)) {
              name = defaultName(d.type, g.playerName);
              input.value = name;
            }
            render();
          },
        }));
      }
      if (pick) {
        const cost = buildCost(pick, l);
        go.textContent = g.money >= cost ? `Build ${bizDef(pick).name} · ${money(cost)}` : `Need ${money(cost - g.money)} more`;
        go.disabled = g.money < cost;
      }
    };
    render();
    p.body.append(grid, nameRow);
    p.footer.append(
      btn(`Sell lot (+${money(Math.round(g.business.value(b) * 0.6))})`, 'danger', () => {
        p.close();
        this.confirm('Sell this lot?', `You get ${money(Math.round(g.business.value(b) * 0.6))} back.`, 'Sell', () => g.business.sell(b), true);
      }),
      go,
    );
  }

  bizPanel(b: Business): void {
    const g = this.g;
    const s = b.save;
    const d = bizDef(s.type);
    const p = this.panel({ title: s.name, subtitle: `${d.icon} ${d.name} · ${b.lot.street} · ${districtName(b.lot.district)}`, wide: s.type === 'casino', accent: d.color });
    const h = Math.floor(g.hours);
    if (s.building > 0) {
      p.body.append(row('Status', `Under construction · ${Math.ceil(s.building)} s to go`));
      p.footer.append(btn('OK', 'primary', () => p.close()));
      return;
    }
    let nowRate = 0;
    if (s.type === 'casino') nowRate = casinoHourly(s.items, b.lot, h, true) - dealersNeeded(s.items) * 6;
    else nowRate = hourlyIncome(s.type as BizType, b.lot, s.level, h);
    p.body.append(
      row('Level', `${s.level} / ${MAX_LEVEL}`),
      row('Earning right now', `${money(nowRate)} per hour`),
      row('Today', money(s.today)),
      row('All time', money(s.earned)),
      row('Worth', money(g.business.value(b))),
    );
    if (s.type === 'casino') {
      const slots = s.items.filter((i) => i.kind === 'slots' || i.kind === 'videopoker').length;
      p.body.append(
        row('Floor', `${slots} machines · ${s.items.length - slots} tables`),
        row('Dealers on shift', `${dealersNeeded(s.items)} (${money(dealersNeeded(s.items) * 6)}/hour wages)`),
        row('Casino rank', `★ ${casinoLevel(s.earned)}`),
      );
      p.body.appendChild(el('div', 'ptext dim', 'Guests play your games around the clock; the house edge is your profit. More kinds of games bring in more players. Busiest at night, and on the Strip.'));
    }
    if (s.type === 'house') p.body.appendChild(el('div', 'ptext dim', 'Your home. Sleep here to skip to morning and save. You respawn here if you get knocked out.'));
    const up = s.level < MAX_LEVEL ? upgradeCost(s.type as BizType, b.lot, s.level) : 0;
    const foot: HTMLButtonElement[] = [];
    foot.push(btn('Sell', 'danger', () => {
      p.close();
      this.confirm(`Sell ${s.name}?`, `You get ${money(Math.round(g.business.value(b) * 0.6))} back (60% of what you put in).`, 'Sell', () => g.business.sell(b), true);
    }));
    foot.push(btn('Rename', '', () => {
      p.close();
      this.rename(b);
    }));
    if (s.type === 'casino') {
      foot.push(btn('Change look · $2,000', '', () => {
        if (g.money < 2000) return g.hud.toast('You need $2,000', 'bad');
        g.money -= 2000;
        s.style = (s.style + 1) % 5;
        p.close();
        g.business.refresh(b);
        g.save();
      }, g.money < 2000));
      foot.push(btn('Edit floor', 'green', () => {
        p.close();
        g.floorEditor.open(b);
      }, !b.venue));
    }
    if (s.level < MAX_LEVEL) foot.push(btn(`Upgrade · ${money(up)}`, 'primary', () => {
      if (g.business.upgrade(b)) p.close();
    }, g.money < up));
    p.footer.append(...foot);
  }

  private rename(b: Business): void {
    const g = this.g;
    const p = this.panel({ title: 'Rename' });
    const input = el('input', 'pinput') as HTMLInputElement;
    input.maxLength = 28;
    input.value = b.save.name;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') ok();
    });
    const ok = () => {
      const v = input.value.trim();
      if (v) {
        b.save.name = v.slice(0, 28);
        g.business.refresh(b);
        g.save();
      }
      p.close();
    };
    p.body.appendChild(input);
    p.footer.append(btn('Save', 'primary', ok));
    setTimeout(() => input.focus(), 50);
  }

  // ---------------------------------------------------------------- shops

  gunShop(): void {
    const g = this.g;
    const p = this.panel({ title: 'Bullseye Guns', subtitle: 'Licensed, legal, no questions asked', wide: true, accent: '#ff5a6a' });
    const grid = el('div', 'pgrid');
    const render = () => {
      grid.innerHTML = '';
      for (const gun of GUNS.filter((x) => !x.secret)) {
        const owned = g.combat.owned.includes(gun.id);
        grid.appendChild(card({
          icon: gun.twoHand ? '🔫' : '🔫',
          title: gun.name,
          sub: `${gun.blurb}\nDamage ${gun.dmg}${gun.pellets > 1 ? `×${gun.pellets}` : ''} · ${gun.auto ? 'auto' : 'semi'} · ${gun.mag} rounds`,
          price: owned ? 'Owned' : money(gun.price),
          color: owned ? '#3ddc84' : g.money >= gun.price ? '#ff5a6a' : '#8e9aaf',
          disabled: owned || g.money < gun.price,
          onClick: () => {
            g.addMoney(-gun.price, `for the ${gun.name}`);
            g.combat.give(gun.id);
            audio.play('purchase');
            render();
            g.save();
          },
        }));
      }
    };
    render();
    p.body.append(grid, el('div', 'ptext dim', 'Press 1–7 to draw a gun, Q to holster. Right mouse aims, left fires, R reloads. Guns only fire outdoors.'));
  }

  carDealer(): void {
    const g = this.g;
    const p = this.panel({ title: 'Island Motors', subtitle: 'New cars delivered to the lot out front', wide: true, accent: '#3aa7ff' });
    const grid = el('div', 'pgrid');
    const render = () => {
      grid.innerHTML = '';
      for (const v of VEHICLES.filter((x) => x.price > 0 && x.id !== 'pickup')) {
        const owned = g.vehicles.list.filter((c) => c.owned && c.def.id === v.id).length;
        grid.appendChild(card({
          icon: '🚗',
          title: v.name,
          sub: `Top speed ${Math.round(v.top * 3.6)} km/h · ${v.seats} seats${owned ? ` · you own ${owned}` : ''}`,
          price: money(v.price),
          color: g.money >= v.price ? '#3aa7ff' : '#8e9aaf',
          disabled: g.money < v.price,
          onClick: () => {
            p.close();
            g.buyCar(v.id);
          },
        }));
      }
    };
    render();
    p.body.appendChild(grid);
  }

  wardrobe(shop: boolean): void {
    const g = this.g;
    const p = this.panel({ title: shop ? 'Drip Locker' : 'Wardrobe', subtitle: shop ? 'Outfits for every occasion' : 'Your outfits', wide: true, accent: '#d68bff' });
    const grid = el('div', 'pgrid');
    const render = () => {
      grid.innerHTML = '';
      for (const s of SKINS) {
        const owned = g.ownedSkins.includes(s.id);
        if (!shop && !owned) continue;
        const buyable = shop && !owned && !s.unlock;
        const wearing = g.appearance.skinId === s.id;
        grid.appendChild(card({
          icon: rarityIcon(s.rarity),
          title: s.name,
          sub: `${s.rarity.toUpperCase()} · ${s.desc}${!owned && s.unlock ? `\nUnlock: ${s.unlock === 'base' ? 'Fort Hammerhead armory' : s.unlock}` : ''}`,
          price: wearing ? 'Wearing' : owned ? 'Wear' : s.unlock ? 'Locked' : money(s.price),
          color: RARITY_COLORS[s.rarity],
          selected: wearing,
          disabled: !owned && (!buyable || g.money < s.price),
          onClick: () => {
            if (!owned) {
              g.addMoney(-s.price, `for the ${s.name} outfit`);
              g.ownedSkins.push(s.id);
              audio.play('purchase');
            }
            g.wear(s.id);
            render();
            g.save();
          },
        }));
      }
    };
    render();
    p.body.appendChild(grid);
  }

  /** The hospital: a free check-up (and where you wake up after a knockout). */
  hospital(): void {
    const g = this.g;
    const p = this.panel({ title: 'Mercy Island Hospital', accent: '#ff6b6b' });
    p.body.appendChild(el('div', 'ptext', g.combat.hp < 100 ? 'A nurse patches you up. Free of charge: this is a nice island.' : 'You are in perfect health.'));
    g.combat.hp = 100;
    p.footer.append(btn('Thanks', 'primary', () => p.close()));
  }

  // ---------------------------------------------------------------- map

  mapPanel(): void {
    const g = this.g;
    const p = this.panel({ title: 'Jackpot Island', subtitle: 'Click anywhere to set a waypoint', wide: true, accent: '#3aa7ff' });
    const wrap = el('div', 'bigmap');
    const c = document.createElement('canvas');
    const m = g.map;
    c.width = m.w;
    c.height = m.h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(m.base, 0, 0);
    const k = m.w / m.base.width;
    for (const mk of g.mapMarkers(true)) {
      const q = m.toMap(mk.x, mk.z);
      drawMarker(ctx, q.x * k, q.y * k, mk, mk.big ? 18 : 13);
      if (mk.label && mk.big) {
        ctx.font = '700 13px Nunito, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 3;
        ctx.textAlign = 'center';
        ctx.strokeText(mk.label, q.x * k, q.y * k - 16);
        ctx.fillText(mk.label, q.x * k, q.y * k - 16);
      }
    }
    // You.
    const me = m.toMap(g.player.pos.x, g.player.pos.z);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#0b1a3a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(me.x * k, me.y * k, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    c.addEventListener('click', (e) => {
      const r = c.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * m.w;
      const py = ((e.clientY - r.top) / r.height) * m.h;
      const w = m.toWorld(px, py);
      g.setUserWaypoint(w.x, w.z, 'Waypoint');
      p.close();
    });
    wrap.appendChild(c);
    const legend = el('div', 'maplegend', g.mapMarkers(true).filter((x) => x.big && x.label).slice(0, 0).map(() => '').join('') + '<span>🎰 Casinos</span><span>🏠 Yours</span><span>💲 For sale</span><span>🔫 Guns</span><span>🚗 Cars</span><span>👕 Clothes</span><span>⭐ Objective</span>');
    p.body.append(wrap, legend);
    p.footer.append(btn('Clear waypoint', '', () => {
      g.clearUserWaypoint();
      p.close();
    }));
  }

  // ---------------------------------------------------------------- pause and settings

  pauseMenu(): void {
    const g = this.g;
    const p = this.panel({ title: 'Paused', subtitle: `${g.playerName} · Day ${g.day}` });
    p.body.append(
      row('Cash', money(g.money)),
      row('Net worth', money(g.netWorth())),
      row('Businesses', String(g.business.owned.length)),
      row('Cars', String(g.vehicles.list.filter((v) => v.owned).length)),
    );
    const list = el('div', 'pmenu');
    list.append(
      btn('Resume', 'primary', () => p.close()),
      btn('Map (M)', '', () => {
        p.close();
        this.mapPanel();
      }),
      btn('Wardrobe', '', () => {
        p.close();
        this.wardrobe(false);
      }),
      btn('Settings', '', () => {
        p.close();
        this.settings();
      }),
      btn('Controls', '', () => {
        p.close();
        this.controls();
      }),
      btn('Save game', '', () => {
        g.save(true);
        g.hud.toast('Game saved', 'good');
      }),
    );
    p.body.appendChild(list);
  }

  controls(): void {
    const p = this.panel({ title: 'Controls' });
    const lines: [string, string][] = [
      ['Move', 'W A S D'], ['Look', 'Mouse'], ['Sprint', 'Shift'], ['Jump', 'Space'], ['Use / talk / sit', 'E'], ['First / third person', 'V'],
      ['Map', 'M'], ['Pause', 'Esc / P'], ['Drive', 'W S, A D steer, Space handbrake, Shift boost'], ['Get out', 'E'],
      ['Guns', '1–7 draw, Q holster, LMB fire, RMB aim, R reload'], ['At a table', 'Mouse to look, click chips and buttons, Esc to stand'],
    ];
    for (const [a, b] of lines) p.body.appendChild(row(a, b));
    p.footer.append(btn('OK', 'primary', () => p.close()));
  }

  settings(): void {
    const g = this.g;
    const p = this.panel({ title: 'Settings' });
    const r = g.renderer;
    const qrow = el('div', 'pseg');
    const render = () => {
      qrow.innerHTML = '<span>Graphics</span>';
      for (const q of ['low', 'medium', 'high'] as Quality[]) {
        qrow.appendChild(btn(q[0].toUpperCase() + q.slice(1), r.settings.quality === q ? 'primary sm' : 'sm', () => {
          r.setQuality(q);
          g.applyQuality();
          render();
        }));
      }
    };
    render();
    const slider = (label: string, min: number, max: number, step: number, value: number, set: (v: number) => void) => {
      const w = el('label', 'pslider', `<span>${esc(label)}</span>`);
      const i = el('input') as HTMLInputElement;
      i.type = 'range';
      i.min = String(min);
      i.max = String(max);
      i.step = String(step);
      i.value = String(value);
      i.addEventListener('input', () => set(Number(i.value)));
      w.appendChild(i);
      return w;
    };
    const st = g.settings;
    p.body.append(
      qrow,
      slider('Field of view', 50, 90, 1, r.settings.fov, (v) => r.setFov(v)),
      slider('Mouse sensitivity', 0.3, 2.5, 0.05, st.sensitivity, (v) => {
        st.sensitivity = v;
        g.camera.sensitivity = v;
      }),
      slider('Sound effects', 0, 1, 0.05, st.sfx, (v) => {
        st.sfx = v;
        g.applyAudio();
      }),
      slider('Music', 0, 1, 0.05, st.music, (v) => {
        st.music = v;
        g.applyAudio();
      }),
    );
    const inv = el('label', 'pcheck', '<span>Invert mouse Y</span>');
    const cb = el('input') as HTMLInputElement;
    cb.type = 'checkbox';
    cb.checked = st.invertY;
    cb.addEventListener('change', () => {
      st.invertY = cb.checked;
      g.camera.invertY = cb.checked;
    });
    inv.appendChild(cb);
    p.body.appendChild(inv);
    p.footer.append(btn('Done', 'primary', () => {
      g.save();
      p.close();
    }));
  }

  // ---------------------------------------------------------------- title and creator

  /** The title screen over a slow fly-by. Resolves with the player's choice. */
  title(hasSave: boolean, summary: string): Promise<'new' | 'continue'> {
    const g = this.g;
    return new Promise((res) => {
      const t = el('div', 'title-screen');
      t.innerHTML = `
        <div class="logo big"><div class="l1">CASINO SIMULATOR</div><div class="l2">2</div><div class="l3">JACKPOT ISLAND</div></div>
        <div class="title-menu"></div>
        <div class="title-foot">Version 2 · everyone starts from zero</div>`;
      const menu = t.querySelector('.title-menu') as HTMLDivElement;
      const go = (c: 'new' | 'continue') => {
        audio.unlock();
        audio.play('click');
        t.classList.add('out');
        setTimeout(() => t.remove(), 500);
        res(c);
      };
      if (hasSave) {
        const c = btn('Continue', 'pbtn primary big', () => go('continue'));
        c.innerHTML = `Continue<small>${esc(summary)}</small>`;
        menu.appendChild(c);
      }
      menu.appendChild(btn(hasSave ? 'New game' : 'Play', `pbtn ${hasSave ? '' : 'primary'} big`, () => {
        if (!hasSave) return go('new');
        this.confirm('Start over?', 'Your saved game will be replaced when the new one saves.', 'New game', () => go('new'), true);
      }));
      menu.appendChild(btn('Settings', 'pbtn big', () => this.settings()));
      // The first game is across Interstate 15.
      const back = mainlandName();
      if (arrivedFromMainland()) menu.prepend(el('div', 'title-hello', esc(`Welcome across Interstate 15${back ? `, ${back}` : ''}! On the island everyone starts from zero.`)));
      menu.appendChild(btn('◂ Back to the mainland: Casino Simulator 1', 'title-link', () => goToMainland(g)));
      g.uiRoot.appendChild(t);
    });
  }

  /** Pick a name and a look. The camera frames the player while you choose. */
  creator(): Promise<{ name: string; appearance: Appearance }> {
    const g = this.g;
    return new Promise((res) => {
      let a = appearanceFromSkin('rookie');
      let name = '';
      const box = el('div', 'creator');
      const apply = () => g.player.setAppearance(a);
      const head = el('div', 'cr-head', '<div class="cr-t">WHO ARE YOU?</div><div class="cr-s">Everyone on Jackpot Island starts with nothing.</div>');
      const input = el('input', 'pinput') as HTMLInputElement;
      input.placeholder = 'Your name';
      input.maxLength = 16;
      input.addEventListener('input', () => (name = input.value));
      input.addEventListener('keydown', (e) => e.stopPropagation());
      const sect = (label: string) => el('div', 'cr-l', label);
      const bodyRow = el('div', 'cr-row');
      for (const [id, label] of [['rookie', 'Rookie'], ['rookieF', 'Rookie (F)']] as const) {
        bodyRow.appendChild(btn(label, 'sm', () => {
          const keep = { skin: a.skin, hairColor: a.hairColor };
          a = appearanceFromSkin(id, keep);
          apply();
          paint();
        }));
      }
      const swatches = (list: number[], get: () => number, set: (v: number) => void) => {
        const r = el('div', 'cr-sw');
        const draw = () => {
          r.innerHTML = '';
          for (const c of list) {
            const s = el('button', `sw ${get() === c ? 'sel' : ''}`);
            s.style.background = `#${c.toString(16).padStart(6, '0')}`;
            s.addEventListener('click', (e) => {
              e.stopPropagation();
              set(c);
              apply();
              draw();
            });
            r.appendChild(s);
          }
        };
        draw();
        return { el: r, draw };
      };
      const skin = swatches(SKIN_TONES, () => a.skin, (v) => (a.skin = v));
      const hairC = swatches(HAIR_COLORS, () => a.hairColor, (v) => (a.hairColor = v));
      const hairs: Hair[] = ['short', 'buzz', 'spiky', 'quiff', 'afro', 'mohawk', 'long', 'ponytail', 'bun', 'bob', 'braids', 'bald'];
      const hairRow = el('div', 'cr-row');
      const paint = () => {
        skin.draw();
        hairC.draw();
        hairRow.innerHTML = '';
        for (const h of hairs) hairRow.appendChild(btn(h, a.hair === h ? 'primary sm' : 'sm', () => {
          a.hair = h;
          apply();
          paint();
        }));
      };
      paint();
      const start = btn('Drive to Jackpot Island ▸', 'pbtn primary big', () => {
        const n = (name.trim() || 'Rookie').replace(/[^\p{L}\p{N} '._-]/gu, '').slice(0, 16) || 'Rookie';
        box.remove();
        res({ name: n, appearance: a });
      });
      box.append(head, sect('Name'), input, sect('Body'), bodyRow, sect('Skin tone'), skin.el, sect('Hair'), hairRow, sect('Hair colour'), hairC.el, start);
      box.addEventListener('pointerdown', (e) => e.stopPropagation());
      g.uiRoot.appendChild(box);
      setTimeout(() => input.focus(), 60);
    });
  }
}

function rarityIcon(r: string): string {
  return { common: '⚪', uncommon: '🟢', rare: '🔵', epic: '🟣', legendary: '🟠', mythic: '🌟' }[r] ?? '⚪';
}

export { skinById };
