import { $ } from './dom';

/**
 * Phone layout: the log and info side panels become slide-in drawers.
 * On desktop the toggle buttons are hidden by CSS and the classes have no effect.
 */
export function initDrawers(canvas: HTMLCanvasElement): void {
  const pairs: [HTMLElement, HTMLElement][] = [[$('btnInfo'), $('side')], [$('btnLog'), $('log')]];
  const set = (panel: HTMLElement, btn: HTMLElement, open: boolean) => {
    panel.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  };
  for (const [btn, panel] of pairs) {
    btn.addEventListener('click', () => {
      const open = !panel.classList.contains('open');
      for (const [b, p] of pairs) set(p, b, p === panel && open);
    });
  }
  // Touching the 3D view closes any open drawer.
  canvas.addEventListener('pointerdown', () => { for (const [b, p] of pairs) set(p, b, false); });
}
