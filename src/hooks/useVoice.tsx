/**
 * Voice communication manager — always-on VAD.
 * When mic is unmuted: continuously listens, detects speech via RMS threshold,
 * records until silence, then transcribes (STT) → sends to backend → plays TTS.
 */
import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import { connectTtsAudio, disconnectTtsAudio, isMicMuted, acquireMicStream, releaseMicStream } from './useAudioBands'

export type VoiceState =
  | 'idle'
  | 'listening'    // mic hot, waiting for speech
  | 'recording'    // speech detected, capturing
  | 'transcribing' // sending to STT
  | 'thinking'     // waiting on Archimedes
  | 'speaking'     // TTS playing back

interface VoiceCtx {
  state:      VoiceState
  transcript: string
  response:   string
  sessionKey: string | null
}

const Ctx = createContext<VoiceCtx>({
  state: 'idle', transcript: '', response: '', sessionKey: null,
})

export function useVoice() { return useContext(Ctx) }

// ── VAD tuning ────────────────────────────────────────────────────────────────
const SILENCE_DURATION_MS  = 800    // snappy response, short pause ends turn
const MIN_SPEECH_MS        = 600
const SPEECH_SNR_RATIO     = 2.2
const AMBIENT_INIT_MS      = 1500   // faster calibration
const AMBIENT_DECAY        = 0.997
const AMBIENT_ATTACK       = 0.12
const THRESHOLD_MIN        = 0.006
const THRESHOLD_MAX        = 0.22

// ── Helpers ───────────────────────────────────────────────────────────────────
async function transcribe(blob: Blob): Promise<string> {
  // Route through Electron main to avoid CORS
  const buffer   = await blob.arrayBuffer()
  const mimeType = blob.type || 'audio/ogg'
  const result   = await window.omni?.chat.transcribe({ buffer, mimeType })
  return result?.text?.trim() ?? ''
}

function getRms(analyser: AnalyserNode): number {
  const buf = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(buf)
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / buf.length)
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function VoiceProvider({ children }: { children: ReactNode }) {
  const [state,      setState]      = useState<VoiceState>('idle')
  const [transcript, setTranscript] = useState('')
  const [response,   setResponse]   = useState('')
  const [sessionKey, setSessionKey] = useState<string | null>(null)
  const sessionKeyRef = useRef<string | null>(null)

  // Internal refs — not in state to avoid re-renders
  const stateRef     = useRef<VoiceState>('idle')
  const audioRef     = useRef<HTMLAudioElement | null>(null)
  const vadTimer     = useRef<ReturnType<typeof setInterval> | null>(null)
  const mediaRef     = useRef<MediaRecorder | null>(null)
  const chunksRef    = useRef<Blob[]>([])
  const speechStart  = useRef<number>(0)
  const silenceStart = useRef<number>(0)
  const vadStream    = useRef<MediaStream | null>(null)
  const vadAnalyser  = useRef<AnalyserNode | null>(null)

  function setS(s: VoiceState) {
    stateRef.current = s
    setState(s)
  }

  // ── Session ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    window.omni?.chat.session().then(s => {
      setSessionKey(s.sessionKey)
      sessionKeyRef.current = s.sessionKey
    }).catch(() => {})
  }, [])

  // ── TTS sentence queue ───────────────────────────────────────────────────────
  const ttsQueueRef    = useRef<string[]>([])
  const ttsPlayingRef  = useRef(false)
  const ttsDoneRef     = useRef(false)
  const hasRealResponseRef = useRef(false)  // true only when actual response sentences arrived
  const startVadRef    = useRef<() => void>(() => {})
  const stopVadRef     = useRef<() => void>(() => {})

  // Pre-synthesized audio buffer queue — synthesize ahead of playback
  const audioQueueRef  = useRef<{ url: string; audio: HTMLAudioElement }[]>([])
  const synthQueueRef  = useRef<string[]>([])   // sentences waiting to synthesize
  const synthBusyRef   = useRef(false)           // true while a synth call is in flight
  const playBusyRef    = useRef(false)           // true while audio is playing

  // Pipeline TTS: synthesize sentence 0 immediately, then 1..N in parallel while 0 plays
  // isNarration=true means don't transition to idle when done — more audio is coming
  const synthesizeAll = useRef((rawSentences: string[], isNarration = false) => {
    if (rawSentences.length === 0) return

    // Merge into at most MAX_WORKERS chunks so we never queue more than workers can handle
    const MAX_WORKERS = 3
    const sentences = isNarration ? rawSentences : (() => {
      if (rawSentences.length <= MAX_WORKERS) return rawSentences
      const merged = [...rawSentences]
      while (merged.length > MAX_WORKERS) {
        const last = merged.pop()!
        merged[merged.length - 1] += ' ' + last
      }
      return merged
    })()

    const t0 = performance.now()
    console.log(`[TTS] synthesizeAll start — ${sentences.length} chunks${isNarration ? ' (narration)' : ''} (raw: ${rawSentences.length})`)

    const slots: ({ url: string; audio: HTMLAudioElement } | null)[] = new Array(sentences.length).fill(null)
    let nextPlaySlot = 0
    let firstAudioAt: number | null = null

    const tryFlush = () => {
      while (nextPlaySlot < slots.length && slots[nextPlaySlot] !== null) {
        audioQueueRef.current.push(slots[nextPlaySlot]!)
        nextPlaySlot++
        if (firstAudioAt === null) {
          firstAudioAt = performance.now()
          console.log(`[TTS] first audio ready at ${((firstAudioAt - t0) / 1000).toFixed(2)}s`)
        }
      }
      // Only kick off playback if nothing is currently playing — onended handles chaining
      if (!playBusyRef.current && audioQueueRef.current.length > 0) {
        playNextAudio.current()
      }
      if (!isNarration &&
          nextPlaySlot === sentences.length && ttsDoneRef.current &&
          hasRealResponseRef.current &&
          audioQueueRef.current.length === 0 && !playBusyRef.current) {
        console.log(`[TTS] all done in ${((performance.now() - t0) / 1000).toFixed(2)}s`)
        setS('idle')
        startVadRef.current()
      }
    }

    // Fire all chunks in parallel — each call goes on its own IPC channel,
    // so they don't serialize through the invoke queue.
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i]
      const ts = performance.now()
      console.log(`[TTS] synth[${i}] start: "${sentence.slice(0, 40)}"`)
      window.omni?.tts.speak({ text: sentence }).then(wavBuffer => {
        const elapsed = ((performance.now() - ts) / 1000).toFixed(2)
        if (wavBuffer && wavBuffer.byteLength > 0) {
          const blob  = new Blob([wavBuffer], { type: 'audio/wav' })
          const url   = URL.createObjectURL(blob)
          const audio = new Audio(url)
          slots[i] = { url, audio }
          console.log(`[TTS] synth[${i}] done in ${elapsed}s`)
        } else {
          slots[i] = { url: '', audio: new Audio() }
          console.warn(`[TTS] synth[${i}] empty in ${elapsed}s`)
        }
        tryFlush()
      }).catch(e => {
        console.error(`[TTS] synth[${i}] failed:`, e)
        slots[i] = { url: '', audio: new Audio() }
        tryFlush()
      })
    }
  })

  // Play the next pre-synthesized audio from audioQueue
  const playNextAudio = useRef(() => {
    if (playBusyRef.current || audioQueueRef.current.length === 0) return
    const item = audioQueueRef.current.shift()!
    playBusyRef.current = true
    setS('speaking')
    audioRef.current = item.audio
    connectTtsAudio(item.audio)
    item.audio.onended = () => {
      URL.revokeObjectURL(item.url)
      disconnectTtsAudio()
      audioRef.current = null
      playBusyRef.current = false
      if (audioQueueRef.current.length > 0) {
        playNextAudio.current()
      } else if (ttsDoneRef.current &&
                 hasRealResponseRef.current &&
                 pendingSentencesRef.current.length === 0 &&
                 synthQueueRef.current.length === 0 &&
                 !synthBusyRef.current) {
        setS('idle')
        startVadRef.current()
      }
    }
    item.audio.onerror = () => {
      URL.revokeObjectURL(item.url)
      disconnectTtsAudio()
      audioRef.current = null
      playBusyRef.current = false
      playNextAudio.current()
    }
    item.audio.play().catch(e => {
      console.error('[TTS] play failed:', e)
      playBusyRef.current = false
      playNextAudio.current()
    })
  })

  // ── Gateway events — stable subscription, refs only ──────────────────────────
  const pendingSentencesRef = useRef<string[]>([])

  useEffect(() => {
    const unsub = window.omni?.chat.onEvent(({ event, payload }) => {
      const p = (payload ?? {}) as Record<string, unknown>
      if (event === 'gateway.connected') return

      if (event === 'chat.sentence') {
        const sentence     = (p.text ?? '') as string
        const isNarration  = (p.isNarration ?? false) as boolean
        if (!sentence) return

        if (isNarration) {
          console.log('[TTS] narration:', sentence)
          stopVadRef.current()
          setS('thinking')
          synthesizeAll.current([sentence], true)  // true = narration, don't go idle
          return
        }

        console.log('[TTS] collecting sentence:', sentence.slice(0, 60))
        pendingSentencesRef.current.push(sentence)
        setResponse(r => r ? r + ' ' + sentence : sentence)
        return
      }

      if (event === 'chat.response') {
        const sentenceCount = pendingSentencesRef.current.length
        console.log('[TTS] chat.response — sentences:', sentenceCount, 'ttsDone:', ttsDoneRef.current, 'hasReal:', hasRealResponseRef.current)
        ttsDoneRef.current = true
        const sentences = [...pendingSentencesRef.current]
        pendingSentencesRef.current = []
        if (sentences.length > 0) {
          hasRealResponseRef.current = true
          synthesizeAll.current(sentences)
        } else if (!playBusyRef.current && audioQueueRef.current.length === 0) {
          // No sentences and nothing playing — go idle
          setS('idle')
          startVadRef.current()
        }
        // If audio is still playing (narration), onended will handle the idle transition
        return
      }
    })
    return () => { unsub?.() }
  }, [])

  // ── TTS (single-call stub — replaced by queue) ───────────────────────────────
  const _speak = useCallback(async (_text: string) => { /* noop */ }, [])
  void _speak

  const startSpeaking = useCallback(() => {
    // Stop current audio and flush all queues
    if (audioRef.current) {
      audioRef.current.pause()
      disconnectTtsAudio()
      audioRef.current = null
    }
    // Revoke any pre-synthesized audio URLs
    audioQueueRef.current.forEach(item => URL.revokeObjectURL(item.url))
    audioQueueRef.current      = []
    synthQueueRef.current      = []
    pendingSentencesRef.current = []
    ttsQueueRef.current        = []
    ttsPlayingRef.current      = false
    synthBusyRef.current       = false
    playBusyRef.current        = false
    ttsDoneRef.current         = false
    hasRealResponseRef.current = false  // reset — waiting for real response
    stopVadRef.current()
    setResponse('')
    setS('thinking')
  }, [])

  // ── VAD loop ─────────────────────────────────────────────────────────────────
  const stopVad = useCallback(() => {
    if (vadTimer.current) { clearInterval(vadTimer.current); vadTimer.current = null }
    if (mediaRef.current) {
      try { mediaRef.current.stop() } catch { /* */ }
      mediaRef.current = null
    }
  }, [])

  // Keep refs in sync so playNextSentence can call them without stale closures

  const processAudio = useCallback(async () => {
    // Always webm — MediaRecorder in Electron/Chromium only produces webm
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
    chunksRef.current = []

    console.log('[VAD] blob size:', blob.size, 'bytes')
    if (blob.size < 16000) {  // ~0.5s minimum — below this is almost always noise
      console.log('[VAD] blob too small, discarding')
      setS('listening')
      return
    }

    setS('transcribing')
    let text = ''
    try {
      text = await transcribe(blob)
      console.log('[VAD] transcript:', JSON.stringify(text))
    } catch (e) {
      console.error('[VAD] transcribe failed:', e)
      setS('idle')
      setTimeout(() => setS('listening'), 2000)
      return
    }

    if (!text || text.split(/\s+/).filter(Boolean).length < 2) {
      // Single-word or empty — likely hallucination, don't interrupt playback
      console.log('[VAD] transcript too short, discarding:', JSON.stringify(text))
      setS('listening')
      return
    }

    setTranscript(text)
    setResponse('')           // clear previous response
    startSpeaking()           // reset queue, stop VAD

    try {
      const result = await window.omni?.chat.send({ text, sessionKey: sessionKeyRef.current ?? undefined })
      console.log('[VAD] chat.send result:', result)
    } catch (e) {
      console.error('[VAD] chat.send failed:', e)
      setS('listening')
      startVadRef.current()
    }
  }, [startSpeaking])  // reads sessionKey via ref, calls startVad via ref

  const startVad = useCallback(async () => {
    // Don't start if already running
    if (vadTimer.current) return
    try {
      // Reuse the single shared mic stream — no second getUserMedia call
      const stream = await acquireMicStream()
      vadStream.current = stream

      // Private AudioContext for VAD RMS only — doesn't affect the shared analyser
      const ctx      = new AudioContext()
      const src      = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      src.connect(analyser)
      vadAnalyser.current = analyser

      let isRecording    = false
      let ambientRms     = 0.01   // running ambient floor
      let ambientSamples = 0
      const ambientInitEnd = Date.now() + AMBIENT_INIT_MS
      silenceStart.current = Date.now()

      vadTimer.current = setInterval(() => {
        // Gate: don't record while muted OR while system is speaking/thinking
        const systemBusy = stateRef.current === 'speaking' ||
                           stateRef.current === 'thinking' ||
                           stateRef.current === 'transcribing'
        if (isMicMuted() || systemBusy) {
          // Physically disable mic track during playback — prevents feedback pickup
          const track = stream.getAudioTracks()[0]
          if (track && track.enabled && systemBusy) track.enabled = false
          if (isRecording && mediaRef.current) {
            mediaRef.current.stop()
            mediaRef.current = null
            isRecording = false
          }
          if (systemBusy) setS(stateRef.current)
          else setS('idle')
          return
        }
        // Re-enable mic track when system is idle/listening
        const track = stream.getAudioTracks()[0]
        if (track && !track.enabled && !isMicMuted()) track.enabled = true

        const rms = getRms(analyser)
        const now = Date.now()

        // ── Ambient calibration ─────────────────────────────────────────────
        if (now < ambientInitEnd) {
          // Initial calibration window — average all samples
          ambientSamples++
          ambientRms += (rms - ambientRms) / ambientSamples
          return  // don't trigger speech during calibration
        }

        // After calibration: track ambient floor with asymmetric smoothing.
        // If room gets louder (TV on, etc.) — adapt fast.
        // If room gets quieter — decay slowly so we don't chase speech dips.
        if (!isRecording) {
          const alpha = rms > ambientRms ? AMBIENT_ATTACK : AMBIENT_DECAY
          ambientRms  = ambientRms * (1 - alpha) + rms * alpha
        }

        // Dynamic threshold: SNR ratio above ambient, clamped to sane range
        const threshold = Math.min(
          THRESHOLD_MAX,
          Math.max(THRESHOLD_MIN, ambientRms * SPEECH_SNR_RATIO)
        )

        if (rms > threshold) {
          silenceStart.current = now
          // Don't start a new recording while already processing/speaking
          const busy = stateRef.current === 'transcribing'
                    || stateRef.current === 'thinking'
                    || stateRef.current === 'speaking'
          if (!isRecording && !busy) {
            // Begin recording
            speechStart.current = now
            chunksRef.current   = []
            try {
              const mr = new MediaRecorder(stream, {
                mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                  ? 'audio/webm;codecs=opus'
                  : 'audio/webm',
              })
              chunksRef.current = []
              mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
              mr.onstop = () => {
                const elapsed = Date.now() - speechStart.current
                console.log('[VAD] recording stopped, elapsed:', elapsed, 'ms, chunks:', chunksRef.current.length)
                if (elapsed >= MIN_SPEECH_MS) {
                  processAudio()
                } else {
                  chunksRef.current = []
                  if (stateRef.current === 'recording') setS('listening')
                }
              }
              // No timeslice — collect entire recording as one blob on stop()
              // Timeslice creates fragmented webm with broken EBML headers
              mr.start()
              mediaRef.current = mr
              isRecording = true
              setS('recording')
            } catch { /* */ }
          }
        } else {
          // Silence
          if (isRecording && (now - silenceStart.current) > SILENCE_DURATION_MS) {
            mediaRef.current?.stop()
            mediaRef.current = null
            isRecording      = false
          }
          if (!isRecording && stateRef.current === 'listening') {
            // just waiting
          } else if (!isRecording && stateRef.current !== 'transcribing' &&
                     stateRef.current !== 'thinking' && stateRef.current !== 'speaking') {
            setS('listening')
          }
        }
      }, 50) // poll every 50ms

      setS('listening')
    } catch (e) {
      console.warn('[VAD] startVad failed, retrying in 2s:', e)
      setS('idle')
      setTimeout(() => startVadRef.current(), 2000)
    }
  }, [processAudio])

  // ── Start VAD on mount, stop on unmount ──────────────────────────────────────
  useEffect(() => {
    startVadRef.current = startVad
    stopVadRef.current  = stopVad
    startVad()
    return () => {
      stopVad()
      // Don't stop the shared stream tracks here — releaseMicStream handles that
      if (audioRef.current) {
        audioRef.current.pause()
        disconnectTtsAudio()
      }
      releaseMicStream()
    }
  }, [startVad, stopVad])

  return (
    <Ctx.Provider value={{ state, transcript, response, sessionKey }}>
      {children}
    </Ctx.Provider>
  )
}
