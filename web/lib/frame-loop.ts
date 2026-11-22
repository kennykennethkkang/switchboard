/** The backing store never goes past 2 device pixels per CSS pixel: sharper than that costs CPU and nobody sees it. */
export const MAX_DPR = 2
/** Touch screens: 1.5 keeps the pixel art sharp enough and cuts the canvas to 56% of the pixels. */
export const COARSE_DPR = 1.5

/**
 * rAF loop that runs only while run(now) holds. wake() draws one frame at once and restarts the loop if run holds;
 * stop() cancels it. dt is ms since the last frame this loop drew (16 on a wake). minDt caps the rate: a frame that
 * comes sooner than that after the last one is skipped (30 gives 30 fps on a 60 Hz screen).
 */
export function frameLoop(frame: (now: number, dt: number) => void, run: (now: number) => boolean, minDt = 0) {
  let raf = 0, last = 0
  const draw = (now: number, dt: number) => { last = now; frame(now, dt) }
  const loop = (now: number) => { if (now - last >= minDt) draw(now, now - last); raf = run(now) ? requestAnimationFrame(loop) : 0 }
  const wake = () => { if (raf) return; const now = performance.now(); draw(now, 16); if (run(now)) raf = requestAnimationFrame(loop) }
  return { wake, stop: () => { cancelAnimationFrame(raf); raf = 0 }, running: () => raf !== 0 }
}
