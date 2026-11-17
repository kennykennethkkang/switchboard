/** The backing store never goes past 2 device pixels per CSS pixel: sharper than that costs CPU and nobody sees it. */
export const MAX_DPR = 2

/**
 * rAF loop that runs only while run(now) holds. wake() draws one frame at once and restarts the loop if run holds;
 * stop() cancels it. dt is ms since the last frame this loop drew (16 on a wake).
 */
export function frameLoop(frame: (now: number, dt: number) => void, run: (now: number) => boolean) {
  let raf = 0, last = 0
  const draw = (now: number, dt: number) => { last = now; frame(now, dt) }
  const loop = (now: number) => { draw(now, now - last); raf = run(now) ? requestAnimationFrame(loop) : 0 }
  const wake = () => { if (raf) return; const now = performance.now(); draw(now, 16); if (run(now)) raf = requestAnimationFrame(loop) }
  return { wake, stop: () => { cancelAnimationFrame(raf); raf = 0 }, running: () => raf !== 0 }
}
