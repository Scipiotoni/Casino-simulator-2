import * as THREE from 'three';
import type { Game } from '../game/game';
import { audio } from '../core/audio';
import {
  BACKS, BEARDS, BOTTOMS, BROWS, BUILD_RANGE, CLOTH_COLORS, DEFAULT_FACE, EYES, GLASSES, HAIRS, HAIR_COLORS, HATS, HEIGHT_RANGE, LIPS, MARKS, NECKS,
  SHOES, SKIN_TONES, TOPS, pieceSources, pieceUnlocked, type Appearance, type FaceStyle, type Outfit, type PieceKind,
} from '../chars/skins';
import { EYE_COLORS } from '../chars/faces';
import { MAX_LOOKS } from '../game/save';
import { el, esc } from './dom';
import { btn } from './panel';

/**
 * The character editor: body, face, hair, outfit and extras, each piece with its colours,
 * plus saved looks in the wardrobe. It docks beside the player (under them on a phone) while
 * the camera frames the whole body, or the face for the face and hair tabs; drag anywhere
 * else to turn the player round. Used by the creator at the start and the flat's wardrobe.
 */

type Tab = 'body' | 'face' | 'hair' | 'outfit' | 'extras' | 'looks';

const LABELS: Record<string, string> = {
  // Tops
  tee: 'T-shirt', tank: 'Tank top', hoodie: 'Hoodie', jacket: 'Jacket', hawaiian: 'Holiday shirt', vest: 'Waistcoat', suit: 'Suit', dress: 'Dress',
  racing: 'Racing suit', military: 'Fatigues', tux: 'Tuxedo', coat: 'Long coat', armor: 'Armour',
  // Bottoms
  jeans: 'Jeans', cargo: 'Cargos', shorts: 'Shorts', slacks: 'Slacks', skirt: 'Skirt', camo: 'Camo',
  // Shoes
  sneakers: 'Trainers', boots: 'Boots', loafers: 'Loafers', sandals: 'Sandals', heels: 'Heels',
  // Hats, glasses, back, neck
  none: 'None', cap: 'Cap', beanie: 'Beanie', 'hat:visor': 'Sun visor', bandana: 'Bandana', fedora: 'Fedora', cowboy: 'Cowboy', beret: 'Beret',
  headset: 'Earpiece', helmet: 'Helmet', tophat: 'Top hat', crown: 'Crown',
  shades: 'Shades', aviators: 'Aviators', round: 'Round', goggles: 'Goggles', 'glasses:visor': 'Cyber visor',
  backpack: 'Backpack', surfboard: 'Surfboard', guitar: 'Guitar', jetpack: 'Jetpack', chips: 'Chip stack', dice: 'Giant dice', cape: 'Cape', wings: 'Wings',
  chain: 'Gold chain', tie: 'Tie', bowtie: 'Bow tie', scarf: 'Scarf', mask: 'Face mask',
  // Hair
  short: 'Short', buzz: 'Buzz cut', spiky: 'Spiky', quiff: 'Quiff', afro: 'Afro', mohawk: 'Mohawk', long: 'Long', ponytail: 'Ponytail', bun: 'Bun',
  bob: 'Bob', braids: 'Braids', bald: 'Bald',
  // Face
  soft: 'Soft', thick: 'Bold', thin: 'Thin', arched: 'Arched', straight: 'Straight',
  stubble: 'Stubble', moustache: 'Moustache', goatee: 'Goatee', chinstrap: 'Chinstrap', full: 'Full beard',
  natural: 'Natural', nude: 'Nude', pink: 'Pink', red: 'Red', plum: 'Plum', black: 'Black',
  freckles: 'Freckles', blush: 'Blush', beauty: 'Beauty mark', scar: 'Scar', star: 'Star', warpaint: 'War paint',
};
const label = (v: string, kind = ''): string => LABELS[`${kind}:${v}`] ?? LABELS[v] ?? v;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export interface EditorOpts {
  start: Appearance;
  /** 'create' for a new character (no saved looks, everything basic is free). */
  mode: 'create' | 'wardrobe';
  /** Header (title and a line under it). */
  title: string;
  subtitle: string;
  /** Extra controls above the tabs (the creator's name box). */
  top?: HTMLElement;
  /** Buttons in the footer, after Randomise. */
  actions: HTMLElement[];
}

export class LookEditor {
  readonly root: HTMLDivElement;
  a: Appearance;
  private tab: Tab = 'body';
  private body: HTMLDivElement;
  private tabs: HTMLDivElement;
  private hint: HTMLDivElement;
  private raf = 0;
  private applyT = 0;
  private pending = false;
  private spin = 0;
  private baseYaw = 0;
  private drag: { x: number; spin: number } | null = null;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camReady = false;
  private room = 99;

  constructor(private g: Game, private opts: EditorOpts) {
    this.a = structuredClone(opts.start);
    this.a.face ??= { ...DEFAULT_FACE };
    this.root = el('div', 'creator lk');
    const head = el('div', 'cr-head', `<div class="cr-t">${esc(opts.title)}</div><div class="cr-s">${esc(opts.subtitle)}</div>`);
    this.tabs = el('div', 'lk-tabs');
    this.body = el('div', 'lk-body');
    this.hint = el('div', 'lk-hint');
    const foot = el('div', 'lk-foot');
    const turn = el('div', 'lk-turn');
    turn.append(
      btn('⟲', 'sm', () => (this.spin -= Math.PI / 4)),
      btn('⟳', 'sm', () => (this.spin += Math.PI / 4)),
      btn('🎲 Random', 'sm', () => this.randomise()),
    );
    foot.append(turn, ...opts.actions);
    this.root.append(head);
    if (opts.top) this.root.append(opts.top);
    this.root.append(this.tabs, this.body, this.hint, foot);
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    // Typing a name mustn't drive the game; Esc still gets through (it cancels in the wardrobe).
    this.root.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') e.stopPropagation();
    });
    window.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    this.drawTabs();
    this.draw();
    g.uiRoot.appendChild(this.root);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Which way the camera looks at the player from (the player turns to face it), and how much room there is that way. */
  setFacing(yaw: number, room = 99): void {
    this.baseYaw = yaw;
    this.room = room;
    this.camReady = false;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.root.remove();
    this.g.previewYaw = null;
  }

  // ---------------------------------------------------------------- turning and the camera

  private onDown = (e: PointerEvent) => {
    if (this.root.contains(e.target as Node)) return;
    const t = e.target as HTMLElement;
    if (t.closest('button, input, .panel-wrap')) return;
    this.drag = { x: e.clientX, spin: this.spin };
  };
  private onMove = (e: PointerEvent) => {
    if (this.drag) this.spin = this.drag.spin + (e.clientX - this.drag.x) * 0.012;
  };
  private onUp = () => {
    this.drag = null;
  };

  private frame = () => {
    this.raf = requestAnimationFrame(this.frame);
    const g = this.g;
    const p = g.player.pos;
    const yaw = this.baseYaw + this.spin;
    g.previewYaw = yaw;
    g.player.yaw = yaw;
    // Frame the body, or the head for the face and hair tabs, beside the editor (above it on a phone).
    const phone = innerWidth < 700;
    const face = this.tab === 'face' || this.tab === 'hair';
    const h = this.a.height;
    // Pull in where a wall is close behind the camera, widening the view to fit the same frame.
    let dist = face ? (phone ? 1.7 : 1.25) : phone ? 5 : 3.6;
    dist = Math.min(dist, Math.max(face ? 0.8 : 1.6, this.room - 0.35));
    const half = face ? (phone ? 0.58 : 0.455) : phone ? 2.33 : 1.31;
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(half / dist));
    const lookY = face ? 1.63 * h - (phone ? 0.32 : 0) : phone ? -0.2 : 0.95 * h;
    const camY = face ? 1.66 * h : phone ? 1.0 : 1.25 * h;
    const fx = Math.sin(this.baseYaw);
    const fz = Math.cos(this.baseYaw);
    // On a wide screen, move the player into the middle of the space the editor leaves.
    const panel = phone ? 0 : (this.root.getBoundingClientRect().right + 8) / innerWidth;
    const aspect = innerWidth / innerHeight;
    const halfW = dist * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * aspect;
    const shift = panel * halfW;
    // Aim to the camera's left of the player, so they sit right of the editor.
    const lx = -fz;
    const lz = fx;
    const wantPos = new THREE.Vector3(p.x + fx * dist, p.y + camY, p.z + fz * dist);
    const wantLook = new THREE.Vector3(p.x + lx * shift, p.y + lookY, p.z + lz * shift);
    if (!this.camReady) {
      this.camPos.copy(wantPos);
      this.camLook.copy(wantLook);
      this.camReady = true;
    } else {
      this.camPos.lerp(wantPos, 0.12);
      this.camLook.lerp(wantLook, 0.12);
    }
    g.camera.cinePos.copy(this.camPos);
    g.camera.cineLook.copy(this.camLook);
    g.camera.cineFov = fov;
  };

  // ---------------------------------------------------------------- applying changes

  /** Rebuild the player with the new look (at most every 90 ms while dragging a slider). */
  private apply(now = false): void {
    const t = performance.now();
    if (!now && t - this.applyT < 90) {
      if (!this.pending) {
        this.pending = true;
        setTimeout(() => {
          this.pending = false;
          this.apply(true);
        }, 90);
      }
      return;
    }
    this.applyT = t;
    this.g.setAppearance(structuredClone(this.a));
  }

  private change(fn: () => void, outfit = false, redraw = true): void {
    fn();
    if (outfit) this.a.skinId = 'custom';
    audio.play('click');
    this.apply(true);
    if (redraw) this.draw();
  }

  private randomise(): void {
    const r = Math.random;
    const pick = <T,>(l: readonly T[]) => l[Math.floor(r() * l.length)];
    const owned = this.g.ownedSkins;
    const free = <T extends string>(kind: PieceKind, l: readonly T[]) => l.filter((v) => pieceUnlocked(kind, v, owned));
    const a = this.a;
    const f = a.body === 'f';
    a.skin = pick(SKIN_TONES);
    a.eyes = pick(EYES);
    a.hair = pick(HAIRS.filter((h) => (f ? h !== 'buzz' : true)));
    a.hairColor = pick(HAIR_COLORS.slice(0, r() < 0.8 ? 6 : 12));
    a.height = 0.95 + r() * 0.1;
    a.build = 0.94 + r() * 0.14;
    a.face = {
      brows: pick(BROWS),
      beard: f || r() < 0.5 ? 'none' : pick(BEARDS),
      lips: f && r() < 0.6 ? pick(LIPS) : 'natural',
      marks: r() < 0.65 ? 'none' : pick(MARKS),
      lashes: f ? r() < 0.8 : false,
    };
    const tops = free('top', TOPS).filter((t) => t !== 'armor' && (f || t !== 'dress' || r() < 0.2));
    const o: Outfit = {
      ...a.outfit,
      top: pick(tops),
      bottom: pick(free('bottom', BOTTOMS).filter((b) => f || b !== 'skirt')),
      shoes: pick(SHOES.filter((s) => f || s !== 'heels')),
      hat: r() < 0.35 ? pick(free('hat', HATS)) : 'none',
      glasses: r() < 0.3 ? pick(free('glasses', GLASSES)) : 'none',
      back: r() < 0.2 ? pick(free('back', BACKS)) : 'none',
      neck: r() < 0.3 ? pick(free('neck', NECKS)) : 'none',
      c1: pick(CLOTH_COLORS),
      c2: pick(CLOTH_COLORS),
      accent: pick(CLOTH_COLORS),
      pants: pick(CLOTH_COLORS),
      shoe: pick(CLOTH_COLORS),
      gloves: r() < 0.1,
      glow: pieceUnlocked('glow', true, owned) && r() < 0.15,
    };
    a.outfit = o;
    a.skinId = 'custom';
    audio.play('click');
    this.apply(true);
    this.draw();
  }

  // ---------------------------------------------------------------- drawing

  private drawTabs(): void {
    const list: [Tab, string][] = [['body', 'Body'], ['face', 'Face'], ['hair', 'Hair'], ['outfit', 'Outfit'], ['extras', 'Extras']];
    if (this.opts.mode === 'wardrobe') list.push(['looks', 'Looks']);
    this.tabs.innerHTML = '';
    for (const [id, name] of list) {
      const b = el('button', `lk-tab ${this.tab === id ? 'sel' : ''}`, name);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.tab = id;
        audio.play('click');
        this.drawTabs();
        this.draw();
        this.body.scrollTop = 0;
      });
      this.tabs.appendChild(b);
    }
  }

  draw(): void {
    const top = this.body.scrollTop;
    this.body.innerHTML = '';
    this.hint.textContent = '';
    const a = this.a;
    const o = a.outfit;
    const face = a.face!;
    const sect = (name: string, ...content: HTMLElement[]) => {
      const s = el('div', 'lk-sect');
      s.append(el('div', 'cr-l', esc(name)), ...content);
      this.body.appendChild(s);
    };
    switch (this.tab) {
      case 'body':
        sect('Body', this.chips(['m', 'f'] as const, () => a.body, (v) => (a.body = v), (v) => (v === 'm' ? 'Male' : 'Female')));
        sect('Skin tone', this.swatches(SKIN_TONES, () => a.skin, (v) => (a.skin = v), false));
        sect('Height', this.slider(HEIGHT_RANGE, () => a.height, (v) => (a.height = v), (v) => `${Math.round(175 * v)} cm`));
        sect('Build', this.slider(BUILD_RANGE, () => a.build, (v) => (a.build = v), (v) => (v < 0.97 ? 'Slim' : v < 1.05 ? 'Average' : 'Broad')));
        break;
      case 'face':
        sect('Eyes', this.swatches(EYES.map((_, i) => i), () => EYES.indexOf(a.eyes), (i) => (a.eyes = EYES[i]), false, (i) => EYE_COLORS[EYES[i]]));
        sect('Eyebrows', this.chips(BROWS, () => face.brows, (v) => (face.brows = v)));
        sect('Facial hair', this.chips(BEARDS, () => face.beard, (v) => (face.beard = v)));
        sect('Lips', this.chips(LIPS, () => face.lips, (v) => (face.lips = v)));
        sect('Face details', this.chips(MARKS, () => face.marks, (v) => (face.marks = v)));
        sect('Lashes', this.chips([false, true] as const, () => face.lashes, (v) => (face.lashes = v), (v) => (v ? 'Long' : 'Natural')));
        break;
      case 'hair':
        sect('Hairstyle', this.chips(HAIRS, () => a.hair, (v) => (a.hair = v)));
        sect('Hair colour', this.swatches(HAIR_COLORS, () => a.hairColor, (v) => (a.hairColor = v), true));
        this.hint.textContent = 'Eyebrows and facial hair take the hair colour.';
        break;
      case 'outfit':
        sect('Top', this.chips(TOPS, () => o.top, (v) => (o.top = v), undefined, 'top'));
        sect('Main colour', this.swatches(CLOTH_COLORS, () => o.c1, (v) => (o.c1 = v), true, undefined, true));
        sect('Second colour', this.swatches(CLOTH_COLORS, () => o.c2, (v) => (o.c2 = v), true, undefined, true));
        sect('Bottoms', this.chips(BOTTOMS, () => o.bottom, (v) => (o.bottom = v), undefined, 'bottom'));
        sect('Bottoms colour', this.swatches(CLOTH_COLORS, () => o.pants, (v) => (o.pants = v), true, undefined, true));
        sect('Shoes', this.chips(SHOES, () => o.shoes, (v) => (o.shoes = v), undefined, 'shoes'));
        sect('Shoe colour', this.swatches(CLOTH_COLORS, () => o.shoe, (v) => (o.shoe = v), true, undefined, true));
        this.hint.textContent = 'The second colour is the shirt under a jacket, a waistcoat, the pattern on a holiday shirt and most hats.';
        break;
      case 'extras':
        sect('Hat', this.chips(HATS, () => o.hat, (v) => (o.hat = v), (v) => label(v, 'hat'), 'hat'));
        sect('Glasses', this.chips(GLASSES, () => o.glasses, (v) => (o.glasses = v), (v) => label(v, 'glasses'), 'glasses'));
        sect('Neck', this.chips(NECKS, () => o.neck, (v) => (o.neck = v), undefined, 'neck'));
        sect('On your back', this.chips(BACKS, () => o.back, (v) => (o.back = v), undefined, 'back'));
        sect('Details colour', this.swatches(CLOTH_COLORS, () => o.accent, (v) => (o.accent = v), true, undefined, true));
        sect('Gloves', this.chips([false, true] as const, () => o.gloves, (v) => (o.gloves = v), (v) => (v ? 'On' : 'Off'), undefined, true));
        sect('Neon trim', this.chips([false, true] as const, () => o.glow, (v) => (o.glow = v), (v) => (v ? 'On' : 'Off'), 'glow'));
        this.hint.textContent = 'Details are trims, logos, ties, bandanas and neon. 🔒 pieces come with an outfit from the Drip Locker.';
        break;
      case 'looks':
        this.drawLooks(sect);
        break;
    }
    this.body.scrollTop = top;
  }

  /** A row of choices. `kind` marks outfit pieces (they may be locked). */
  private chips<T extends string | boolean>(list: readonly T[], get: () => T, set: (v: T) => void, name: (v: T) => string = (v) => label(String(v)), kind?: PieceKind, outfit = !!kind): HTMLDivElement {
    const row = el('div', 'cr-row');
    for (const v of list) {
      const locked = kind ? !pieceUnlocked(kind, v, this.g.ownedSkins) : false;
      const b = el('button', `pbtn sm lk-chip ${get() === v ? 'primary' : ''} ${locked ? 'locked' : ''}`, `${locked ? '🔒 ' : ''}${esc(name(v))}`);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (locked) {
          const from = pieceSources(kind!, v).map((s) => s.name);
          this.hint.textContent = `${name(v)} comes with ${from.length ? from.join(' or ') : 'a special outfit'}. Get it at the Drip Locker${from.length ? '' : ''}.`;
          audio.play('error');
          return;
        }
        this.change(() => set(v), outfit);
      });
      row.appendChild(b);
    }
    return row;
  }

  /** Colour circles, plus a picker for any colour. `css` gives a swatch's colour when the values aren't colours. */
  private swatches(list: readonly number[], get: () => number, set: (v: number) => void, any: boolean, css?: (v: number) => string, outfit = false): HTMLDivElement {
    const row = el('div', 'cr-sw');
    const cur = get();
    for (const c of list) {
      const s = el('button', `sw ${cur === c ? 'sel' : ''}`);
      s.style.background = css ? css(c) : hex(c);
      s.addEventListener('click', (e) => {
        e.stopPropagation();
        this.change(() => set(c), outfit);
      });
      row.appendChild(s);
    }
    if (any) {
      const wrap = el('label', `sw any ${list.includes(cur) ? '' : 'sel'}`);
      wrap.title = 'Any colour';
      const inp = el('input') as HTMLInputElement;
      inp.type = 'color';
      inp.value = hex(cur);
      if (!list.includes(cur)) wrap.style.background = hex(cur);
      inp.addEventListener('input', () => {
        set(parseInt(inp.value.slice(1), 16));
        if (outfit) this.a.skinId = 'custom';
        wrap.style.background = inp.value;
        this.apply();
      });
      inp.addEventListener('change', () => this.draw());
      wrap.appendChild(inp);
      row.appendChild(wrap);
    }
    return row;
  }

  private slider(range: [number, number], get: () => number, set: (v: number) => void, show: (v: number) => string): HTMLDivElement {
    const row = el('div', 'lk-slider');
    const inp = el('input') as HTMLInputElement;
    inp.type = 'range';
    inp.min = String(range[0]);
    inp.max = String(range[1]);
    inp.step = '0.005';
    inp.value = String(get());
    const out = el('span', '', esc(show(get())));
    inp.addEventListener('input', () => {
      set(Number(inp.value));
      out.textContent = show(Number(inp.value));
      this.apply();
    });
    row.append(inp, out);
    return row;
  }

  private drawLooks(sect: (name: string, ...c: HTMLElement[]) => void): void {
    const g = this.g;
    const list = el('div', 'lk-looks');
    if (!g.looks.length) list.appendChild(el('div', 'lk-empty', 'No saved looks yet. Dress up, name it and save it here.'));
    g.looks.forEach((l, i) => {
      const r = el('div', 'lk-look');
      const o = l.a.outfit;
      r.innerHTML = `<span class="lk-dots">${[o.c1, o.c2, o.pants, o.accent].map((c) => `<i style="background:${hex(c)}"></i>`).join('')}</span><b>${esc(l.name)}</b>`;
      r.append(
        btn('Wear', 'sm primary', () => {
          this.a = structuredClone(l.a);
          this.a.face ??= { ...DEFAULT_FACE };
          audio.play('click');
          this.apply(true);
          this.draw();
        }),
        btn('✕', 'sm danger', () => {
          g.looks.splice(i, 1);
          g.save();
          this.draw();
        }),
      );
      list.appendChild(r);
    });
    sect(`Saved looks (${g.looks.length}/${MAX_LOOKS})`, list);
    const name = el('input', 'pinput') as HTMLInputElement;
    name.placeholder = `Look ${g.looks.length + 1}`;
    name.maxLength = 20;
    const save = btn('Save this look', 'sm green', () => {
      if (g.looks.length >= MAX_LOOKS) return;
      const n = name.value.replace(/[^\p{L}\p{N} '._!-]/gu, '').trim().slice(0, 20) || `Look ${g.looks.length + 1}`;
      g.looks.push({ name: n, a: structuredClone(this.a) });
      g.save();
      audio.play('coin');
      this.draw();
    }, g.looks.length >= MAX_LOOKS);
    const row = el('div', 'lk-save');
    row.append(name, save);
    sect('Save the look you have on', row);
  }
}

/** A plain face for a new character, so the editor's face options start from the default. */
export function withFace(a: Appearance): Appearance {
  return { ...a, face: a.face ?? ({ ...DEFAULT_FACE } as FaceStyle) };
}
