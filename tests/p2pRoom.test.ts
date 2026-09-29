import { describe, expect, it } from 'vitest';
import type { Wire } from '../src/net/p2pRoom';
import { P2PRoom } from '../src/net/p2pRoom';
import type { RoomApi } from '../src/net/online';
import { Lobby } from '../src/net/online';

/** An in-memory stand-in for the WebRTC mesh: every browser reaches every other one. */
class Hub {
  wires = new Map<string, { msg: (d: unknown, from: string) => void; join: (p: string) => void; leave: (p: string) => void }>();
  connect(id: string): Wire {
    const h = { msg: (_d: unknown, _f: string) => {}, join: (_p: string) => {}, leave: (_p: string) => {} };
    const wire: Wire = {
      selfId: id,
      send: (data, to) => {
        const copy = JSON.parse(JSON.stringify(data));
        queueMicrotask(() => { for (const [pid, w] of this.wires) if (pid !== id && (!to || to === pid)) w.msg(copy, id); });
      },
      onMessage: (f) => { h.msg = f; },
      onJoin: (f) => { h.join = f; },
      onLeave: (f) => { h.leave = f; },
      leave: async () => { this.wires.delete(id); for (const w of this.wires.values()) w.leave(id); },
    };
    // Tell both sides about each other (after the room has hooked in).
    queueMicrotask(() => {
      for (const [pid, w] of this.wires) { w.join(id); h.join(pid); }
      this.wires.set(id, h);
    });
    return wire;
  }
  api(id: string): RoomApi {
    return { join: async () => new P2PRoom(this.connect(id)) };
  }
}

const settle = () => new Promise((r) => setTimeout(r, 5));

describe('browser-to-browser rooms (WebRTC stand-in)', () => {
  it('everyone sees everyone\'s presence, including what was set before they arrived', async () => {
    const hub = new Hub();
    const a = new P2PRoom(hub.connect('a'));
    await a.presence({ n: 'ホスト', h: 1 });
    await settle();
    const b = new P2PRoom(hub.connect('b'));
    await settle();
    expect(b.peers().find((p) => p.peer === 'a')?.presence).toEqual({ n: 'ホスト', h: 1 });
    await b.presence({ n: 'ともだち' });
    await b.presence({ g: { x: 1 } });
    await settle();
    expect(a.peers().find((p) => p.peer === 'b')?.presence).toEqual({ n: 'ともだち', g: { x: 1 } });
    expect(a.peers().find((p) => p.sameTab)?.peer).toBe('a');
  });

  it('someone leaving disappears from the room; bad messages are ignored', async () => {
    const hub = new Hub();
    const a = new P2PRoom(hub.connect('a'));
    const b = new P2PRoom(hub.connect('b'));
    await settle();
    let calls = 0;
    a.onPeers(() => calls++);
    hub.wires.get('a')!.msg('not an object', 'b');
    expect(a.peers().find((p) => p.peer === 'b')?.presence).toEqual({});
    await b.leave();
    await settle();
    expect(a.peers().map((p) => p.peer)).toEqual(['a']);
    expect(calls).toBeGreaterThan(0);
  });

  it('a lobby works over it: members, host, and the start reaches the friend', async () => {
    const hub = new Hub();
    const host = await Lobby.open(hub.api('h'), 'abc12', true);
    const friend = await Lobby.open(hub.api('f'), 'abc12', false);
    await settle();
    host.setMe('ホスト', 'sun', 'king');
    friend.setMe('ともだち', 'moon', 'sniper');
    await settle();
    expect(host.members().map((m) => m.nick)).toEqual(['ホスト', 'ともだち']);
    expect(friend.host()?.peer).toBe('h');
    const info = host.start(10, { nick: 'ホスト', nation: 'sun', role: 'king' });
    await settle();
    expect(friend.startInfo()).toEqual(info);
    expect(info.seats.map((s) => s[0])).toEqual(['h', 'f']);
  });
});
