/** Drives `onFrame` with requestAnimationFrame, passing the real ms since the previous frame. */
export function startRafLoop(onFrame: (frameMs: number) => void): () => void {
  let last = performance.now();
  let handle = 0;
  const tick = (now: number) => {
    const frameMs = now - last;
    last = now;
    onFrame(frameMs);
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(handle);
}
