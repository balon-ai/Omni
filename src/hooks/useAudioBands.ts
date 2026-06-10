/**
 * Shared audio analyser — single mic stream + TTS output analyser.
 *
 * One MediaStream, one AudioContext, shared across VAD (useVoice) and
 * the mic monitor widget (MicMonitor). VAD calls `acquireMicStream()`
 * to get the stream; the analyser is wired internally and exposed via
 * `__micAnalyser` for the canvas widget.
 */
import { useEffect, useState, useCallback } from 'react'

export interface AudioBands {
  bass:   number
  mid:    number
  treble: number
  quiet:  number
}

// ── Module-level shared state ─────────────────────────────────────────────────
let audioCtx:    AudioContext | null              = null
let micAnalyser: AnalyserNode | null              = null
let ttsAnalyser: AnalyserNode | null              = null
let micData:     Uint8Array<ArrayBuffer> | null   = null
let ttsData:     Uint8Array<ArrayBuffer> | null   = null
let micSource:   MediaStreamAudioSourceNode | null = null
let micStream:   MediaStream | null               = null
let micMuted                                      = false
let refCount                                      = 0

// Pending waiters for the mic stream (VAD + init racing each other)
let streamPromise: Promise<MediaStream> | null = null

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

/**
 * Acquire (or reuse) the single shared mic stream.
 * Each caller must pair this with a `releaseMicStream()` call.
 * VAD in useVoice calls this instead of its own getUserMedia.
 * Returns the live MediaStream so VAD can create a MediaRecorder from it.
 */
export async function acquireMicStream(): Promise<MediaStream> {
  refCount++

  // Already have a live stream — return it
  if (micStream && micStream.active) return micStream

  // Already fetching — wait for the same promise
  if (streamPromise) return streamPromise

  streamPromise = navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then(stream => {
      micStream = stream

      const ctx   = getCtx()
      micSource   = ctx.createMediaStreamSource(stream)
      micAnalyser = ctx.createAnalyser()
      micAnalyser.fftSize               = 512
      micAnalyser.smoothingTimeConstant = 0.8
      micSource.connect(micAnalyser)
      micData = new Uint8Array(micAnalyser.frequencyBinCount) as Uint8Array<ArrayBuffer>

      // Expose for MicMonitor canvas
      ;(window as unknown as Record<string, unknown>)['__micAnalyser'] = micAnalyser

      streamPromise = null
      return stream
    })
    .catch(err => {
      refCount--  // acquisition failed — undo the increment
      streamPromise = null
      throw err
    })

  return streamPromise
}

export function releaseMicStream() {
  refCount--
  if (refCount > 0) return
  micSource?.disconnect()
  micStream?.getTracks().forEach(t => t.stop())
  audioCtx?.close()
  audioCtx    = null
  micAnalyser = null
  ttsAnalyser = null
  micData     = null
  ttsData     = null
  micSource   = null
  micStream   = null
  ;(window as unknown as Record<string, unknown>)['__micAnalyser'] = null
}

// Called by useVoice when TTS audio starts playing
export function connectTtsAudio(element: HTMLAudioElement) {
  try {
    const ctx  = getCtx()
    const src  = ctx.createMediaElementSource(element)
    const anal = ctx.createAnalyser()
    anal.fftSize               = 512
    anal.smoothingTimeConstant = 0.75
    src.connect(anal)
    src.connect(ctx.destination)
    ttsAnalyser = anal
    ttsData     = new Uint8Array(anal.frequencyBinCount) as Uint8Array<ArrayBuffer>
  } catch { /* already connected */ }
}

export function disconnectTtsAudio() {
  ttsAnalyser = null
  ttsData     = null
}

function extractBands(analyser: AnalyserNode, data: Uint8Array<ArrayBuffer>): AudioBands {
  analyser.getByteFrequencyData(data)
  const len     = data.length
  const bassEnd = Math.floor(len * 0.08)
  const midEnd  = Math.floor(len * 0.35)
  let bassSum = 0, midSum = 0, trebleSum = 0
  for (let i = 0;       i < bassEnd; i++) bassSum   += data[i]
  for (let i = bassEnd; i < midEnd;  i++) midSum    += data[i]
  for (let i = midEnd;  i < len;     i++) trebleSum += data[i]
  const bass   = (bassSum   / bassEnd)            / 255
  const mid    = (midSum    / (midEnd - bassEnd)) / 255
  const treble = (trebleSum / (len - midEnd))     / 255
  return { bass, mid, treble, quiet: 1 - Math.min(bass + mid * 0.5, 1) }
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/** Returns bands for whichever source is active — TTS takes priority */
export function useAudioBands(): () => AudioBands {
  useEffect(() => {
    // acquireMicStream increments refCount; releaseMicStream decrements it
    acquireMicStream().catch(() => {})
    return () => releaseMicStream()
  }, [])

  return function getBands(): AudioBands {
    if (ttsAnalyser && ttsData) return extractBands(ttsAnalyser, ttsData)
    return { bass: 0, mid: 0, treble: 0, quiet: 1 }
  }
}

/** Exposes mic RMS for visualizer widget + mute control */
export function useMicMonitor() {
  const [muted, setMutedState] = useState(false)

  const getMicRms = useCallback((): number => {
    if (!micAnalyser || !micData || micMuted) return 0
    micAnalyser.getByteTimeDomainData(micData)
    let sum = 0
    for (let i = 0; i < micData.length; i++) {
      const s = (micData[i] - 128) / 128
      sum += s * s
    }
    return Math.sqrt(sum / micData.length)
  }, [])

  const getMicBars = useCallback((): number[] => {
    if (!micAnalyser || !micData || micMuted) return Array(20).fill(0)
    micAnalyser.getByteFrequencyData(micData)
    const bars: number[] = []
    const step = Math.floor(micData.length / 20)
    for (let i = 0; i < 20; i++) {
      bars.push(micData[i * step] / 255)
    }
    return bars
  }, [])

  const toggleMute = useCallback(() => {
    micMuted = !micMuted
    micStream?.getTracks().forEach(t => { t.enabled = !micMuted })
    setMutedState(micMuted)
  }, [])

  return { muted, getMicRms, getMicBars, toggleMute }
}

/** Read the current module-level mute state — used by VAD in useVoice */
export function isMicMuted(): boolean {
  return micMuted
}
