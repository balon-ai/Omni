/**
 * HUD interaction sounds — clean, precise, digital.
 */

let _ctx: AudioContext | null = null

function ctx(): AudioContext {
  if (!_ctx) _ctx = new AudioContext()
  if (_ctx.state === 'suspended') _ctx.resume()
  return _ctx
}

function sine(c: AudioContext, freq: number, start: number, dur: number, vol: number, freqEnd?: number) {
  const osc = c.createOscillator()
  const g   = c.createGain()
  osc.type  = 'sine'
  osc.frequency.setValueAtTime(freq, start)
  if (freqEnd) osc.frequency.linearRampToValueAtTime(freqEnd, start + dur)
  g.gain.setValueAtTime(0, start)
  g.gain.linearRampToValueAtTime(vol, start + 0.003)
  g.gain.setValueAtTime(vol, start + dur - 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(g); g.connect(c.destination)
  osc.start(start); osc.stop(start + dur + 0.01)
}

function click(c: AudioContext, start: number, vol = 0.15) {
  // A single sample impulse through a resonant filter — hard digital key tap
  const buf = c.createBuffer(1, 2, c.sampleRate)
  const d   = buf.getChannelData(0); d[0] = 1; d[1] = -1
  const src = c.createBufferSource(); src.buffer = buf
  const bp  = c.createBiquadFilter()
  bp.type = 'bandpass'; bp.frequency.value = 4200; bp.Q.value = 12
  const g = c.createGain(); g.gain.value = vol
  src.connect(bp); bp.connect(g); g.connect(c.destination)
  src.start(start)
}

// ── Tick — holographic key tap ────────────────────────────────────────────────
// The precise "tik" when a HUD element is activated
export function sfxTick() {
  try {
    const c = ctx(), t = c.currentTime
    // Hard impulse click
    click(c, t, 0.18)
    // Tiny 6ms sine tail — gives it the holographic glass quality
    sine(c, 3400, t + 0.001, 0.006, 0.04)
  } catch { /* */ }
}

// ── OK — three-note confirmation ─────────────────────────────────────────────
// "deet · deet · DEET" — ascending, last note held slightly longer
// Exact character: clean sine, very short, slightly breathy
export function sfxOk() {
  try {
    const c = ctx(), t = c.currentTime
    // Three clean sine pings — C#6, F#6, C#7
    sine(c, 1109, t + 0.000, 0.048, 0.09)
    sine(c, 1480, t + 0.058, 0.048, 0.09)
    sine(c, 2218, t + 0.118, 0.095, 0.13)
    // Tiny sub-click before each ping — tactile "press"
    click(c, t + 0.000, 0.06)
    click(c, t + 0.058, 0.06)
    click(c, t + 0.118, 0.06)
  } catch { /* */ }
}

// ── Flash transition — system engage ─────────────────────────────────────────
// Short rising sweep → hard thud → silence — HUD fully initializes
export function sfxFlash() {
  try {
    const c = ctx(), t = c.currentTime

    // Rising sine sweep — HUD charging
    sine(c, 200, t, 0.14, 0.22, 2800)

    // Impact at peak — the "lock" moment
    const lockT = t + 0.13
    // Sub thud
    sine(c, 80, lockT, 0.18, 0.55, 30)
    // Mid click layer
    click(c, lockT, 0.4)
    // High chime — system online tone
    sine(c, 2800, lockT, 0.22, 0.12)
    sine(c, 3520, lockT + 0.01, 0.18, 0.10)
  } catch { /* */ }
}

// ── Orb spawn — arc reactor initialization sequence ──────────────────────────
// Low electrical hum stabilizes → single clean tone locks in → done
export function sfxOrbSpawn() {
  try {
    const c = ctx(), t = c.currentTime

    // ① Steady low hum — just electrical presence, no drama
    const hum = c.createOscillator(); hum.type = 'sine'
    hum.frequency.setValueAtTime(55, t)
    hum.frequency.linearRampToValueAtTime(60, t + 0.6)
    const hg = c.createGain()
    hg.gain.setValueAtTime(0, t)
    hg.gain.linearRampToValueAtTime(0.12, t + 0.08)
    hg.gain.setValueAtTime(0.12, t + 0.50)
    hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.70)
    hum.connect(hg); hg.connect(c.destination)
    hum.start(t); hum.stop(t + 0.75)

    // ② Second harmonic — barely there
    const hum2 = c.createOscillator(); hum2.type = 'sine'
    hum2.frequency.value = 120
    const hg2 = c.createGain()
    hg2.gain.setValueAtTime(0, t)
    hg2.gain.linearRampToValueAtTime(0.04, t + 0.12)
    hg2.gain.exponentialRampToValueAtTime(0.0001, t + 0.65)
    hum2.connect(hg2); hg2.connect(c.destination)
    hum2.start(t); hum2.stop(t + 0.70)

    // ③ Single clean lock tone — system ready
    setTimeout(() => sfxPowerLock(), 580)
  } catch { /* */ }
}

// ── Power lock — magnetic seal ────────────────────────────────────────────────
// The hard "chunk" when a system locks in place
export function sfxPowerLock() {
  try {
    const c = ctx(), t = c.currentTime
    // Sub thud
    sine(c, 95, t, 0.09, 0.45, 28)
    // Mid click
    click(c, t, 0.35)
    // High frequency click — metallic seal
    click(c, t + 0.008, 0.22)
    // Short ring — confirmation
    sine(c, 1760, t + 0.01, 0.06, 0.08)
  } catch { /* */ }
}

// ── Ring draw — subtle digital tick as each ring appears ─────────────────────
export function sfxRingDraw(index = 0) {
  try {
    const c   = ctx(), t = c.currentTime
    const freq = [2200, 2600, 3100][index] ?? 2200

    // Single clean click + very short sine tail
    click(c, t, 0.07)
    sine(c, freq, t + 0.001, 0.022, 0.035)
  } catch { /* */ }
}

// ── Sidebar whoosh — panel sliding in ────────────────────────────────────────
// Brief directional swipe — very subtle, mostly felt not heard
// Then a soft digital "thunk" as it seats
export function sfxWhoosh(side: 'left' | 'right' = 'left') {
  try {
    const c = ctx(), t = c.currentTime

    // Short filtered noise sweep — the slide
    const dur = 0.18
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate)
    const d   = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) {
      const p = i / d.length
      d[i] = (Math.random() * 2 - 1) * (p < 0.15 ? p / 0.15 : Math.pow(1 - p, 2))
    }
    const src = c.createBufferSource(); src.buffer = buf

    const lp = c.createBiquadFilter(); lp.type = 'lowpass'
    lp.frequency.setValueAtTime(side === 'left' ? 2400 : 2000, t)
    lp.frequency.exponentialRampToValueAtTime(300, t + dur)

    const pan = c.createStereoPanner()
    pan.pan.value = side === 'left' ? -0.55 : 0.55

    const g = c.createGain(); g.gain.value = 0.14
    src.connect(lp); lp.connect(pan); pan.connect(g); g.connect(c.destination)
    src.start(t)

    // Soft seating thud
    sine(c, 120, t + dur - 0.01, 0.06, 0.18, 45)
    click(c, t + dur - 0.01, 0.10)
  } catch { /* */ }
}
