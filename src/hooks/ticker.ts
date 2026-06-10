// Single shared requestAnimationFrame loop.
// All animation consumers subscribe here instead of running their own rAF.

type TickFn = (elapsed: number, delta: number) => void

const subscribers = new Set<TickFn>()
let rafId: number | null = null
let lastT = 0

function loop(now: number) {
  const elapsed = now / 1000
  const delta   = Math.min(elapsed - lastT, 0.1) // cap delta at 100ms
  lastT = elapsed

  for (const fn of subscribers) {
    try { fn(elapsed, delta) } catch { /* don't let one bad tick kill the loop */ }
  }

  rafId = requestAnimationFrame(loop)
}

function start() {
  if (rafId === null) {
    lastT = performance.now() / 1000
    rafId = requestAnimationFrame(loop)
  }
}

function stop() {
  if (rafId !== null && subscribers.size === 0) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

export function subscribe(fn: TickFn): () => void {
  subscribers.add(fn)
  start()
  return () => {
    subscribers.delete(fn)
    stop()
  }
}
