import type { GameState } from '../sim/state';
import { $ } from './dom';

export interface MeetingActions {
  say: (choice: string) => void;
  vote: (zoneIndex: number) => void;
  close: () => void;
}

/** Renders `state.meeting` into the meeting overlay. */
export class MeetingView {
  private ov = $('meetingOverlay');
  private log = $('meetingLog');
  private shownLines = 0;

  open(state: GameState, actions: MeetingActions): void {
    const m = state.meeting;
    if (!m) return;
    this.ov.style.display = 'flex';
    $('meetingTitle').textContent = m.kind === 'scheduled' ? 'ハーフタイム会議' : '緊急会議';
    this.log.innerHTML = '';
    this.shownLines = 0;
    this.refresh(state);

    const ch = $('meetingChoices');
    ch.innerHTML = '';
    for (const o of m.choices) {
      const b = document.createElement('button');
      b.textContent = o;
      b.onclick = () => { actions.say(o); b.disabled = true; this.refresh(state); };
      ch.appendChild(b);
    }

    const vt = $('meetingVote');
    vt.innerHTML = `<div style="width:100%;font-size:11px;opacity:.7">${m.zones.some((z) => z.targetId !== undefined) || m.zones.some((z) => z.label.includes('★')) ? '次の標的に投票（敵勢力のメンバー）' : '次の標的の手がかりがない — 捜索する場所に投票'}</div>`;
    m.zones.forEach((z, i) => {
      const b = document.createElement('button');
      b.textContent = z.label;
      b.onclick = () => {
        if (state.meeting?.voted) return;
        actions.vote(i);
        [...vt.children].forEach((c) => { if (c instanceof HTMLButtonElement) c.disabled = true; });
        this.refresh(state);
      };
      vt.appendChild(b);
    });

    const closeBtn = $('btnMeetingClose');
    closeBtn.style.display = 'inline-block';
    closeBtn.onclick = actions.close;
  }

  /** Shows lines said since the last call (and fixes any that arrived late), keeping the newest in view. */
  refresh(state: GameState): void {
    const lines = state.meeting?.lines ?? [];
    let added = false;
    for (let i = 0; i < lines.length; i++) {
      const d = this.log.children[i] as HTMLDivElement | undefined;
      if (d) { if (d.textContent !== lines[i]) d.textContent = lines[i]; continue; }
      const nd = document.createElement('div');
      nd.textContent = lines[i];
      if (i >= this.shownLines) nd.className = 'said';
      this.log.appendChild(nd);
      added = true;
    }
    this.shownLines = lines.length;
    if (added) this.log.scrollTop = this.log.scrollHeight;
  }

  hide(): void {
    this.ov.style.display = 'none';
  }
}
