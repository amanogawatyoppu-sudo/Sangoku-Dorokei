import type { EventBus } from '../core/events';
import type { GameEvent } from '../sim/events';
import type { GameState } from '../sim/state';
import { entityById } from '../sim/state';

let actx: AudioContext | null = null;

export function beep(freq: number, dur: number): void {
  try {
    if (!actx) actx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = freq;
    o.type = 'sine';
    o.connect(g);
    g.connect(actx.destination);
    g.gain.setValueAtTime(0.16, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
    o.start();
    o.stop(actx.currentTime + dur);
  } catch {
    // Audio is optional.
  }
}

/** Plays v6's sound cues in response to simulation events. */
export function bindSfx(bus: EventBus<GameEvent>, state: GameState): void {
  bus.on('CAPTURE', (ev) => { if (entityById(state, ev.attackerId)?.isPlayer) beep(300, 0.12); });
  bus.on('KING_CAPTURED', () => { beep(180, 0.3); setTimeout(() => beep(140, 0.3), 160); });
  bus.on('KING_RESCUED', () => { beep(760, 0.25); setTimeout(() => beep(900, 0.2), 150); });
  bus.on('TOWER_CAPTURED', () => beep(600, 0.2));
  bus.on('FOOTSTEP', () => beep(180, 0.06));
}
