import { el, esc } from './dom';

/**
 * The loading screen: Jackpot Island at sunset, its neon skyline twinkling over the water,
 * with the Interstate 15 bridge across the front and a little car driving over it as the
 * load goes on. While you wait there's a slot machine to play for loading-screen chips
 * (click, tap or Space), silly status lines and tips. Plain DOM and CSS; everything it
 * listens to is let go when the game is ready.
 */

const SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣', '🎰'] as const;
/** How often each symbol lands (the sevens and diamonds are rare). */
const WEIGHTS = [6, 6, 5, 5, 2, 1.4, 3];
const COST = 5;

const FUNNY = [
  'Polishing the slot machines',
  'Teaching the croupiers to shuffle',
  'Counting the house edge',
  'Inflating the beach balls',
  'Fuelling the speedboats',
  'Restocking Sunny Mart',
  'Painting the lucky sevens',
  'Tuning the neon',
  'Waxing the roulette wheels',
  'Hiding the golden chip',
  'Waking up the clerks',
  'Raising the drawbridge (just kidding)',
];

const TIPS = [
  '<b>WASD</b> to move, <b>Shift</b> to run, <b>Space</b> to roll',
  '<b>E</b> to use doors, seats, shelves, cars and boats',
  '<b>M</b> opens the map: click it to set a waypoint',
  '<b>T</b> to chat with everyone on the island',
  '<b>V</b> switches first and third person, <b>P</b> pauses',
  'Shoplift at <b>Sunny Mart</b> while the clerk is on the phone',
  'Sell what you lift at <b>Pawn Paradise</b>, no questions asked',
  'Take a speedboat out from <b>Coral Cove Marina</b>',
  'Cargo runs at the <b>Port of Fortuna</b> pay against the clock',
  'Buy land at <b>Paradise Realty</b> and build your own casino',
  'Drive east over <b>Interstate 15</b> to reach the first game',
];

function pick<T>(list: readonly T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

/** A tiny seeded random, so the skyline is the same every time. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The island skyline: casino towers with lit windows and neon trim, palms along the shore. */
function skyline(): string {
  const r = seeded(7);
  const neon = ['#ff4fa3', '#3fe0ff', '#ffd23d', '#b56cff', '#4dffa6'];
  let towers = '';
  let windows = '';
  let x = 140;
  while (x < 860) {
    const w = 34 + r() * 46;
    const h = 70 + r() * 150 * (1 - Math.abs(x - 500) / 520);
    const top = 300 - h;
    const c = neon[Math.floor(r() * neon.length)];
    towers += `<rect x="${x.toFixed(0)}" y="${top.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" rx="3" fill="#1a1036"/>`;
    towers += `<rect x="${x.toFixed(0)}" y="${top.toFixed(0)}" width="${w.toFixed(0)}" height="4" fill="${c}" style="color:${c}" class="ld-neon"/>`;
    if (r() < 0.35) towers += `<rect x="${(x + w / 2 - 1).toFixed(0)}" y="${(top - 18).toFixed(0)}" width="2" height="18" fill="#2a1d4a"/><circle cx="${(x + w / 2).toFixed(0)}" cy="${(top - 19).toFixed(0)}" r="2.5" fill="#ff3b3b" class="ld-blink"/>`;
    for (let wy = top + 12; wy < 292; wy += 12) {
      for (let wx = x + 6; wx < x + w - 8; wx += 10) {
        if (r() < 0.42) {
          const d = (r() * 6).toFixed(2);
          windows += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="5" height="6" fill="${r() < 0.8 ? '#ffe2a0' : '#9be8ff'}" class="ld-win" style="animation-delay:${d}s"/>`;
        }
      }
    }
    x += w + 6 + r() * 18;
  }
  // The big casino in the middle, with a spinning wheel sign on top.
  towers += `<rect x="455" y="96" width="90" height="204" rx="6" fill="#211444"/><rect x="455" y="96" width="90" height="6" fill="#ffd23d" style="color:#ffd23d" class="ld-neon"/>
    <g transform="translate(500 70)"><circle r="24" fill="#1a1036" stroke="#ffd23d" stroke-width="3"/><g class="ld-wheel">${Array.from({ length: 8 }, (_, i) => `<path d="M0 0 L${(Math.cos((i * Math.PI) / 4) * 20).toFixed(1)} ${(Math.sin((i * Math.PI) / 4) * 20).toFixed(1)} A20 20 0 0 1 ${(Math.cos(((i + 1) * Math.PI) / 4) * 20).toFixed(1)} ${(Math.sin(((i + 1) * Math.PI) / 4) * 20).toFixed(1)} Z" fill="${i % 2 ? '#ff3b5c' : '#14141e'}"/>`).join('')}<circle r="4" fill="#ffd23d"/></g></g>
    <text x="500" y="128" text-anchor="middle" class="ld-sign">JACKPOT</text>`;
  const palm = (px: number, s: number) =>
    `<g transform="translate(${px} 300) scale(${s})"><path d="M0 0 Q4 -30 -2 -62" stroke="#120b24" stroke-width="5" fill="none"/>${[-60, -25, 10, 40, 75, 120]
      .map((a) => `<path d="M-2 -62 q${(Math.cos((a * Math.PI) / 180) * 18).toFixed(1)} ${(-10 + Math.sin((a * Math.PI) / 180) * 6).toFixed(1)} ${(Math.cos((a * Math.PI) / 180) * 34).toFixed(1)} ${(8 + Math.sin((a * Math.PI) / 180) * 10).toFixed(1)}" stroke="#120b24" stroke-width="5" fill="none" stroke-linecap="round"/>`)
      .join('')}</g>`;
  const palms = [70, 110, 900, 940].map((p, i) => palm(p, 0.8 + (i % 2) * 0.25)).join('');
  return `<svg class="ld-city" viewBox="0 0 1000 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <path d="M0 300 L0 282 Q120 262 240 280 Q500 250 760 278 Q880 262 1000 282 L1000 300 Z" fill="#120b24"/>
    ${towers}${windows}${palms}</svg>`;
}

/** The bridge across the front: deck, two pylons with cables, the road sign. */
function bridge(): string {
  const cables = [180, 820]
    .map((px) => Array.from({ length: 7 }, (_, i) => `<line x1="${px}" y1="22" x2="${px - 150 + i * 50}" y2="96" stroke="#f4d9ff" stroke-width="1.2" opacity="0.7"/>`).join(''))
    .join('');
  return `<svg class="ld-bridge" viewBox="0 0 1000 150" preserveAspectRatio="none" aria-hidden="true">
    ${cables}
    ${[180, 820].map((px) => `<rect x="${px - 6}" y="14" width="12" height="136" fill="#2a1d4a"/><circle cx="${px}" cy="12" r="4" fill="#ff3b3b" class="ld-blink"/>`).join('')}
    <rect x="0" y="96" width="1000" height="12" fill="#2a1d4a"/>
    <rect x="0" y="92" width="1000" height="4" fill="#ffd23d" opacity="0.85"/>
    ${Array.from({ length: 40 }, (_, i) => `<rect x="${i * 25 + 4}" y="101" width="12" height="2" fill="#ffffff" opacity="0.6"/>`).join('')}
    ${Array.from({ length: 9 }, (_, i) => `<rect x="${60 + i * 110}" y="108" width="10" height="42" fill="#1f1538"/>`).join('')}
  </svg>`;
}

const CAR = `<svg class="ld-car" viewBox="0 0 80 36" aria-hidden="true">
  <path d="M6 24 Q6 16 14 15 L24 14 L32 6 Q34 4 38 4 L54 4 Q58 4 60 8 L66 15 Q76 16 76 24 L76 27 L6 27 Z" fill="#4fc3f7"/>
  <path d="M34 7 L52 7 Q55 7 56 9 L61 15 L28 15 Z" fill="#163a5a"/>
  <rect x="73" y="18" width="5" height="4" rx="1" fill="#fff6c4"/>
  <path d="M78 18 L140 10 L140 32 L78 22 Z" fill="url(#beam)" opacity="0.55"/>
  <rect x="4" y="19" width="4" height="4" rx="1" fill="#ff3b3b"/>
  <circle cx="22" cy="27" r="6" fill="#111"/><circle cx="22" cy="27" r="2.5" fill="#bbb"/>
  <circle cx="60" cy="27" r="6" fill="#111"/><circle cx="60" cy="27" r="2.5" fill="#bbb"/>
  <defs><linearGradient id="beam"><stop offset="0" stop-color="#fff6c4"/><stop offset="1" stop-color="#fff6c4" stop-opacity="0"/></linearGradient></defs>
</svg>`;

export class LoadingScreen {
  readonly root: HTMLDivElement;
  private car: HTMLDivElement;
  private pct: HTMLDivElement;
  private msg: HTMLDivElement;
  private quip: HTMLDivElement;
  private tip: HTMLDivElement;
  private reels: HTMLDivElement[] = [];
  private chipsEl: HTMLSpanElement;
  private result: HTMLDivElement;
  private spinBtn: HTMLButtonElement;
  private lever: HTMLButtonElement;
  private chips = 100;
  private spinning = false;
  private timers: number[] = [];
  private gone = false;
  private reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || e.repeat) return;
    e.preventDefault();
    this.spin();
  };

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ld');
    this.root.innerHTML = `
      <div class="ld-sky"><div class="ld-sun"></div><div class="ld-cloud c1"></div><div class="ld-cloud c2"></div><div class="ld-cloud c3"></div></div>
      ${skyline()}
      <div class="ld-sea"><div class="ld-glint"></div></div>
      <div class="ld-road">${bridge()}<div class="ld-car-wrap">${CAR}</div><div class="ld-shield"><span>INTERSTATE</span><b>15</b></div></div>
      <div class="ld-top">
        <div class="logo"><div class="l1">CASINO SIMULATOR</div><div class="l2">2</div><div class="l3">JACKPOT ISLAND</div></div>
      </div>
      <div class="ld-slot" role="group" aria-label="Slot machine to play while the game loads">
        <div class="ld-slot-head"><span>LUCKY LOADER</span><span class="ld-chips">🪙 <span>100</span></span></div>
        <div class="ld-reels"><div class="ld-reel"></div><div class="ld-reel"></div><div class="ld-reel"></div><div class="ld-payline"></div></div>
        <div class="ld-result">Spin while you wait!</div>
        <button class="ld-spin" type="button">SPIN · ${COST}</button>
        <button class="ld-lever" type="button" aria-label="Pull the lever"><span></span></button>
      </div>
      <div class="ld-status">
        <div class="ld-pct">0%</div>
        <div class="ld-msg">Loading</div>
        <div class="ld-quip"></div>
      </div>
      <div class="ld-tip"></div>
      <div class="ld-confetti"></div>`;
    this.car = this.root.querySelector('.ld-car-wrap') as HTMLDivElement;
    this.pct = this.root.querySelector('.ld-pct') as HTMLDivElement;
    this.msg = this.root.querySelector('.ld-msg') as HTMLDivElement;
    this.quip = this.root.querySelector('.ld-quip') as HTMLDivElement;
    this.tip = this.root.querySelector('.ld-tip') as HTMLDivElement;
    this.reels = [...this.root.querySelectorAll('.ld-reel')] as HTMLDivElement[];
    this.chipsEl = this.root.querySelector('.ld-chips span') as HTMLSpanElement;
    this.result = this.root.querySelector('.ld-result') as HTMLDivElement;
    this.spinBtn = this.root.querySelector('.ld-spin') as HTMLButtonElement;
    this.lever = this.root.querySelector('.ld-lever') as HTMLButtonElement;
    for (const r of this.reels) this.setReel(r, [SYMBOLS[Math.floor(Math.random() * 4)]], 0);
    this.spinBtn.addEventListener('click', () => this.spin());
    this.lever.addEventListener('click', () => this.spin());
    window.addEventListener('keydown', this.onKey);
    let q = Math.floor(Math.random() * FUNNY.length);
    let t = Math.floor(Math.random() * TIPS.length);
    const nextQuip = () => {
      this.quip.textContent = `${FUNNY[q++ % FUNNY.length]}…`;
      this.quip.classList.remove('in');
      void this.quip.offsetWidth;
      this.quip.classList.add('in');
    };
    const nextTip = () => {
      this.tip.innerHTML = `<span>TIP</span> ${TIPS[t++ % TIPS.length]}`;
      this.tip.classList.remove('in');
      void this.tip.offsetWidth;
      this.tip.classList.add('in');
    };
    nextQuip();
    nextTip();
    this.timers.push(window.setInterval(nextQuip, 1900), window.setInterval(nextTip, 4200));
    parent.appendChild(this.root);
  }

  /** Real progress (0..1) and what's being built. */
  progress(f: number, message: string): void {
    const p = Math.max(0, Math.min(1, f));
    this.pct.textContent = `${Math.round(p * 100)}%`;
    this.msg.textContent = message;
    this.car.style.left = `${(3 + p * 84).toFixed(1)}%`;
  }

  /** The game is ready: fade out and let go of everything. */
  done(): void {
    if (this.gone) return;
    this.gone = true;
    this.progress(1, 'Welcome to Jackpot Island');
    window.removeEventListener('keydown', this.onKey);
    for (const t of this.timers) window.clearInterval(t);
    this.timers = [];
    this.spinBtn.disabled = true;
    this.lever.disabled = true;
    this.root.classList.add('done');
    window.setTimeout(() => this.root.remove(), 800);
  }

  // ---------------------------------------------------------------- the slot machine

  /** Fill a reel's strip; the last symbol is the one that ends on the payline. */
  private setReel(reel: HTMLDivElement, strip: string[], seconds: number): void {
    reel.innerHTML = `<div class="ld-strip">${strip.map((s) => `<div>${esc(s)}</div>`).join('')}</div>`;
    const inner = reel.firstElementChild as HTMLDivElement;
    const n = strip.length;
    inner.style.transform = 'translateY(0)';
    if (n > 1 && seconds > 0) {
      void inner.offsetWidth;
      inner.style.transition = `transform ${seconds}s cubic-bezier(0.2, 0.7, 0.25, 1.06)`;
      inner.style.transform = `translateY(-${((n - 1) / n) * 100}%)`;
    } else if (n > 1) inner.style.transform = `translateY(-${((n - 1) / n) * 100}%)`;
  }

  private spin(): void {
    if (this.spinning || this.gone) return;
    if (this.chips < COST) {
      this.chips += 50;
      this.chipsEl.textContent = String(this.chips);
      this.flash('Free refill: +50 chips!', 'win');
      return;
    }
    this.spinning = true;
    this.chips -= COST;
    this.chipsEl.textContent = String(this.chips);
    this.lever.classList.remove('pull');
    void this.lever.offsetWidth;
    this.lever.classList.add('pull');
    this.result.textContent = 'Spinning…';
    this.result.className = 'ld-result';
    const out = this.reels.map(() => pick(SYMBOLS, WEIGHTS));
    const stop = this.reduced ? [0.05, 0.05, 0.05] : [0.9, 1.25, 1.6];
    this.reels.forEach((r, i) => {
      const strip = Array.from({ length: 14 + i * 4 }, () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
      strip.push(out[i]);
      this.setReel(r, strip, stop[i]);
    });
    window.setTimeout(() => this.settle(out), Math.max(...stop) * 1000 + 80);
  }

  private settle(out: string[]): void {
    this.spinning = false;
    if (this.gone) return;
    const [a, b, c] = out;
    let win = 0;
    let text = 'So close! Spin again';
    let kind = '';
    if (a === b && b === c) {
      win = a === '7️⃣' ? 100 : a === '💎' ? 60 : 30;
      text = a === '7️⃣' || a === '💎' ? `JACKPOT! +${win}` : `Three of a kind! +${win}`;
      kind = a === '7️⃣' || a === '💎' ? 'jackpot' : 'win';
    } else if (a === b || b === c || a === c) {
      win = 8;
      text = `A pair! +${win}`;
      kind = 'win';
    } else if (out.includes('🍒')) {
      win = 2;
      text = 'A cherry! +2';
      kind = 'win';
    }
    this.chips += win;
    this.chipsEl.textContent = String(this.chips);
    this.flash(text, kind);
    if (kind === 'jackpot') this.confetti();
  }

  private flash(text: string, kind: string): void {
    this.result.textContent = text;
    this.result.className = `ld-result ${kind}`;
  }

  private confetti(): void {
    if (this.reduced) return;
    const box = this.root.querySelector('.ld-confetti') as HTMLDivElement;
    const colors = ['#ffd23d', '#ff4fa3', '#3fe0ff', '#4dffa6', '#ffffff'];
    for (let i = 0; i < 60; i++) {
      const p = el('i');
      p.style.left = `${Math.random() * 100}%`;
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = `${Math.random() * 0.4}s`;
      p.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
      p.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
      box.appendChild(p);
    }
    window.setTimeout(() => (box.innerHTML = ''), 3200);
  }
}
