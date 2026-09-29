/**
 * Background music, generated live with Web Audio (no files): a miyako-bushi scale
 * (D E♭ G A B♭), koto-like plucks, a low drone, a breathy flute and taiko drums.
 * `setTension(0…1)` follows the match: calm searching → enemies near → a king taken
 * or the last minute. Stingers: a gong for an execution, a chime for a rescue.
 */

const SCALE = [0, 1, 5, 7, 8]; // semitones above D
const ROOT = 146.83; // D3
const note = (degree: number, octave = 0) => {
  const d = ((degree % 5) + 5) % 5, o = Math.floor(degree / 5) + octave;
  return ROOT * Math.pow(2, (SCALE[d] + 12 * o) / 12);
};

export class Music {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private drone: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  private timer: number | null = null;
  private nextBeat = 0;
  private beat = 0;
  private tension = 0;
  private melodyPos = 3;
  private noise: AudioBuffer | null = null;
  muted = false;

  /** Starts on a user gesture (browsers keep audio off until then). */
  start(): void {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch { return; }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Drone: root and fifth, slowly beating.
    const g = ctx.createGain();
    g.gain.value = 0.035;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    g.connect(lp);
    lp.connect(this.master);
    const osc = [ROOT / 2, ROOT / 2 * 1.498, ROOT / 2 * 1.003].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(g);
      o.start();
      return o;
    });
    this.drone = { osc, gain: g };
    this.nextBeat = ctx.currentTime + 0.2;
    this.timer = window.setInterval(() => this.schedule(), 80);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.2);
  }

  /** 0 calm … 1 desperate; eased so the music does not lurch. */
  setTension(t: number): void {
    this.tension += (Math.max(0, Math.min(1, t)) - this.tension) * 0.02;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const bpm = 76 + 52 * this.tension;
    const step = 60 / bpm / 2; // eighth notes
    while (this.nextBeat < ctx.currentTime + 0.25) {
      this.playStep(this.nextBeat, this.beat, step);
      this.nextBeat += step;
      this.beat = (this.beat + 1) % 32;
    }
    if (this.drone) this.drone.gain.gain.setTargetAtTime(0.03 + 0.03 * this.tension, ctx.currentTime, 0.5);
  }

  private playStep(t: number, b: number, step: number): void {
    const T = this.tension, r = Math.random();
    // Taiko: sparse when calm, driving when tense.
    const pattern = T > 0.66 ? [1, 0, 0, 1, 1, 0, 1, 0] : T > 0.33 ? [1, 0, 0, 0, 1, 0, 0, 1] : [1, 0, 0, 0, 0, 0, 0, 0];
    if (pattern[b % 8] && (T > 0.15 || b % 16 === 0)) this.taiko(t, b % 8 === 0 ? 1 : 0.6);
    if (T > 0.5 && b % 2 === 1 && r < T * 0.5) this.rim(t);
    // Koto: a wandering line on the scale, denser with tension.
    const density = 0.18 + 0.4 * T;
    if (r < density) {
      this.melodyPos += Math.round((Math.random() - 0.5) * 3);
      this.melodyPos = Math.max(0, Math.min(10, this.melodyPos));
      this.koto(t, note(this.melodyPos, 1), 0.9 + Math.random() * 0.3);
      if (Math.random() < 0.25) this.koto(t + step * 0.5, note(this.melodyPos + 2, 1), 0.5);
    }
    // Flute: a long breathy note now and then when it is calm.
    if (b % 16 === 0 && Math.random() < 0.45 - 0.3 * T) this.flute(t, note(3 + Math.floor(Math.random() * 5), 1), step * 8);
  }

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master!);
    return g;
  }

  private koto(t: number, f: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), f2 = ctx.createBiquadFilter();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f * 1.01, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.05); // the pluck bends in
    f2.type = 'lowpass';
    f2.frequency.setValueAtTime(3200, t);
    f2.frequency.exponentialRampToValueAtTime(600, t + 0.8);
    o.connect(f2);
    f2.connect(this.env(t, 0.09 * vol, 0.005, 1.1));
    o.start(t);
    o.stop(t + 1.2);
  }

  private flute(t: number, f: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), vib = ctx.createOscillator(), vg = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    vib.frequency.value = 5;
    vg.gain.value = f * 0.008;
    vib.connect(vg);
    vg.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.4);
    g.gain.setValueAtTime(0.045, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master!);
    o.connect(g);
    // Breath.
    const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = this.noise;
    bp.type = 'bandpass';
    bp.frequency.value = f * 2;
    bp.Q.value = 3;
    ng.gain.value = 0.25;
    n.connect(bp);
    bp.connect(ng);
    ng.connect(g);
    o.start(t); vib.start(t); n.start(t);
    o.stop(t + dur); vib.stop(t + dur); n.stop(t + dur);
  }

  private taiko(t: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.25);
    o.connect(this.env(t, 0.32 * vol, 0.004, 0.45));
    o.start(t);
    o.stop(t + 0.5);
    const n = ctx.createBufferSource(), lp = ctx.createBiquadFilter();
    n.buffer = this.noise;
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    n.connect(lp);
    lp.connect(this.env(t, 0.12 * vol, 0.002, 0.12));
    n.start(t);
    n.stop(t + 0.15);
  }

  private rim(t: number): void {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource(), hp = ctx.createBiquadFilter();
    n.buffer = this.noise;
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    n.connect(hp);
    hp.connect(this.env(t, 0.05, 0.001, 0.05));
    n.start(t);
    n.stop(t + 0.06);
  }

  /** A deep gong (an execution). */
  gong(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    for (const [f, v] of [[73, 0.2], [110.5, 0.1], [164, 0.06], [233, 0.04]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(this.env(t, v, 0.01, 3.2));
      o.start(t);
      o.stop(t + 3.3);
    }
  }

  /** A bright chime (a rescue). */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    [0, 2, 4].forEach((deg, i) => this.koto(t + i * 0.09, note(deg, 2), 1.2));
  }
}
