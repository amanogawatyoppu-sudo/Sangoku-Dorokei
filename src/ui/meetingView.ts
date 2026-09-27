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
    vt.innerHTML = '<div style="width:100%;font-size:11px;opacity:.7">重点捜索対象に投票</div>';
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

  /** Appends any dialogue lines not yet shown. */
  refresh(state: GameState): void {
    const lines = state.meeting?.lines ?? [];
    for (; this.shownLines < lines.length; this.shownLines++) {
      const d = document.createElement('div');
      d.textContent = lines[this.shownLines];
      this.log.appendChild(d);
    }
  }

  hide(): void {
    this.ov.style.display = 'none';
  }
}
