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

/** A rifle shot: a short burst of filtered noise with a sharp decay (quieter when far away). */
export function gunshot(volume = 1): void {
  try {
    if (!actx) actx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const len = Math.floor(actx.sampleRate * 0.35);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (actx.sampleRate * 0.045));
    const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    src.buffer = buf;
    f.type = 'lowpass';
    f.frequency.value = 2400 * Math.max(0.3, volume);
    g.gain.value = 0.5 * volume;
    src.connect(f);
    f.connect(g);
    g.connect(actx.destination);
    src.start();
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
  bus.on('ABILITY', (ev) => {
    if (ev.result !== 'sniper_stun') return;
    const s = entityById(state, ev.entityId), p = state.player;
    if (!s) return;
    const d = Math.hypot(s.x - p.x, s.z - p.z);
    gunshot(Math.max(0.12, 1 - d / 2500));
  });
  bus.on('MEETING_SOON', () => { beep(520, 0.12); setTimeout(() => beep(520, 0.12), 220); });
  bus.on('MEETING_OPENED', (ev) => { if (ev.kind === 'scheduled') beep(660, 0.25); });
}
