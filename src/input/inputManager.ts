export interface InputHandlers {
  onCapture: () => void;
  onSpecial: () => void;
  /** Quick half-turn to check behind (Q / 振向). */
  onFace: () => void;
  /** Squad orders: X follow me, C watch around me, V hold here; the touch button cycles them. */
  onSquad: (order: 'follow' | 'spread' | 'hold' | 'next') => void;
  /** B: light the enemy kings from the tower. */
  onBeacon?: () => void;
  /** 1–4 / 合図: a ping to your nation. */
  onPing?: (kind: 'king' | 'help' | 'gather' | 'danger') => void;
  /** Actions are ignored while this returns true (meeting open, game over). */
  isBlocked: () => boolean;
}

/** Character-relative intent: the camera always sits behind the character. */
export interface MoveAxes {
  /** +1 = walk forward (↑ / stick up), -1 = back away (↓ / stick down). */
  forward: number;
  /** +1 = turn right (→ / stick right), -1 = turn left (← / stick left). */
  turn: number;
}

const JOY_MAX = 40;

/** Movement intent from held keys plus the virtual joystick. */
export function axesFrom(keys: Readonly<Record<string, boolean>>, joy: { x: number; y: number }): MoveAxes {
  let forward = 0 - joy.y, turn = joy.x;
  if (keys['w'] || keys['arrowup']) forward += 1;
  if (keys['s'] || keys['arrowdown']) forward -= 1;
  if (keys['d'] || keys['arrowright']) turn += 1;
  if (keys['a'] || keys['arrowleft']) turn -= 1;
  return { forward: Math.max(-1, Math.min(1, forward)), turn: Math.max(-1, Math.min(1, turn)) };
}

/** Joystick knob offset for a pointer at (dx, dy) from the base centre, clamped to the ring. */
export function joystickVector(dx: number, dy: number): { x: number; y: number; px: number; py: number } {
  const d = Math.hypot(dx, dy);
  if (d > JOY_MAX) { dx = (dx / d) * JOY_MAX; dy = (dy / d) * JOY_MAX; }
  return { x: dx / JOY_MAX, y: dy / JOY_MAX, px: dx, py: dy };
}

/**
 * Collects keyboard and pointer (mouse / touch / pen) input. It never touches
 * game state: movement is read as axes, actions go to handlers, and camera
 * drags / wheel accumulate until the frame consumes them.
 */
export class InputManager {
  private keys: Record<string, boolean> = {};
  private joy = { x: 0, y: 0 };
  private touchDash = false;
  private lookDX = 0;
  private lookDY = 0;
  private zoom = 0;

  constructor(canvas: HTMLCanvasElement, handlers: InputHandlers) {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (handlers.isBlocked()) return;
      if (e.key === ' ') { e.preventDefault(); handlers.onCapture(); }
      if (k === 'z' && !e.repeat) handlers.onSpecial();
      if (k === 'q' && !e.repeat) handlers.onFace();
      if (k === 'b' && !e.repeat) handlers.onBeacon?.();
      if (!e.repeat && k >= '1' && k <= '4') handlers.onPing?.((['king', 'help', 'gather', 'danger'] as const)[Number(k) - 1]);
      if (!e.repeat && (k === 'x' || k === 'c' || k === 'v')) handlers.onSquad(k === 'x' ? 'follow' : k === 'c' ? 'spread' : 'hold');
      if (k.startsWith('arrow')) e.preventDefault(); // don't scroll the page
    });
    window.addEventListener('keyup', (e) => { this.keys[e.key.toLowerCase()] = false; });
    // Keys released while the window is unfocused never send keyup.
    window.addEventListener('blur', () => { this.keys = {}; this.touchDash = false; });

    const action = (fn: () => void) => () => { if (!handlers.isBlocked()) fn(); };
    byId('btnCapture').addEventListener('click', action(handlers.onCapture));
    byId('btnSpecial').addEventListener('click', action(handlers.onSpecial));
    // Touch buttons act on press so they work while another finger holds the joystick.
    this.pressButton(byId('mCap'), action(handlers.onCapture));
    this.pressButton(byId('mSpec'), action(handlers.onSpecial));
    this.pressButton(byId('mFace'), action(handlers.onFace));
    this.pressButton(byId('mSquad'), action(() => handlers.onSquad('next')));
    // 合図: a small menu on phones, buttons in the side panel on PCs.
    const menu = byId('pingMenu');
    this.pressButton(byId('mPing'), action(() => { menu.hidden = !menu.hidden; }));
    for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-ping]'))) {
      const fire = action(() => { handlers.onPing?.(b.dataset.ping as 'king' | 'help' | 'gather' | 'danger'); menu.hidden = true; });
      if (b.closest('#pingMenu')) this.pressButton(b, fire);
      else b.addEventListener('click', fire);
    }
    for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('#squadBox [data-order]'))) {
      b.addEventListener('click', action(() => handlers.onSquad(b.dataset.order as 'follow' | 'spread' | 'hold')));
    }
    this.bindDash(byId('mDash'));
    this.bindJoystick(byId('joyBase'), byId('joyStick'));
    this.bindCamera(canvas);
  }

  private pressButton(el: HTMLElement, fn: () => void): void {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
  }

  private bindDash(el: HTMLElement): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.touchDash = true;
    });
    const off = () => { this.touchDash = false; };
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
  }

  private bindJoystick(base: HTMLElement, stick: HTMLElement): void {
    let id: number | null = null;
    const move = (e: PointerEvent) => {
      const r = base.getBoundingClientRect();
      const v = joystickVector(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      stick.style.transform = `translate(${v.px}px, ${v.py}px)`;
      this.joy.x = v.x;
      this.joy.y = v.y;
    };
    const reset = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      this.joy.x = this.joy.y = 0;
      stick.style.transform = '';
    };
    base.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault();
      id = e.pointerId;
      base.setPointerCapture(e.pointerId);
      move(e);
    });
    base.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    base.addEventListener('pointerup', reset);
    base.addEventListener('pointercancel', reset);
    base.addEventListener('lostpointercapture', reset);
  }

  private bindCamera(canvas: HTMLCanvasElement): void {
    let id: number | null = null, lastX = 0, lastY = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      this.lookDX += e.clientX - lastX;
      this.lookDY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    const end = (e: PointerEvent) => { if (e.pointerId === id) id = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom += Math.sign(e.deltaY); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  moveAxes(): MoveAxes {
    return axesFrom(this.keys, this.joy);
  }

  get dash(): boolean {
    return !!this.keys['shift'] || this.touchDash;
  }

  /** Whether a key (lower-case `KeyboardEvent.key`) is held. */
  held(key: string): boolean {
    return !!this.keys[key];
  }

  /** Returns and clears the pixel drag accumulated since the last call. */
  consumeLook(): { dx: number; dy: number } {
    const out = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = this.lookDY = 0;
    return out;
  }

  /** Returns and clears accumulated wheel steps (+ = zoom out). */
  consumeZoom(): number {
    const z = this.zoom;
    this.zoom = 0;
    return z;
  }
}

function byId(id: string): HTMLElement {
  return document.getElementById(id)!;
}
