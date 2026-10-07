/**
 * Keyboard, mouse (with pointer lock for free-look) and touch (virtual stick + look drag +
 * buttons). Systems read `down()` for held keys and `pressed()` for this frame's presses.
 */

export interface Click {
  x: number;
  y: number;
  button: number;
}

export class Input {
  private held = new Set<string>();
  private justPressed = new Set<string>();
  /** Mouse movement since last frame (pointer-locked or dragging). */
  lookDX = 0;
  lookDY = 0;
  wheel = 0;
  mouseX = 0;
  mouseY = 0;
  mouseDown = [false, false, false];
  clicks: Click[] = [];
  /** Mouse button presses this frame (0 left, 2 right), whatever the target. */
  private buttonsPressed = new Set<number>();
  locked = false;
  /** When false, clicks never request pointer lock (menus, seated gambling). */
  wantLock = true;
  /** Touch: virtual stick in -1..1 and whether touch controls are in use. */
  stick = { x: 0, y: 0 };
  touchMode = false;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  /** Set by on-screen touch buttons (held). */
  virtualKeys = new Set<string>();
  private suppressUntil = 0;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (this.isTyping(e)) return;
      const k = e.code;
      if (!this.held.has(k)) this.justPressed.add(k);
      this.held.add(k);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
    });
    window.addEventListener('blur', () => this.releaseAll());
    el.addEventListener('mousedown', (e) => {
      this.mouseDown[e.button] = true;
      this.buttonsPressed.add(e.button);
      if (performance.now() < this.suppressUntil) return;
      this.clicks.push({ x: e.clientX, y: e.clientY, button: e.button });
      if (this.wantLock && !this.locked && e.button === 0 && !this.touchMode) this.requestLock();
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseDown[e.button] = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (this.locked) {
        // Some browsers send a huge spike on lock; ignore those.
        if (Math.abs(e.movementX) < 400 && Math.abs(e.movementY) < 400) {
          this.lookDX += e.movementX;
          this.lookDY += e.movementY;
        }
      } else if (this.mouseDown[2] && !this.touchMode) {
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
      }
    });
    el.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
    });
    el.addEventListener('touchstart', (e) => this.onTouch(e, 'start'), { passive: false });
    el.addEventListener('touchmove', (e) => this.onTouch(e, 'move'), { passive: false });
    el.addEventListener('touchend', (e) => this.onTouch(e, 'end'), { passive: false });
    el.addEventListener('touchcancel', (e) => this.onTouch(e, 'end'), { passive: false });
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  requestLock(): void {
    try {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      /* not allowed */
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Ignore clicks briefly (e.g. right after closing a menu with a click). */
  suppressClicks(ms = 150): void {
    this.suppressUntil = performance.now() + ms;
  }

  private onTouch(e: TouchEvent, phase: 'start' | 'move' | 'end'): void {
    this.touchMode = true;
    e.preventDefault();
    const w = window.innerWidth;
    for (const t of Array.from(e.changedTouches)) {
      if (phase === 'start') {
        if (t.clientX < w * 0.4 && this.stickId === null) {
          this.stickId = t.identifier;
          this.stickOrigin = { x: t.clientX, y: t.clientY };
          this.stick.x = this.stick.y = 0;
        } else if (this.lookId === null) {
          this.lookId = t.identifier;
          this.lookLast = { x: t.clientX, y: t.clientY };
          this.clicks.push({ x: t.clientX, y: t.clientY, button: 0 });
          this.mouseX = t.clientX;
          this.mouseY = t.clientY;
        }
      } else if (phase === 'move') {
        if (t.identifier === this.stickId) {
          const dx = (t.clientX - this.stickOrigin.x) / 55;
          const dy = (t.clientY - this.stickOrigin.y) / 55;
          const l = Math.hypot(dx, dy);
          const s = l > 1 ? 1 / l : 1;
          this.stick.x = dx * s;
          this.stick.y = dy * s;
        } else if (t.identifier === this.lookId) {
          this.lookDX += (t.clientX - this.lookLast.x) * 1.6;
          this.lookDY += (t.clientY - this.lookLast.y) * 1.6;
          this.lookLast = { x: t.clientX, y: t.clientY };
          this.mouseX = t.clientX;
          this.mouseY = t.clientY;
        }
      } else {
        if (t.identifier === this.stickId) {
          this.stickId = null;
          this.stick.x = this.stick.y = 0;
        } else if (t.identifier === this.lookId) this.lookId = null;
      }
    }
  }

  get stickActive(): boolean {
    return this.stickId !== null;
  }

  get stickOriginPos(): { x: number; y: number } {
    return this.stickOrigin;
  }

  down(code: string): boolean {
    return this.held.has(code) || this.virtualKeys.has(code);
  }

  pressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  /** Simulate a key press from an on-screen button. */
  tap(code: string): void {
    this.justPressed.add(code);
  }

  buttonPressed(b: number): boolean {
    return this.buttonsPressed.has(b);
  }

  /** Movement axes from WASD / arrows / stick: x = right, y = forward. */
  moveAxes(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.stickActive) {
      x += this.stick.x;
      y -= this.stick.y;
    }
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }

  releaseAll(): void {
    this.held.clear();
    this.virtualKeys.clear();
    this.mouseDown = [false, false, false];
    this.stickId = null;
    this.stick.x = this.stick.y = 0;
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.justPressed.clear();
    this.buttonsPressed.clear();
    this.lookDX = this.lookDY = 0;
    this.wheel = 0;
    this.clicks.length = 0;
  }
}
