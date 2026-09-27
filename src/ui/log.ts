import { $ } from './dom';

const MAX_KEPT = 50;
const MAX_SHOWN = 28;

/** Left-hand event log panel (newest first). */
export class LogPanel {
  private entries: string[] = [];
  private el = $('log');

  add(msg: string): void {
    this.entries.unshift(msg);
    if (this.entries.length > MAX_KEPT) this.entries.pop();
    this.el.replaceChildren(
      ...this.entries.slice(0, MAX_SHOWN).map((t) => {
        const d = document.createElement('div');
        d.textContent = t;
        return d;
      }),
    );
  }
}
