import { describe, expect, it } from 'vitest';
import { teleport } from '../src/sim/entity';
import { contribTick, contribution, ranking, titleFor } from '../src/sim/contrib';
import { attemptCapture } from '../src/sim/systems/capture';
import { sendToJail } from '../src/sim/systems/jail';
import { find, freezeOthers, newGame, SPOT } from './helpers';

const grab = (state: ReturnType<typeof newGame>, attacker: ReturnType<typeof find>, target: ReturnType<typeof find>) => {
  freezeOthers(state, [attacker]);
  teleport(target, SPOT.x, SPOT.z); target.dirX = 0; target.dirZ = 1; target.hp = 1;
  teleport(attacker, SPOT.x, SPOT.z - 20); attacker.dirX = 0; attacker.dirZ = 1;
  attacker.cd.capture = 0;
  attemptCapture(state, attacker);
  // (Events are read at the end of a simulation step.)
  contribTick(state, 0, 0);
  state.events = [];
};

describe('貢献度 (contribution)', () => {
  it('a capture is worth 100, an enemy king 500, and CPUs are scored like people', () => {
    const state = newGame('sun', 'soldier', 4, 10);
    const cpu = state.entities.find((e) => e.nation === 'sun' && e.role === 'soldier' && !e.isPlayer)!;
    const before = contribution(state, cpu).total;
    grab(state, cpu, find(state, 'moon', 'communicator'));
    const after1 = contribution(state, cpu);
    expect(after1.base.find((b) => b.label === '敵を捕獲')?.pts).toBe(100);
    grab(state, cpu, find(state, 'star', 'king'));
    // The king may dodge once; try again until caught.
    for (let i = 0; i < 10 && !find(state, 'star', 'king').jailed; i++) grab(state, cpu, find(state, 'star', 'king'));
    const c = contribution(state, cpu);
    expect(c.base.find((b) => b.label === '敵王を捕獲')?.pts).toBe(500);
    expect(c.total).toBeGreaterThan(before + 600);
  });

  it('a win adds 200 to everyone on the winning side', () => {
    const state = newGame('sun', 'soldier', 4, 6);
    const e = find(state, 'moon', 'sniper');
    const t0 = contribution(state, e).total;
    state.winner = 'moon';
    expect(contribution(state, e).total - t0).toBe(200);
  });

  it('a king does not come first just for staying alive', () => {
    const state = newGame('sun', 'soldier', 4, 10);
    state.time = 300000;
    for (const e of state.entities) state.contrib.table[e.id].survivedSec = 300;
    const hunter = state.entities.find((e) => e.nation === 'moon' && e.role === 'soldier')!;
    state.contrib.table[hunter.id].cap = 4;
    const r = ranking(state);
    const king = find(state, 'sun', 'king');
    expect(r.find((x) => x.id === king.id)!.total).toBeLessThan(r.find((x) => x.id === hunter.id)!.total);
    // Only a modest role bonus for survival (≤ 300 + escape).
    expect(contribution(state, king).total).toBeLessThanOrEqual(400);
  });

  it('ranking: highest first, equal points share a rank (1, 2, 2, 4), and a nation rank', () => {
    const state = newGame('sun', 'soldier', 4, 6);
    const [a, b, c, d] = state.entities.filter((e) => e.nation === 'moon' && e.role !== 'king');
    // Clear the kings' starting bonus so only the numbers set here differ.
    for (const k of state.entities.filter((e) => e.role === 'king')) k.alive = false;
    state.contrib.table[a.id].cap = 5;
    state.contrib.table[b.id].cap = 3;
    state.contrib.table[c.id].cap = 3;
    state.contrib.table[d.id].cap = 1;
    const r = ranking(state);
    const at = (id: number) => r.find((x) => x.id === id)!;
    expect(r[0].id).toBe(a.id);
    expect(at(a.id).rank).toBe(1);
    expect(at(b.id).rank).toBe(at(c.id).rank);
    expect(at(d.id).rank).toBe(at(b.id).rank + 2);
    expect(at(a.id).nationRank).toBe(1);
    for (let i = 1; i < r.length; i++) expect(r[i].total).toBeLessThanOrEqual(r[i - 1].total);
    // Your own place is found the same way.
    const me = at(state.player.id);
    expect(me.rank).toBeGreaterThan(0);
    expect(me.rank).toBeLessThanOrEqual(state.entities.length);
  });

  it('titles follow what someone stood out for', () => {
    const state = newGame('sun', 'soldier', 4, 6);
    const k = find(state, 'moon', 'keyholder');
    state.contrib.table[k.id].res = 3;
    expect(titleFor(state, k)).toBe('救出の達人');
    state.contrib.table[k.id].kingRes = 1;
    expect(titleFor(state, k)).toBe('王を救った英雄');
    const king = find(state, 'star', 'king');
    state.winner = 'star';
    expect(titleFor(state, king)).toBe('天下を取った王');
    sendToJail(state, king, 'sun', null);
    expect(titleFor(state, king)).not.toBe('天下を取った王');
  });
});
