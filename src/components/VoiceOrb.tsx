import { useEffect, useRef } from 'react'
import anime from 'animejs'
import { useVoice, type VoiceState } from '@/hooks/useVoice'
import { useMicMonitor } from '@/hooks/useAudioBands'
import { sfxTick, sfxOk, sfxFlash } from '@/hooks/sfx'

const STATE_LABEL: Record<VoiceState, string> = {
  idle:         'OFFLINE',
  listening:    'LISTENING',
  recording:    'RECORDING...',
  transcribing: 'TRANSCRIBING...',
  thinking:     'WAITING FOR ARCHIMEDES...',
  speaking:     'SPEAKING...',
}

export function VoiceOrb() {
  const { state, transcript, response } = useVoice()
  const { muted } = useMicMonitor()
  const ringRef  = useRef<SVGCircleElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  const prevState = useRef<VoiceState>('idle')

  // Animate ring on state change
  useEffect(() => {
    if (!ringRef.current) return
    const prev = prevState.current
    prevState.current = state

    if (state === 'listening') {
      // Only tick when coming from idle (initial activation), not from speaking/thinking
      if (prev === 'idle') sfxTick()
      anime({ targets: ringRef.current, r: [42, 46], opacity: [0.4, 0.6], duration: 400, easing: 'easeOutQuad' })
    } else if (state === 'recording') {
      sfxTick()
      anime({ targets: ringRef.current, r: [46, 54], opacity: [0.6, 0.9], duration: 200, easing: 'easeOutBack' })
    } else if (state === 'thinking') {
      if (prev === 'transcribing') sfxOk()
      anime({ targets: ringRef.current, r: [54, 45], opacity: [0.9, 0.55], duration: 400, easing: 'easeInOutSine' })
    } else if (state === 'speaking') {
      // Only play flash on first speaking transition, not between sentences
      if (prev !== 'speaking') sfxFlash()
      anime({ targets: ringRef.current, r: [45, 48], opacity: [0.55, 0.7], duration: 200, easing: 'easeOutQuad' })
    } else {
      anime({ targets: ringRef.current, r: [48, 42], opacity: [0.7, 0.4], duration: 500, easing: 'easeOutExpo' })
    }
  }, [state])

  // Pulse while recording or speaking
  useEffect(() => {
    if (!ringRef.current) return
    if (state === 'recording' || state === 'speaking') {
      const anim = anime({
        targets:   ringRef.current,
        r:         state === 'recording' ? [52, 58] : [46, 52],
        opacity:   state === 'recording' ? [0.9, 0.4] : [0.7, 0.3],
        duration:  state === 'recording' ? 500 : 900,
        loop:      true,
        direction: 'alternate',
        easing:    'easeInOutSine',
      })
      return () => anim.pause()
    }
  }, [state])

  // Fade label on change
  useEffect(() => {
    if (!labelRef.current) return
    anime({ targets: labelRef.current, opacity: [0, 1], duration: 200, easing: 'easeOutQuad' })
  }, [state])

  return (
    <div className="voice-orb-wrap" data-state={state}>
      {transcript && state !== 'idle' && (
        <div className="voice-transcript">
          <span className="voice-transcript-label">YOU</span>
          <span className="voice-transcript-text">{transcript}</span>
        </div>
      )}
      {response && (state === 'thinking' || state === 'speaking') && (
        <div className="voice-response">
          <span className="voice-response-label">ARCHIMEDES</span>
          <span className="voice-response-text">
            {response}
            {state === 'thinking' && <span className="chat-cursor" />}
          </span>
        </div>
      )}

      <div className={`voice-btn voice-btn--${state} ${muted ? 'voice-btn--muted' : ''}`}>
        <svg viewBox="0 0 100 100" className="voice-btn-svg">
          <circle ref={ringRef} cx="50" cy="50" r="42"
            fill="none" stroke="#00e5ff" strokeWidth="1" opacity="0.4" />
          <circle cx="50" cy="50" r="38"
            fill="none" stroke="#00e5ff" strokeWidth="0.5"
            strokeDasharray="3 5" opacity="0.2" />
          <circle cx="50" cy="50"
            r={state === 'recording' ? 10 : state === 'speaking' ? 8 : 6}
            fill={muted ? 'rgba(80,100,120,0.6)' : '#00e5ff'}
            style={{ transition: 'r 0.3s', filter: muted ? 'none' : 'drop-shadow(0 0 6px #00e5ff)' }}
          />
          {muted ? (
            <>
              <line x1="38" y1="38" x2="62" y2="62" stroke="rgba(80,100,120,0.8)" strokeWidth="2" strokeLinecap="round" />
              <path d="M44,44 L44,46 Q44,54 50,54 Q56,54 56,50" fill="none" stroke="rgba(80,100,120,0.6)" strokeWidth="1.5" strokeLinecap="round" />
            </>
          ) : state === 'idle' || state === 'listening' || state === 'recording' ? (
            /* Mic */
            <>
              <line x1="50" y1="28" x2="50" y2="48" stroke="#00e5ff" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
              <path d="M38,44 Q38,54 50,54 Q62,54 62,44" fill="none" stroke="#00e5ff" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
              <line x1="50" y1="54" x2="50" y2="60" stroke="#00e5ff" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
              <line x1="44" y1="60" x2="56" y2="60" stroke="#00e5ff" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
            </>
          ) : state === 'speaking' ? (
            /* Sound wave */
            <>
              <line x1="42" y1="40" x2="42" y2="60" stroke="#00e5ff" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
              <line x1="50" y1="34" x2="50" y2="66" stroke="#00e5ff" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
              <line x1="58" y1="40" x2="58" y2="60" stroke="#00e5ff" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
            </>
          ) : state === 'transcribing' ? (
            /* Three pulsing dots — local processing */
            <>
              <circle cx="38" cy="50" r="3" fill="#00e5ff" opacity="0.9" />
              <circle cx="50" cy="50" r="3" fill="#00e5ff" opacity="0.9" />
              <circle cx="62" cy="50" r="3" fill="#00e5ff" opacity="0.9" />
            </>
          ) : (
            /* Thinking — clock face, waiting on Archimedes */
            <>
              <circle cx="50" cy="50" r="14" fill="none" stroke="#a855f7" strokeWidth="1.2" opacity="0.8" />
              <line x1="50" y1="50" x2="50" y2="39" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
              <line x1="50" y1="50" x2="58" y2="54" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
              <circle cx="50" cy="50" r="1.5" fill="#a855f7" />
            </>
          )}
        </svg>
      </div>

      <span ref={labelRef} className="voice-state-label">
        {muted ? 'MUTED' : STATE_LABEL[state]}
      </span>
    </div>
  )
}
