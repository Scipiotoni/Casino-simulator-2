import { el, esc } from './dom';

/**
 * Modal panels (shops, the realtor, your business, settings). One at a time; Esc or the X
 * closes it. While a panel is open the game routes no movement input.
 */

export interface PanelOpts {
  title: string;
  subtitle?: string;
  wide?: boolean;
  onClose?: () => void;
  accent?: string;
}

let current: Panel | null = null;

export class Panel {
  readonly root: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly footer: HTMLDivElement;
  private closed = false;

  constructor(parent: HTMLElement, private opts: PanelOpts) {
    current?.close();
    current = this;
    this.root = el('div', 'panel-wrap');
    const box = el('div', `panel ${opts.wide ? 'wide' : ''}`);
    if (opts.accent) box.style.setProperty('--accent', opts.accent);
    const head = el('div', 'panel-head', `<div class="pt">${esc(opts.title)}</div>${opts.subtitle ? `<div class="ps">${esc(opts.subtitle)}</div>` : ''}`);
    const x = el('button', 'panel-x', '✕');
    x.addEventListener('click', () => this.close());
    head.appendChild(x);
    this.body = el('div', 'panel-body');
    this.footer = el('div', 'panel-foot');
    box.append(head, this.body, this.footer);
    this.root.appendChild(box);
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    parent.appendChild(this.root);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.root.remove();
    if (current === this) current = null;
    this.opts.onClose?.();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  static get open(): Panel | null {
    return current;
  }
}

/** A row of info: label on the left, value on the right. */
export function row(label: string, value: string): HTMLDivElement {
  return el('div', 'prow', `<span>${esc(label)}</span><b>${esc(value)}</b>`);
}

export function btn(label: string, cls: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = el('button', `pbtn ${cls}`, label);
  b.disabled = disabled;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!b.disabled) onClick();
  });
  return b;
}

/** A card in a grid (shop item, building type, lot listing). */
export function card(opts: { title: string; sub?: string; price?: string; badge?: string; color?: string; icon?: string; disabled?: boolean; selected?: boolean; onClick?: () => void }): HTMLDivElement {
  const c = el('div', `pcard ${opts.disabled ? 'off' : ''} ${opts.selected ? 'sel' : ''}`);
  if (opts.color) c.style.setProperty('--c', opts.color);
  c.innerHTML = `${opts.icon ? `<div class="ic">${opts.icon}</div>` : ''}<div class="ct">${esc(opts.title)}</div>${opts.sub ? `<div class="cs">${esc(opts.sub)}</div>` : ''}${opts.price ? `<div class="cp">${esc(opts.price)}</div>` : ''}${opts.badge ? `<div class="cb">${esc(opts.badge)}</div>` : ''}`;
  if (opts.onClick && !opts.disabled) c.addEventListener('click', (e) => {
    e.stopPropagation();
    opts.onClick!();
  });
  return c;
}
