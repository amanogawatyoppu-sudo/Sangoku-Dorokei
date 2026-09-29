import { joinRoom, selfId } from 'trystero';
import type { NamedRoom, RoomApi, RoomPeer } from './online';

/*
 * Playing with friends in any browser (GitHub Pages, a saved file): the same room
 * interface as claude.ai's `room`, carried browser-to-browser over WebRTC. Finding
 * each other goes through public Nostr relays (trystero); the match data itself
 * flows directly between the browsers. Each device sends its whole presence object
 * to everyone whenever it changes, and to a newcomer when they arrive.
 */

/** What the room needs from the network (trystero, or a fake in tests). */
export interface Wire {
  readonly selfId: string;
  send(data: Record<string, unknown>, to?: string): void;
  onMessage(f: (data: unknown, from: string) => void): void;
  onJoin(f: (peer: string) => void): void;
  onLeave(f: (peer: string) => void): void;
  leave(): Promise<void>;
}

/** Presence of each device, kept in sync over a Wire. */
export class P2PRoom implements NamedRoom {
  private mine: Record<string, unknown> = {};
  private others = new Map<string, Record<string, unknown>>();
  private handlers = new Set<(c: { peers: readonly RoomPeer[] }) => void>();
  private pending = false;
  private open = true;

  constructor(private wire: Wire) {
    wire.onJoin((peer) => {
      if (!this.others.has(peer)) this.others.set(peer, {});
      this.wire.send(this.mine, peer);
      this.changed();
    });
    wire.onLeave((peer) => {
      if (this.others.delete(peer)) this.changed();
    });
    wire.onMessage((data, from) => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      this.others.set(from, data as Record<string, unknown>);
      this.changed();
    });
  }

  presence(patch: Record<string, unknown>): Promise<void> {
    this.mine = { ...this.mine, ...patch };
    // Several patches in one frame go out as one message.
    if (!this.pending) {
      this.pending = true;
      queueMicrotask(() => {
        this.pending = false;
        if (this.open) this.wire.send(this.mine);
      });
    }
    this.changed();
    return Promise.resolve();
  }

  peers(): readonly RoomPeer[] {
    const me: RoomPeer = { peer: this.wire.selfId, isMe: true, sameTab: true, kind: 'viewer', presence: this.mine };
    return [me, ...[...this.others].map(([peer, presence]) => ({ peer, isMe: false, sameTab: false, kind: 'viewer', presence }))];
  }

  onPeers(handler: (c: { peers: readonly RoomPeer[] }) => void): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  connected(): boolean {
    return this.open;
  }

  async leave(): Promise<void> {
    this.open = false;
    this.handlers.clear();
    await this.wire.leave();
  }

  private changed(): void {
    const peers = this.peers();
    for (const h of [...this.handlers]) h({ peers });
  }
}

const APP_ID = 'sangoku-dorokei-v7';

/** Rooms over WebRTC (null if this browser cannot do WebRTC). */
export function p2pRoomApi(): RoomApi | null {
  if (typeof RTCPeerConnection === 'undefined') return null;
  return {
    async join(name: string): Promise<NamedRoom> {
      // `?relay=wss://…` swaps in your own Nostr relay(s) (comma-separated), e.g. for testing.
      const relays = new URLSearchParams(location.search).get('relay')?.split(',').filter((u) => /^wss?:\/\//.test(u));
      const room = joinRoom(relays?.length ? { appId: APP_ID, relayConfig: { urls: relays } } : { appId: APP_ID }, name);
      const action = room.makeAction('p');
      let onMsg: (data: unknown, from: string) => void = () => {};
      let onJoin: (peer: string) => void = () => {};
      let onLeave: (peer: string) => void = () => {};
      action.onMessage = (data, ctx) => onMsg(data, ctx.peerId);
      room.onPeerJoin = (peer) => onJoin(peer);
      room.onPeerLeave = (peer) => onLeave(peer);
      const wire: Wire = {
        selfId,
        send: (data, to) => { void action.send(data as never, to ? { target: to } : undefined).catch(() => {}); },
        onMessage: (f) => { onMsg = f; },
        onJoin: (f) => { onJoin = f; },
        onLeave: (f) => { onLeave = f; },
        leave: () => room.leave(),
      };
      return new P2PRoom(wire);
    },
  };
}
