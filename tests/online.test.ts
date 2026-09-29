import { describe, expect, it } from 'vitest';
import { STEP_SEC } from '../src/core/clock';
import { createRng } from '../src/core/rng';
import { closeMeeting, openScheduledMeeting, updateMeeting } from '../src/meeting/meetingSystem';
import type { NamedRoom, RoomPeer, StartInfo } from '../src/net/online';
import { ClientLink, HostLink, parseRoomCode, seatsOf } from '../src/net/online';
import { Mirror, encodeSnapshot, fitSnapshot } from '../src/net/snapshot';
import type { HumanSeat } from '../src/sim/state';
import { createGameState, drainEvents, seatHumans } from '../src/sim/state';
import { ROSTERS } from '../src/config/roles';
import { NATION_IDS } from '../src/config/nations';
import { teleport } from '../src/sim/entity';
import { stepSimulation } from '../src/sim/step';
import { sendToJail } from '../src/sim/systems/jail';
import { SITES } from '../src/config/map';
import { contribution, ranking } from '../src/sim/contrib';

const SEATS: HumanSeat[] = [
  { nation: 'sun', role: 'soldier' },
  { nation: 'moon', role: 'sniper' },
  { nation: 'sun', role: 'soldier' },
];

const match = (me: number, seed = 7, size: 6 | 10 | 15 = 10) => createGameState('sun', 'soldier', createRng(seed), size, { seats: SEATS, me });

/** A stand-in for the page's room: every device's presence, as the room shows it. */
class FakeRoom implements NamedRoom {
  presences = new Map<string, Record<string, unknown>>();
  constructor(private me: string) {}
  async presence(patch: Record<string, unknown>): Promise<void> {
    this.presences.set(this.me, { ...(this.presences.get(this.me) ?? {}), ...patch });
  }
  peers(): RoomPeer[] {
    return [...this.presences].map(([peer, presence]) => ({ peer, presence, isMe: peer === this.me, sameTab: peer === this.me, kind: 'viewer' }));
  }
  onPeers(): () => void { return () => {}; }
  connected(): boolean { return true; }
  async leave(): Promise<void> {}
  /** Another device's view of the same room. */
  as(peer: string): FakeRoom {
    const r = new FakeRoom(peer);
    r.presences = this.presences;
    return r;
  }
}

const INFO: StartInfo = { seed: 7, size: 10, seats: [['h', 'sun', 'soldier', 'ホスト'], ['a', 'moon', 'sniper', 'あ'], ['b', 'sun', 'soldier', 'び']] };

describe('online matches', () => {
  it('seats people deterministically: wanted role first, else another role in their nation', () => {
    const slots = NATION_IDS.flatMap((nation) => ROSTERS[6].map((role) => ({ nation, role })));
    const ids = seatHumans(slots, [{ nation: 'sun', role: 'king' }, { nation: 'sun', role: 'king' }, { nation: 'star', role: 'keyholder' }]);
    expect(slots[ids[0]]).toEqual({ nation: 'sun', role: 'king' });
    expect(slots[ids[1]].nation).toBe('sun');
    expect(slots[ids[1]].role).not.toBe('king');
    expect(slots[ids[2]]).toEqual({ nation: 'star', role: 'keyholder' });
    expect(new Set(ids).size).toBe(3);
  });

  it('every device builds the same match; each controls its own character', () => {
    const host = match(0), friend = match(1);
    expect(host.humans).toEqual(friend.humans);
    expect(host.humans.length).toBe(3);
    expect(host.entities.map((e) => [e.x, e.z, e.role, e.decoy])).toEqual(friend.entities.map((e) => [e.x, e.z, e.role, e.decoy]));
    expect(host.player.id).toBe(host.humans[0]);
    expect(friend.player.id).toBe(host.humans[1]);
    expect(host.entities.filter((e) => e.remote).map((e) => e.id)).toEqual([host.humans[1], host.humans[2]].sort((a, b) => a - b));
    expect(friend.player.nation).toBe('moon');
    expect(friend.player.role).toBe('sniper');
    expect(seatsOf(INFO)).toEqual(SEATS);
  });

  it('parses room codes', () => {
    expect(parseRoomCode(' AB3-k9 ')).toBe('ab3k9');
    expect(parseRoomCode('x')).toBeNull();
  });

  it('a snapshot mirrors the match on a friend\'s device (without moving their own character)', () => {
    const host = match(0), friend = match(1);
    host.nextMeetingAt = Infinity;
    for (let i = 0; i < 120; i++) stepSimulation(host, STEP_SEC);
    const victim = host.entities.find((e) => e.nation === 'star' && e.role === 'soldier')!;
    sendToJail(host, victim, 'sun', null);
    host.radar.moon = host.time + 5000;
    const events = drainEvents(host).map((e, i) => ({ s: i + 1, e }));
    const me = friend.player;
    me.x += 40; // walked here on the device
    const myPos = { x: me.x, z: me.z };
    const mirror = new Mirror();
    const got = mirror.apply(friend, encodeSnapshot(host, events), 0)!;
    expect(got.events.map((e) => e.type)).toContain('JAILED');
    expect(friend.time).toBe(Math.round(host.time));
    expect(friend.radar.moon).toBeCloseTo(host.radar.moon, -1);
    for (const e of friend.entities) {
      const h = host.entities[e.id];
      expect(e.alive).toBe(h.alive);
      expect(e.jailed).toBe(h.jailed);
      if (e.isPlayer) continue;
      expect(Math.abs(e.x - h.x)).toBeLessThan(1);
      expect(Math.abs(e.z - h.z)).toBeLessThan(1);
      expect(e.ai.leaderId).toBe(h.ai.leaderId);
    }
    expect({ x: me.x, z: me.z }).toEqual(myPos);
    // The same events are not delivered twice.
    expect(mirror.apply(friend, encodeSnapshot(host, events), 100)!.events).toEqual([]);
  });

  it('the host teleporting a friend\'s character (jail) resets it on their device', () => {
    const host = match(0), friend = match(1);
    const id = host.humans[1];
    sendToJail(host, host.entities[id], 'sun', null);
    const got = new Mirror().apply(friend, encodeSnapshot(host, []), 0)!;
    expect(got.teleported).toBe(true);
    expect(friend.player.jailed).toBe(true);
    expect(Math.abs(friend.player.x - host.entities[id].x)).toBeLessThan(1);
  });

  it('the host moves friends\' characters from their input and runs their buttons', () => {
    const host = match(0), friend = match(1);
    host.nextMeetingAt = Infinity;
    const room = new FakeRoom('h');
    const link = new HostLink(room, INFO, host.humans);
    const friendLink = new ClientLink(room.as('a'), 'h', 0);
    const me = friend.player;
    teleport(me, SITES.open.x, SITES.open.z); // tp count goes up on the friend's side only…
    const hostMe = host.entities[me.id];
    teleport(hostMe, SITES.open.x, SITES.open.z); // …and on the host's (as a jail/release would)
    me.dirX = 1; me.dirZ = 0;
    const target = { x: me.x + 60, z: me.z };
    // Walk there over a second, as the device would report it.
    for (let i = 1; i <= 60; i++) {
      me.x = SITES.open.x + i;
      friendLink.send(friend, i * 100);
      link.ingest(host, i * 100);
      stepSimulation(host, STEP_SEC);
    }
    expect(Math.abs(hostMe.x - target.x)).toBeLessThan(2);
    expect(hostMe.dirX).toBeCloseTo(1, 2);
    // A capture press reaches the simulation once.
    friendLink.command('squad', 'hold');
    friendLink.send(friend, 10_000);
    link.ingest(host, 10_000);
    link.ingest(host, 10_050);
    stepSimulation(host, STEP_SEC);
    expect(host.humanOrders[me.id]?.order).toBe('hold');
    const orders = drainEvents(host).filter((e) => e.type === 'SQUAD_ORDER');
    expect(orders).toEqual([{ type: 'SQUAD_ORDER', leaderId: me.id, order: 'hold' }]);
  });

  it('a reported position can\'t outrun a dash', () => {
    const host = match(0);
    const id = host.humans[1], e = host.entities[id];
    const x0 = e.x;
    host.remotePose[id] = { x: e.x + 5000, y: e.y, z: e.z, dirX: 1, dirZ: 0, speed: 500, dash: true, tp: e.tp & 15 };
    stepSimulation(host, STEP_SEC);
    expect(e.x - x0).toBeLessThan(15);
  });

  it('someone who leaves is handed to the AI', () => {
    const host = match(0);
    const room = new FakeRoom('h');
    room.presences.set('a', {});
    room.presences.set('b', {});
    const link = new HostLink(room, INFO, host.humans);
    expect(link.ingest(host, 0)).toEqual([]);
    room.presences.delete('b');
    expect(link.ingest(host, 1000)).toEqual([]);
    expect(link.ingest(host, 6000)).toEqual([host.humans[2]]);
  });

  it('half-time meeting: each nation with people gets its own view; votes decide, and it ends once everyone is done', () => {
    const host = match(0);
    openScheduledMeeting(host);
    const m = host.meeting!;
    expect(m.others.moon).toBeDefined();
    expect(m.others.star).toBeUndefined();
    expect(host.teamFocus.star).not.toBeNull(); // AI-only nation decided by itself
    const moonId = host.humans[1], sunFriend = host.humans[2];
    const room = new FakeRoom('h');
    const link = new HostLink(room, INFO, host.humans);
    room.presences.set('a', { g: { v: [host.meetingsHeld, 0], r: host.meetingsHeld } });
    room.presences.set('b', { g: { v: [host.meetingsHeld, 1], r: host.meetingsHeld } });
    link.ingest(host, 0);
    expect(m.votes[moonId]).toBe(0);
    expect(m.votes[sunFriend]).toBe(1);
    updateMeeting(host, 100);
    expect(host.meeting).not.toBeNull(); // the host is not done yet
    m.ready.push(host.player.id);
    updateMeeting(host, 100);
    expect(host.meeting).toBeNull();
    expect(host.teamFocus.moon).toMatchObject({ x: m.others.moon!.zones[0].x, z: m.others.moon!.zones[0].z });
    expect(host.teamFocus.sun).toMatchObject({ x: m.zones[1].x, z: m.zones[1].z });
  });

  it('snapshots stay within the room\'s presence budget (biggest match, meeting open)', () => {
    const seats: HumanSeat[] = Array.from({ length: 9 }, (_, i) => ({ nation: NATION_IDS[i % 3], role: 'soldier' }));
    const host = createGameState('sun', 'soldier', createRng(3), 15, { seats, me: 0 });
    for (let i = 0; i < 60; i++) stepSimulation(host, STEP_SEC);
    openScheduledMeeting(host);
    const events = Array.from({ length: 16 }, (_, i) => ({ s: i, e: { type: 'EVIDENCE' as const, entityId: 1, text: '不自然に同じ場所を行き来している様子だった' } }));
    const snap = fitSnapshot(encodeSnapshot(host, events), 3900, 300);
    expect(new TextEncoder().encode(JSON.stringify(snap)).length + 300).toBeLessThanOrEqual(3900);
    expect(snap.e.every((c) => c.length <= 1000)).toBe(true);
    expect(snap.m?.n.moon?.l.length).toBeGreaterThan(2);
    const friend = createGameState('sun', 'soldier', createRng(3), 15, { seats, me: 1 });
    new Mirror().apply(friend, snap, 0);
    expect(friend.meeting?.kind).toBe('scheduled');
    closeMeeting(host);
  });

  it('the result (contribution and ranking) reaches friends the same as the host counted it, and fits', () => {
    const host = match(0), friend = match(1);
    host.nextMeetingAt = Infinity;
    for (let i = 0; i < 240; i++) stepSimulation(host, STEP_SEC);
    host.contrib.table[3].cap = 4;
    host.contrib.table[friend.player.id].res = 2;
    host.over = true;
    host.winner = 'moon';
    const snap = fitSnapshot(encodeSnapshot(host, []), 3900);
    expect(new TextEncoder().encode(JSON.stringify(snap)).length).toBeLessThanOrEqual(3900);
    expect(snap.ct).toBeDefined();
    new Mirror().apply(friend, snap, 0);
    expect(ranking(friend).map((r) => [r.id, r.total, r.rank])).toEqual(ranking(host).map((r) => [r.id, r.total, r.rank]));
    // The friend's own breakdown matches too.
    expect(contribution(friend, friend.player).total).toBe(contribution(host, host.entities[friend.player.id]).total);
  });
});
