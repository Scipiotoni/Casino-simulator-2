import type { Game } from '../game/game';
import type { ChatLine } from '../net/multiplayer';
import { el } from './dom';
import { audio } from '../core/audio';

/**
 * The chat, the way a block-building game does it: lines appear bottom left as
 * "<Name> message" and fade after a few seconds; T (or Enter) opens the input, "/" starts a
 * command (/help, /players), Enter sends, Esc closes. It's the only talking in the game.
 */
export class Chat {
  readonly root: HTMLDivElement;
  private log: HTMLDivElement;
  private bar: HTMLDivElement;
  private input: HTMLInputElement;
  open = false;
  private warned = false;

  constructor(private game: Game, parent: HTMLElement) {
    this.root = el('div', 'mc-chat');
    this.log = el('div', 'mc-log');
    this.log.setAttribute('role', 'log');
    this.log.setAttribute('aria-live', 'polite');
    this.bar = el('div', 'mc-bar');
    this.input = el('input', 'mc-input') as HTMLInputElement;
    this.input.type = 'text';
    this.input.maxLength = 120;
    this.input.id = 'chat-input';
    this.input.setAttribute('aria-label', 'Chat message');
    this.input.autocomplete = 'off';
    this.bar.appendChild(this.input);
    this.root.append(this.log, this.bar);
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    parent.appendChild(this.root);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        this.send(this.input.value);
        this.close();
      } else if (e.key === 'Escape') this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (this.open || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (game.mode !== 'play' || game.hud.dialogOpen) return;
      if (e.code === 'KeyT' || e.code === 'Enter' || e.code === 'Slash') {
        e.preventDefault();
        this.show(e.code === 'Slash' ? '/' : '');
      }
    });
    game.mp.onLine = (l) => this.add(l);
  }

  private add(l: ChatLine): void {
    const line = el('div', `mc-line${l.system ? ' sys' : ''}${l.me ? ' me' : ''}`);
    if (l.system) line.textContent = l.text;
    else {
      const who = el('span', 'mc-name');
      who.textContent = `<${l.from}> `;
      const text = el('span');
      text.textContent = l.text;
      line.append(who, text);
    }
    this.log.appendChild(line);
    while (this.log.children.length > 60) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
    window.setTimeout(() => line.classList.add('old'), 10000);
    if (!l.me && !l.system) audio.play('blip', { volume: 0.35 });
  }

  show(prefill = ''): void {
    const g = this.game;
    this.open = true;
    this.root.classList.add('open');
    g.input.exitLock();
    g.input.wantLock = false;
    this.input.value = prefill;
    this.log.scrollTop = this.log.scrollHeight;
    window.setTimeout(() => {
      this.input.focus();
      this.input.setSelectionRange(prefill.length, prefill.length);
    }, 0);
  }

  close(): void {
    this.open = false;
    this.root.classList.remove('open');
    this.input.blur();
    this.input.value = '';
    if (this.game.mode === 'play') this.game.input.wantLock = true;
    this.game.input.suppressClicks(200);
  }

  private send(raw: string): void {
    const mp = this.game.mp;
    const text = raw.trim();
    if (!text) return;
    if (text.startsWith('/')) {
      const [cmd] = text.slice(1).split(/\s+/);
      switch (cmd.toLowerCase()) {
        case 'help':
          mp.system('Commands: /help, /players. Press T to chat, Esc to close.');
          break;
        case 'players':
        case 'list': {
          const names = [this.game.playerName, ...mp.names()];
          mp.system(`${names.length} on the island: ${names.join(', ')}`);
          break;
        }
        default:
          mp.system(`Unknown command: /${cmd}. Try /help`);
      }
      return;
    }
    mp.say(text);
    if (!mp.connected && !this.warned) {
      this.warned = true;
      mp.system('You are offline right now: nobody else can see your messages.');
    }
  }
}
