export interface InputHandlers {
  onCapture: () => void;
  onSpecial: () => void;
  /** Actions are ignored while this returns true (v6: meeting open). */
  isBlocked: () => boolean;
}

const JOY_MAX = 40;
const JOY_REST = 26;

/**
 * Collects keyboard, mouse and touch input. It never touches game state
 * directly: movement is read as axes, actions are forwarded to handlers, and
 * camera drags accumulate as look deltas.
 */
export class InputManager {
  private keys: Record<string, boolean> = {};
  private joy = { x: 0, y: 0 };
  private touchDash = false;
  private lookDX = 0;
  private lookDY = 0;

  constructor(canvas: HTMLCanvasElement, handlers: InputHandlers) {
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
      if (handlers.isBlocked()) return;
      if (e.key === ' ') { e.preventDefault(); handlers.onCapture(); }
      if (e.key.toLowerCase() === 'e') handlers.onSpecial();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.key.toLowerCase()] = false; });

    const action = (fn: () => void) => () => { if (!handlers.isBlocked()) fn(); };
    byId('btnCapture').onclick = action(handlers.onCapture);
    byId('btnSpecial').onclick = action(handlers.onSpecial);
    byId('mCap').onclick = action(handlers.onCapture);
    byId('mSpec').onclick = action(handlers.onSpecial);

    const mDash = byId('mDash');
    const dashOn = (e: Event) => { e.preventDefault(); this.touchDash = true; };
    const dashOff = (e: Event) => { e.preventDefault(); this.touchDash = false; };
    mDash.addEventListener('touchstart', dashOn);
    mDash.addEventListener('touchend', dashOff);
    mDash.addEventListener('touchcancel', dashOff);

    this.bindJoystick();
    this.bindCameraDrag(canvas);
  }

  private bindJoystick(): void {
    const joyBase = byId('joyBase'), joyStick = byId('joyStick');
    let joyId: number | null = null;
    joyBase.addEventListener('touchstart', (e) => { joyId = e.changedTouches[0].identifier; }, { passive: true });
    joyBase.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== joyId) continue;
        const r = joyBase.getBoundingClientRect();
        let dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy);
        if (d > JOY_MAX) { dx = (dx / d) * JOY_MAX; dy = (dy / d) * JOY_MAX; }
        joyStick.style.left = JOY_REST + dx + 'px';
        joyStick.style.top = JOY_REST + dy + 'px';
        this.joy.x = dx / JOY_MAX;
        this.joy.y = dy / JOY_MAX;
      }
    }, { passive: true });
    const reset = () => {
      joyId = null;
      this.joy.x = 0;
      this.joy.y = 0;
      joyStick.style.left = JOY_REST + 'px';
      joyStick.style.top = JOY_REST + 'px';
    };
    joyBase.addEventListener('touchend', reset, { passive: true });
    joyBase.addEventListener('touchcancel', reset, { passive: true });
  }

  private bindCameraDrag(canvas: HTMLCanvasElement): void {
    let dragging = false, lastMX = 0, lastMY = 0;
    canvas.addEventListener('mousedown', (e) => { dragging = true; lastMX = e.clientX; lastMY = e.clientY; });
    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      this.lookDX += e.clientX - lastMX;
      this.lookDY += e.clientY - lastMY;
      lastMX = e.clientX;
      lastMY = e.clientY;
    });
    let camTouchId: number | null = null, lastTX = 0, lastTY = 0;
    canvas.addEventListener('touchstart', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (camTouchId === null) { camTouchId = t.identifier; lastTX = t.clientX; lastTY = t.clientY; }
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== camTouchId) continue;
        this.lookDX += t.clientX - lastTX;
        this.lookDY += t.clientY - lastTY;
        lastTX = t.clientX;
        lastTY = t.clientY;
      }
    }, { passive: true });
    canvas.addEventListener('touchend', (e) => {
      for (const t of Array.from(e.changedTouches)) if (t.identifier === camTouchId) camTouchId = null;
    }, { passive: true });
  }

  /** Camera-relative movement axes: forward (+W) and right (+D), keyboard plus joystick. */
  moveAxes(): { forward: number; right: number } {
    const k = this.keys;
    let forward = -this.joy.y, right = this.joy.x;
    if (k['w'] || k['arrowup']) forward += 1;
    if (k['s'] || k['arrowdown']) forward -= 1;
    if (k['d'] || k['arrowright']) right += 1;
    if (k['a'] || k['arrowleft']) right -= 1;
    return { forward, right };
  }

  get dash(): boolean {
    return !!this.keys['shift'] || this.touchDash;
  }

  /** Returns and clears the pixel drag accumulated since the last call. */
  consumeLook(): { dx: number; dy: number } {
    const out = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = this.lookDY = 0;
    return out;
  }
}

function byId(id: string): HTMLElement {
  return document.getElementById(id)!;
}
