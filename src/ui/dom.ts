export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error('missing element #' + id);
  return el;
}
