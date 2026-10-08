import { el, esc, money } from './dom';

export interface Objective {
  text: string;
  /** e.g. "2/5" or "$1,200 / $5,000". */
  progress?: string;
  done?: boolean;
}

/**
 * The on-screen HUD: wallet, clock, objectives, the "use" prompt, toasts, the cutscene
 * dialogue box and big centred banners. Styled after battle-royale HUDs: chunky, outlined
 * lettering on slanted panels.
 */
export class Hud {
  readonly root: HTMLDivElement;
  private moneyEl: HTMLDivElement;
  private clockEl: HTMLDivElement;
  private objEl: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private dialogEl: HTMLDivElement;
  private bannerEl: HTMLDivElement;
  private crossEl: HTMLDivElement;
  private shownMoney = 0;
  private targetMoney = 0;
  onPromptTap: (() => void) | null = null;
  private dialogResolve: (() => void) | null = null;
  private typing: { text: string; shown: number; el: HTMLElement } | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud');
    parent.appendChild(this.root);
    const tl = el('div', 'hud-tl');
    this.moneyEl = el('div', 'hud-money', '<span class="chip"></span><span class="v">$0</span>');
    this.clockEl = el('div', 'hud-clock', 'DAY 1 · 10:00');
    this.objEl = el('div', 'hud-obj');
    tl.append(this.moneyEl, this.clockEl, this.objEl);
    this.promptEl = el('div', 'hud-prompt');
    this.promptEl.addEventListener('click', () => this.onPromptTap?.());
    this.toastEl = el('div', 'hud-toasts');
    this.dialogEl = el('div', 'hud-dialog');
    this.dialogEl.addEventListener('click', () => this.advanceDialog());
    this.bannerEl = el('div', 'hud-banner');
    this.crossEl = el('div', 'hud-cross');
    this.root.append(tl, this.promptEl, this.toastEl, this.dialogEl, this.bannerEl, this.crossEl);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  /** Hide everything but dialogue (for cutscenes and seated gambling). */
  setMinimal(v: boolean): void {
    this.root.classList.toggle('minimal', v);
  }

  setMoney(n: number, instant = false): void {
    this.targetMoney = n;
    if (!instant) return;
    this.shownMoney = n;
    (this.moneyEl.querySelector('.v') as HTMLElement).textContent = money(n);
  }

  setClock(day: number, hours: number): void {
    const h = Math.floor(hours) % 24;
    const m = Math.floor((hours % 1) * 60);
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    this.clockEl.textContent = `DAY ${day} · ${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  setObjectives(title: string, list: Objective[]): void {
    if (!list.length) {
      this.objEl.innerHTML = '';
      return;
    }
    this.objEl.innerHTML = `<div class="t">${esc(title)}</div>` + list.map((o) => `<div class="o ${o.done ? 'done' : ''}"><span class="box"></span><span class="txt">${esc(o.text)}</span>${o.progress ? `<span class="p">${esc(o.progress)}</span>` : ''}</div>`).join('');
  }

  setPrompt(label: string | null, sub = '', key = 'E'): void {
    if (!label) {
      this.promptEl.classList.remove('show');
      return;
    }
    this.promptEl.innerHTML = `<span class="key">${esc(key)}</span><span class="lbl">${esc(label)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}`;
    this.promptEl.classList.add('show');
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' | 'money' = 'info', ms = 3200): void {
    const t = el('div', `toast ${kind}`, esc(text));
    this.toastEl.appendChild(t);
    while (this.toastEl.children.length > 4) this.toastEl.firstChild?.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 500);
  }

  /** A big centred banner ("CHAPTER 1", "JACKPOT!"). */
  banner(title: string, sub = '', ms = 3200, cls = ''): void {
    this.bannerEl.className = `hud-banner show ${cls}`;
    this.bannerEl.innerHTML = `<div class="b1">${esc(title)}</div>${sub ? `<div class="b2">${esc(sub)}</div>` : ''}`;
    clearTimeout((this.bannerEl as unknown as { _t?: number })._t);
    (this.bannerEl as unknown as { _t?: number })._t = window.setTimeout(() => this.bannerEl.classList.remove('show'), ms);
  }

  setCrosshair(v: boolean): void {
    this.crossEl.style.display = v ? 'block' : 'none';
  }

  /** Show a line of dialogue and wait for it to be read (click, E, Space or Enter). */
  say(speaker: string, text: string, color = '#ffd23d', auto = 0): Promise<void> {
    this.dialogEl.innerHTML = `<div class="who" style="--c:${color}">${esc(speaker)}</div><div class="line"></div><div class="next">▼</div>`;
    this.dialogEl.classList.add('show');
    const line = this.dialogEl.querySelector('.line') as HTMLElement;
    this.typing = { text, shown: 0, el: line };
    return new Promise((res) => {
      this.dialogResolve = res;
      if (auto > 0) setTimeout(() => this.dialogResolve === res && this.advanceDialog(true), auto);
    });
  }

  closeDialog(): void {
    this.dialogEl.classList.remove('show');
    this.typing = null;
  }

  get dialogOpen(): boolean {
    return this.dialogEl.classList.contains('show');
  }

  advanceDialog(force = false): void {
    if (this.typing && this.typing.shown < this.typing.text.length && !force) {
      this.typing.shown = this.typing.text.length;
      this.typing.el.textContent = this.typing.text;
      return;
    }
    const r = this.dialogResolve;
    this.dialogResolve = null;
    this.typing = null;
    if (r) r();
  }

  update(dt: number): void {
    if (this.shownMoney !== this.targetMoney) {
      const d = this.targetMoney - this.shownMoney;
      this.shownMoney = Math.abs(d) < 1 ? this.targetMoney : this.shownMoney + d * Math.min(1, dt * 8);
      const v = this.moneyEl.querySelector('.v') as HTMLElement;
      v.textContent = money(this.shownMoney);
      this.moneyEl.classList.toggle('up', d > 0);
      this.moneyEl.classList.toggle('down', d < 0);
    }
    if (this.typing && this.typing.shown < this.typing.text.length) {
      this.typing.shown = Math.min(this.typing.text.length, this.typing.shown + dt * 55);
      this.typing.el.textContent = this.typing.text.slice(0, Math.floor(this.typing.shown));
    }
  }
}
