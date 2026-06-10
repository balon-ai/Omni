import { useEffect, useRef } from 'react'
import { useMicMonitor } from '@/hooks/useAudioBands'
import { subscribe } from '@/hooks/ticker'

const BAR_COUNT = 48
const BAR_GAP   = 1

export function MicMonitor() {
  const { muted, toggleMute } = useMicMonitor()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    const ro = new ResizeObserver(() => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    })
    ro.observe(canvas)
    canvas.width  = canvas.offsetWidth  || 160
    canvas.height = canvas.offsetHeight || 44

    // Smoothed bar values
    const smoothed = new Float32Array(BAR_COUNT).fill(0)

    const unsub = subscribe(() => {
      const W = canvas.width
      const H = canvas.height
      ctx.clearRect(0, 0, W, H)

      // Read frequency data from shared mic analyser
      const analyser = (window as unknown as { __micAnalyser?: AnalyserNode }).__micAnalyser
      const raw = new Uint8Array(analyser ? analyser.frequencyBinCount : 256)
      if (analyser) analyser.getByteFrequencyData(raw)

      // Bucket raw FFT bins into BAR_COUNT bars
      const binPerBar = Math.floor(raw.length / BAR_COUNT)
      for (let i = 0; i < BAR_COUNT; i++) {
        let sum = 0
        for (let j = 0; j < binPerBar; j++) sum += raw[i * binPerBar + j]
        const v = (sum / binPerBar) / 255
        // Fast attack, slow decay — like cava
        smoothed[i] = muted
          ? smoothed[i] * 0.82
          : smoothed[i] < v
            ? v
            : smoothed[i] * 0.78 + v * 0.22
      }

      const barW   = (W - (BAR_COUNT - 1) * BAR_GAP) / BAR_COUNT
      const cy     = H / 2
      const color  = muted ? 'rgba(70,90,110,0.5)' : '#00e5ff'
      const glow   = muted ? 0 : 6

      ctx.shadowColor = color
      ctx.shadowBlur  = glow
      ctx.fillStyle   = color

      for (let i = 0; i < BAR_COUNT; i++) {
        const x  = i * (barW + BAR_GAP)
        const h  = Math.max(1, smoothed[i] * cy * 0.95)
        // Symmetric: grow from center up and down
        ctx.fillRect(x, cy - h, barW, h * 2)
      }

      ctx.shadowBlur = 0
    })

    return () => { ro.disconnect(); unsub() }
  }, [muted])

  return (
    <div className="mic-monitor">
      <div className="mic-monitor-header">
        <span className="mic-monitor-label">MIC INPUT</span>
      </div>
      <div className="mic-monitor-row">
        <canvas ref={canvasRef} className="mic-canvas" />
        <button
          className={`mic-mute-btn ${muted ? 'muted' : ''}`}
          onClick={toggleMute}
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted
            ? <svg viewBox="0 0 20 20" fill="none">
                <path d="M10 4a2.5 2.5 0 012.5 2.5v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <path d="M6 8v.5a4 4 0 006.93 2.73" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="4" y1="4" x2="16" y2="16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="10" y1="14.5" x2="10" y2="17" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="7.5" y1="17" x2="12.5" y2="17" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            : <svg viewBox="0 0 20 20" fill="none">
                <rect x="8" y="3" width="4" height="8" rx="2" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M5 9.5a5 5 0 0010 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="10" y1="14.5" x2="10" y2="17" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="7.5" y1="17" x2="12.5" y2="17" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
          }
        </button>
      </div>
    </div>
  )
}
