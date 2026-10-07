import { el, esc, money } from './dom';
import { DENOMS, chipDataUrl } from '../casino/chips';

export interface OptionButton {
  id: string;
  label: string;
  /** Keyboard hint shown on the button (the session maps the key). */
  key?: string;
  enabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}

export interface OptionsSpec {
  title: string;
  /** Show the chip rack to pick a chip value. */
  chips?: boolean;
  bet?: number;
  balance: number;
  buttons: OptionButton[];
  /** Small help line (what clicking does). */
  hint?: string;
}

/**
 * The only on-screen interface while gambling: a slim bar at the bottom with your chip
 * rack, your stake and balance, and the moves the rules allow right now. Everything else
 * (cards, chips, the wheel, results) happens on the table in front of you.
 */
export class OptionsBar {
  readonly root: HTMLDivElement;
  private chipsEl: HTMLDivElement;
  private infoEl: HTMLDivElement;
  private btnEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  selectedChip = 25;
  onButton: ((id: string) => void) | null = null;
  onChip: ((value: number) => void) | null = null;
  private chipImgs = new Map<number, string>();
  private lastKey = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'optbar');
    this.chipsEl = el('div', 'optbar-chips');
    this.infoEl = el('div', 'optbar-info');
    this.btnEl = el('div', 'optbar-btns');
    this.hintEl = el('div', 'optbar-hint');
    const row = el('div', 'optbar-row');
    row.append(this.chipsEl, this.infoEl, this.btnEl);
    this.root.append(this.hintEl, row);
    parent.appendChild(this.root);
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  private chipImg(v: number): string {
    let s = this.chipImgs.get(v);
    if (!s) {
      s = chipDataUrl(DENOMS.find((d) => d.value === v)!, 64);
      this.chipImgs.set(v, s);
    }
    return s;
  }

  show(spec: OptionsSpec): void {
    const key = JSON.stringify(spec) + this.selectedChip;
    if (key === this.lastKey && this.root.classList.contains('show')) return;
    this.lastKey = key;
    this.root.classList.add('show');
    this.hintEl.textContent = spec.hint ?? '';
    this.hintEl.style.display = spec.hint ? '' : 'none';
    if (spec.chips) {
      this.chipsEl.style.display = '';
      this.chipsEl.innerHTML = '';
      for (const d of DENOMS) {
        if (d.value > Math.max(1, spec.balance) && d.value > 25) continue;
        const b = el('button', `chipbtn ${d.value === this.selectedChip ? 'sel' : ''}`);
        b.innerHTML = `<img src="${this.chipImg(d.value)}" alt="${d.label}">`;
        b.title = `$${d.value.toLocaleString('en-US')} chip`;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectedChip = d.value;
          this.onChip?.(d.value);
          this.lastKey = '';
          this.show(spec);
        });
        this.chipsEl.appendChild(b);
      }
    } else this.chipsEl.style.display = 'none';
    this.infoEl.innerHTML = `<div class="ttl">${esc(spec.title)}</div><div class="nums"><span>BET <b>${money(spec.bet ?? 0)}</b></span><span>BALANCE <b>${money(spec.balance)}</b></span></div>`;
    this.btnEl.innerHTML = '';
    for (const o of spec.buttons) {
      const b = el('button', `optbtn ${o.primary ? 'primary' : ''} ${o.danger ? 'danger' : ''}`);
      b.innerHTML = `${o.key ? `<span class="k">${esc(o.key)}</span>` : ''}${esc(o.label)}`;
      b.disabled = o.enabled === false;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!b.disabled) this.onButton?.(o.id);
      });
      this.btnEl.appendChild(b);
    }
  }

  hide(): void {
    this.root.classList.remove('show');
    this.lastKey = '';
  }

  get visible(): boolean {
    return this.root.classList.contains('show');
  }
}
