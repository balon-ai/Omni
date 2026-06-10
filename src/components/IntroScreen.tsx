import { useEffect, useRef, useState } from 'react'
import anime from 'animejs'
import { sfxTick, sfxOk, sfxFlash } from '@/hooks/sfx'
import { useConfig } from '@/hooks/useConfig'

// Default boot lines shown before config loads — deployment-neutral
const DEFAULT_BOOT_LINES = [
  { text: 'OMNI INTERFACE v0.1',                      delay: 0,    color: '#00e5ff', size: 'lg' },
  { text: '',                                          delay: 900,  color: '',        size: 'sm' },
  { text: 'INITIALIZING CORE SYSTEMS...',             delay: 1000, color: '#cce8ff', size: 'sm' },
  { text: 'LOADING NEURAL WEIGHTS             [OK]',  delay: 1400, color: '#cce8ff', size: 'sm' },
  { text: 'ESTABLISHING BACKEND BRIDGE        [OK]',  delay: 1700, color: '#cce8ff', size: 'sm' },
  { text: 'MOUNTING NETWORK MESH              [OK]',  delay: 2000, color: '#cce8ff', size: 'sm' },
  { text: 'LOCATING REMOTE NODE               [OK]',  delay: 2300, color: '#cce8ff', size: 'sm' },
  { text: 'AUDIO SUBSYSTEM READY              [OK]',  delay: 2600, color: '#cce8ff', size: 'sm' },
  { text: '',                                          delay: 2900, color: '',        size: 'sm' },
  { text: '',                                          delay: 3000, color: 'rgba(160,200,240,0.5)', size: 'sm' },
  { text: '',                                          delay: 3150, color: 'rgba(160,200,240,0.5)', size: 'sm' },
  { text: '',                                          delay: 3300, color: 'rgba(160,200,240,0.5)', size: 'sm' },
  { text: '',                                          delay: 3450, color: 'rgba(160,200,240,0.5)', size: 'sm' },
  { text: '',                                          delay: 3600, color: '',        size: 'sm' },
  { text: 'ALL SYSTEMS NOMINAL',                      delay: 3800, color: '#a855f7', size: 'md' },
  { text: 'LAUNCHING...',                             delay: 4300, color: '#00e5ff', size: 'md' },
]

type BootLine = { text: string; delay: number; color: string; size: string }

const TOTAL_MS = 5200

interface IntroScreenProps {
  onComplete: () => void
}

export function IntroScreen({ onComplete }: IntroScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const flashRef     = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<BootLine[]>([])
  const cfg = useConfig()

  // Build config-aware boot lines once cfg loads
  const bootLines: BootLine[] = DEFAULT_BOOT_LINES.map((l, i) => {
    if (i === 9 && cfg.nodes[0])
      return { ...l, text: `NODE   ·  ${cfg.nodes[0].location ?? cfg.nodes[0].id}` }
    if (i === 10 && cfg.nodes.find(n => !n.vpn && n.id !== 'local'))
      return { ...l, text: `REMOTE ·  ${cfg.nodes.find(n => !n.vpn && n.id !== 'local')?.location ?? 'CONNECTED'}` }
    if (i === 11 && cfg.nodes.find(n => n.vpn))
      return { ...l, text: `VPN    ·  ${cfg.nodes.find(n => n.vpn)?.location ?? 'ACTIVE'}` }
    return l
  })

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    bootLines.forEach((line) => {
      timers.push(setTimeout(() => {
        setLines(prev => [...prev, line])
        if (!line.text) return
        if (line.text.includes('[OK]')) sfxOk()
        else sfxTick()
      }, line.delay))
    })

    timers.push(setTimeout(() => {
      if (!flashRef.current || !containerRef.current) return
      sfxFlash()
      anime.timeline()
        .add({
          targets: flashRef.current,
          opacity: [0, 1],
          duration: 180,
          easing: 'easeInQuad',
        })
        .add({
          targets: flashRef.current,
          opacity: [1, 0],
          duration: 400,
          easing: 'easeOutQuad',
          complete: () => {
            anime({
              targets: containerRef.current,
              opacity: [1, 0],
              duration: 300,
              easing: 'easeOutQuad',
              complete: onComplete,
            })
          },
        })
    }, TOTAL_MS))

    return () => timers.forEach(clearTimeout)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onComplete, cfg.eosHost])

  return (
    <div ref={containerRef} className="intro-screen">
      <div className="intro-grid" />

      <div className="intro-content">
        <svg className="intro-corner intro-corner--tl" viewBox="0 0 50 50" fill="none">
          <polyline points="50,4 4,4 4,50" stroke="#00e5ff" strokeWidth="1.2" />
        </svg>
        <svg className="intro-corner intro-corner--tr" viewBox="0 0 50 50" fill="none">
          <polyline points="0,4 46,4 46,50" stroke="#00e5ff" strokeWidth="1.2" />
        </svg>
        <svg className="intro-corner intro-corner--bl" viewBox="0 0 50 50" fill="none">
          <polyline points="50,46 4,46 4,0" stroke="#00e5ff" strokeWidth="1.2" />
        </svg>
        <svg className="intro-corner intro-corner--br" viewBox="0 0 50 50" fill="none">
          <polyline points="0,46 46,46 46,0" stroke="#00e5ff" strokeWidth="1.2" />
        </svg>

        <div className="intro-terminal">
          {lines.map((line, i) => (
            <div
              key={i}
              className={`intro-line intro-line--${line.size}`}
              style={{ color: line.color || 'transparent' }}
            >
              {line.text || '\u00a0'}
            </div>
          ))}
          <span className="intro-cursor" />
        </div>
      </div>

      <div ref={flashRef} className="intro-flash" />
    </div>
  )
}
