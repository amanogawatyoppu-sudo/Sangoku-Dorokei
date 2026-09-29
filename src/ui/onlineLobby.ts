import { NATIONS } from '../config/nations';
import { roleName } from '../config/roles';
import type { RoomApi, StartInfo } from '../net/online';
import { Lobby, MAX_PLAYERS, newRoomCode, parseRoomCode, roomApi } from '../net/online';
import { $ } from './dom';
import type { SetupControl } from './setupScreen';

export interface OnlineStart {
  lobby: Lobby;
  info: StartInfo;
  /** This device's seat in `info.seats` (0 = host). */
  me: number;
}

const NICK_KEY = 'sangoku.nick';

function savedNick(): string {
  try { return localStorage.getItem(NICK_KEY) ?? ''; } catch { return ''; }
}
function saveNick(n: string): void {
  try { localStorage.setItem(NICK_KEY, n); } catch { /* private mode */ }
}

/**
 * "友達と遊ぶ" on the start screen: make a room (and get a code to tell friends)
 * or join one by its code; everyone picks a nation and role above, the host picks
 * the size and starts.
 */
export function initOnlineLobby(setup: SetupControl, onStart: (s: OnlineStart) => void): void {
  const box = $('netBox'), note = $('netNote'), nick = $('netNick') as HTMLInputElement, code = $('netCode') as HTMLInputElement;
  const btnHost = $('btnHost') as HTMLButtonElement, btnJoin = $('btnJoin') as HTMLButtonElement, btnLeave = $('btnLeave') as HTMLButtonElement;
  const entry = $('netEntry'), room = $('netRoom'), list = $('netMembers');
  nick.value = savedNick() || '武将' + Math.floor(100 + Math.random() * 900);
  let lobby: Lobby | null = null;
  let started = false;

  const me = () => { const n = nick.value.trim().slice(0, 12) || '名無し'; saveNick(n); return n; };
  const setBusy = (b: boolean) => { btnHost.disabled = b; btnJoin.disabled = b; };
  setBusy(true);
  note.textContent = 'オンライン機能を確認中…';

  let api: RoomApi | null = null;
  void roomApi().then((a) => {
    api = a?.api ?? null;
    if (!a) {
      box.classList.add('off');
      note.textContent = 'このブラウザはオンライン対戦（WebRTC）に対応していません。';
      return;
    }
    setBusy(false);
    note.textContent = a.kind === 'p2p'
      ? '部屋を作ってコードを友達に伝えるか、もらったコードで参加。友達は同じページ（URL）をブラウザで開くだけ。ブラウザ同士が直接つながります。'
      : '部屋を作ってコードを友達に伝えるか、もらったコードで参加。';
  });

  const render = () => {
    if (!lobby) return;
    const members = lobby.members();
    $('netCodeShow').textContent = lobby.code;
    list.replaceChildren(...members.map((m, i) => {
      const li = document.createElement('li');
      const pick = m.nation && m.role ? `${NATIONS[m.nation].name}国・${roleName(m.role)}` : '（選択中）';
      li.textContent = `${m.nick}　${pick}${m.host ? '　［ホスト］' : ''}${m.me ? '　← あなた' : ''}${i >= MAX_PLAYERS ? '　（満員：観戦不可）' : ''}`;
      return li;
    }));
    if (lobby.isHost) {
      note.textContent = members.length > 1
        ? `${members.length}人が参加中。人数を選んで「みんなで開始」。同じ国を選べば味方、別の国なら敵同士です。`
        : '友達に部屋コードを伝えて待ちましょう（ひとりでも開始できます）。';
      return;
    }
    const host = lobby.host();
    if (!host) { note.textContent = 'ホストが見つかりません。コードを確かめてください。'; return; }
    const info = lobby.startInfo();
    if (info && !started) {
      const i = info.seats.findIndex((s) => s[0] === lobby!.myPeer);
      if (i < 0) { note.textContent = 'この部屋の試合はもう始まっています。'; return; }
      started = true;
      onStart({ lobby, info, me: i });
      return;
    }
    note.textContent = 'ホストが開始するのを待っています…（国と役職は上で選べます）';
  };

  const publishMe = () => {
    if (!lobby || started) return;
    const p = setup.picks();
    lobby.setMe(me(), p.nation, p.role);
  };
  setup.onChange(publishMe);
  nick.addEventListener('input', publishMe);

  const enter = async (roomCode: string, host: boolean) => {
    if (!api) return;
    setBusy(true);
    note.textContent = host ? '部屋を作っています…' : '部屋に入っています…';
    try {
      lobby = await Lobby.open(api, roomCode, host);
    } catch {
      note.textContent = '部屋に入れませんでした。少し待ってからもう一度。';
      setBusy(false);
      return;
    }
    setup.fillPicks();
    publishMe();
    entry.hidden = true;
    room.hidden = false;
    lobby.onChange(render);
    if (host) {
      setup.redirectStart(() => {
        if (!lobby || started) return;
        const picks = setup.fillPicks();
        started = true;
        const info = lobby.start(picks.size, { nick: me(), nation: picks.nation, role: picks.role });
        onStart({ lobby, info, me: 0 });
      }, 'みんなで開始');
    } else {
      setup.lockSize(true);
      setup.redirectStart(() => {}, 'ホストの開始待ち…', true);
      // Give the room a moment to list who is there before saying the host is missing.
      setTimeout(render, 3500);
    }
    render();
  };

  btnHost.onclick = () => { void enter(newRoomCode(), true); };
  btnJoin.onclick = () => {
    const c = parseRoomCode(code.value);
    if (!c) { note.textContent = '部屋コードを入力してください（英数字）。'; return; }
    void enter(c, false);
  };
  code.onkeydown = (ev) => { if (ev.key === 'Enter') btnJoin.click(); };
  btnLeave.onclick = () => {
    lobby?.close();
    lobby = null;
    entry.hidden = false;
    room.hidden = true;
    setup.redirectStart(null);
    setup.lockSize(false);
    setBusy(false);
    note.textContent = '部屋を出ました。';
  };
}
