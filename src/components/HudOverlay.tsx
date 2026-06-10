import { useEffect, useRef, useState } from 'react'
import anime from 'animejs'
import { useNetStats, latencyColor } from '@/hooks/useNetStats'
import { useConfig } from '@/hooks/useConfig'
import { subscribe } from '@/hooks/ticker'

// ── Constants ─────────────────────────────────────────────────────────────────
const CX = 370, CY = 370          // center of 740×740 viewBox
// Orb projected radius ≈ 189 viewBox units (fov=50, z=4.2, unit sphere)
const R1  = 205                    // lock ring — just outside orb
const R2  = 240                    // measurement arcs
const R3  = 280                    // scan arc
const R4  = 340                    // outer decorative arc segments

const BLUE     = '#00e5ff'
const GOLD     = '#00b4d8'
const WHITE    = '#d0f4ff'
const MUTED    = 'rgba(160,220,240,0.42)'
const FONT     = 'Share Tech Mono, Courier New, monospace'

// ── Math helpers ──────────────────────────────────────────────────────────────
function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg - 90) * (Math.PI / 180)
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s   = polar(cx, cy, r, startDeg)
  const e   = polar(cx, cy, r, endDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`
}

// ── Glitch hook ───────────────────────────────────────────────────────────────
function useGlitch(text: string, intervalMs = 8000) {
  const [display, setDisplay] = useState(text)
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/\\:·—'
  useEffect(() => {
    const run = () => {
      let iter = 0
      const maxIter = text.length * 2.5
      const id = setInterval(() => {
        setDisplay(text.split('').map((ch, i) => {
          if (' /·'.includes(ch)) return ch
          if (i < iter / 2.5) return ch
          return CHARS[Math.floor(Math.random() * CHARS.length)]
        }).join(''))
        iter++
        if (iter > maxIter) clearInterval(id)
      }, 28)
    }
    run()
    const t = setInterval(run, intervalMs)
    return () => clearInterval(t)
  }, [text, intervalMs])
  return display
}

// ── Ping history hook ─────────────────────────────────────────────────────────
function usePingHistory(current: number, size = 10) {
  const [history, setHistory] = useState<number[]>(Array(size).fill(0))
  useEffect(() => {
    if (current > 0) {
      setHistory(h => [...h.slice(1), current])
    }
  }, [current, size])
  return history
}

// ── Scan tick on arc ──────────────────────────────────────────────────────────
function ScanTick({ cx, cy, r, periodS = 8 }: { cx: number; cy: number; r: number; periodS?: number }) {
  const ref = useRef<SVGGElement>(null)
  useEffect(() => {
    const unsub = subscribe((elapsed) => {
      if (!ref.current) return
      const t   = (elapsed % periodS) / periodS
      const deg = -120 + t * 240         // travels the 240° arc
      const p   = polar(cx, cy, r, deg)
      const children = ref.current.children
      if (children[0]) {
        ;(children[0] as SVGElement).setAttribute('cx', String(p.x))
        ;(children[0] as SVGElement).setAttribute('cy', String(p.y))
      }
      // Trail — 3 fading dots behind
      const TRAIL = [0.04, 0.09, 0.15]
      for (let i = 0; i < TRAIL.length; i++) {
        const td  = -120 + ((elapsed % periodS - TRAIL[i] * periodS + periodS) % periodS) / periodS * 240
        const tp  = polar(cx, cy, r, td)
        const el  = children[i + 1] as SVGElement | undefined
        if (el) {
          el.setAttribute('cx', String(tp.x))
          el.setAttribute('cy', String(tp.y))
        }
      }
    })
    return unsub
  }, [cx, cy, r, periodS])

  return (
    <g ref={ref}>
      <circle cx={cx} cy={cy} r="2.5" fill={BLUE} style={{ filter: `drop-shadow(0 0 4px ${BLUE})` }} />
      <circle cx={cx} cy={cy} r="2"   fill={BLUE} opacity="0.55" />
      <circle cx={cx} cy={cy} r="1.5" fill={BLUE} opacity="0.30" />
      <circle cx={cx} cy={cy} r="1"   fill={BLUE} opacity="0.12" />
    </g>
  )
}

// ── Ring 1 — bass reactive ────────────────────────────────────────────────────
function LockRing({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const ringRef = useRef<SVGGElement>(null)

  useEffect(() => {
    // idle pulse
    anime({
      targets: ringRef.current,
      opacity: [0.55, 0.70],
      duration: 2400,
      loop: true,
      direction: 'alternate',
      easing: 'easeInOutSine',
    })
  }, [])

  const gap  = 14   // degrees cut at each cardinal
  const arcs = [
    [gap / 2,       90  - gap / 2],
    [90  + gap / 2, 180 - gap / 2],
    [180 + gap / 2, 270 - gap / 2],
    [270 + gap / 2, 360 - gap / 2],
  ]

  // Diamond at each gap
  const diamonds = [0, 90, 180, 270].map(deg => polar(cx, cy, r, deg))

  return (
    <g ref={ringRef}>
      {arcs.map(([s, e], i) => (
        <path key={i} d={describeArc(cx, cy, r, s, e)}
          stroke={BLUE} strokeWidth="1.2" fill="none" opacity="0.6" />
      ))}
      {diamonds.map((d, i) => (
        <text key={i} x={d.x} y={d.y + 3.5} textAnchor="middle"
          fill={BLUE} fontSize="7" fontFamily={FONT} opacity="0.9">◈</text>
      ))}
    </g>
  )
}

// ── Measurement arcs (Ring 2) ─────────────────────────────────────────────────
function MeasurementArcs({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  // Two opposing 120° arcs: top-left (210→330) and bottom-right (30→150)
  const ticks = Array.from({ length: 25 }, (_, i) => {
    const deg   = 210 + i * 5
    const isMaj = i % 6 === 0
    const inner = polar(cx, cy, r - (isMaj ? 7 : 3), deg)
    const outer = polar(cx, cy, r, deg)
    return { inner, outer, isMaj, deg }
  })
  const ticks2 = Array.from({ length: 25 }, (_, i) => {
    const deg   = 30 + i * 5
    const isMaj = i % 6 === 0
    const inner = polar(cx, cy, r - (isMaj ? 7 : 3), deg)
    const outer = polar(cx, cy, r, deg)
    return { inner, outer, isMaj, deg }
  })

  return (
    <g opacity="0.22">
      <path d={describeArc(cx, cy, r, 210, 330)} stroke={BLUE} strokeWidth="0.6" fill="none" />
      <path d={describeArc(cx, cy, r,  30, 150)} stroke={BLUE} strokeWidth="0.6" fill="none" />
      {[...ticks, ...ticks2].map((t, i) => (
        <line key={i}
          x1={t.inner.x} y1={t.inner.y} x2={t.outer.x} y2={t.outer.y}
          stroke={BLUE} strokeWidth={t.isMaj ? 0.9 : 0.4}
        />
      ))}
      {[...ticks, ...ticks2].filter(t => t.isMaj).map((t, i) => {
        const lp = polar(cx, cy, r - 12, t.deg)
        return (
          <text key={i} x={lp.x} y={lp.y + 2.5} textAnchor="middle"
            fill={BLUE} fontSize="5" fontFamily={FONT} opacity="0.7">
            {t.deg % 360}
          </text>
        )
      })}
    </g>
  )
}

// ── Outer decorative arc segments (Ring 4) ────────────────────────────────────
function OuterArcs({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const segments = [
    { start: 30,  end: 80,  label: 'SYS'   },
    { start: 100, end: 150, label: 'NET'   },
    { start: 210, end: 260, label: 'AUDIO' },
    { start: 280, end: 330, label: 'PROC'  },
  ]
  return (
    <g opacity="0.13">
      {segments.map((s, i) => {
        const mid = polar(cx, cy, r + 8, (s.start + s.end) / 2)
        return (
          <g key={i}>
            <path d={describeArc(cx, cy, r, s.start, s.end)}
              stroke={BLUE} strokeWidth="1.2" fill="none" />
            <text x={mid.x} y={mid.y + 2} textAnchor="middle"
              fill={BLUE} fontSize="5.5" fontFamily={FONT} letterSpacing="0.15em">
              {s.label}
            </text>
          </g>
        )
      })}
    </g>
  )
}

// ── Radial arm ────────────────────────────────────────────────────────────────
interface ArmProps {
  deg: number
  armLen: number
  elbowLen: number
  side: 'left' | 'right' | 'center-up' | 'center-down'
  children: React.ReactNode
}

function RadialArm({ deg, armLen, elbowLen, side, children }: ArmProps) {
  const origin  = polar(CX, CY, R1 + 2, deg)
  const armEnd  = polar(CX, CY, R1 + armLen, deg)

  let elbow = { x: armEnd.x, y: armEnd.y }
  if (side === 'left')        elbow = { x: armEnd.x - elbowLen, y: armEnd.y }
  if (side === 'right')       elbow = { x: armEnd.x + elbowLen, y: armEnd.y }
  if (side === 'center-up')   elbow = { x: armEnd.x, y: armEnd.y - elbowLen }
  if (side === 'center-down') elbow = { x: armEnd.x, y: armEnd.y + elbowLen }

  const textAnchor = side === 'right' ? 'start' : side === 'left' ? 'end' : 'middle'
  const dataX = side === 'right' ? elbow.x + 4 : side === 'left' ? elbow.x - 4 : elbow.x
  const dataY = side === 'center-up' ? elbow.y - 4 : side === 'center-down' ? elbow.y + 4 : elbow.y

  return (
    <g className="hud-arm">
      {/* Radial stem */}
      <line x1={origin.x} y1={origin.y} x2={armEnd.x} y2={armEnd.y}
        stroke={BLUE} strokeWidth="0.6" opacity="0.45" />
      {/* Elbow rule */}
      {elbowLen > 0 && (
        <line x1={armEnd.x} y1={armEnd.y} x2={elbow.x} y2={elbow.y}
          stroke={BLUE} strokeWidth="0.6" opacity="0.45" />
      )}
      {/* Origin dot */}
      <circle cx={origin.x} cy={origin.y} r="1.5" fill={BLUE} opacity="0.7" />
      {/* Data block — textAnchor set as attribute so all child text inherits */}
      <g transform={`translate(${dataX}, ${dataY})`} textAnchor={textAnchor as 'start' | 'end' | 'middle'}>
        {children}
      </g>
    </g>
  )
}

// ── Ping bar graph ────────────────────────────────────────────────────────────
function PingBars({ history, align }: { history: number[]; align: 'left' | 'right' }) {
  const max   = Math.max(...history, 1)
  const W     = 3, GAP = 1.5, H = 10
  const total = history.length * (W + GAP)
  const ox    = align === 'right' ? 0 : -total

  return (
    <g>
      {history.map((v, i) => {
        const h   = v > 0 ? Math.max(2, (v / max) * H) : 1
        const col = latencyColor(v)
        return (
          <rect key={i}
            x={ox + i * (W + GAP)} y={H - h}
            width={W} height={h}
            fill={col} opacity={v > 0 ? 0.8 : 0.15}
            rx="0.5"
          />
        )
      })}
    </g>
  )
}

// ── Status dot ────────────────────────────────────────────────────────────────
function StatusDot({ ok }: { ok: boolean }) {
  const ref = useRef<SVGCircleElement>(null)
  useEffect(() => {
    if (!ref.current) return
    anime({
      targets: ref.current,
      opacity: [1, 0.3],
      duration: ok ? 1200 : 400,
      loop: true,
      direction: 'alternate',
      easing: 'easeInOutSine',
    })
  }, [ok])
  return <circle ref={ref} cx="0" cy="0" r="3" fill={ok ? BLUE : 'var(--c-danger)'}
    style={{ filter: `drop-shadow(0 0 4px ${ok ? BLUE : '#ff4040'})` }} />
}

// ── Main HUD ──────────────────────────────────────────────────────────────────
export function HudOverlay() {
  const svgRef       = useRef<SVGSVGElement>(null)
  const ringGroupRef = useRef<SVGGElement>(null)
  const stats    = useNetStats()
  const cfg      = useConfig()
  const sysId    = useGlitch('ARCHIMEDES', 8000)
  const pingHist = usePingHistory(stats.latency.eos)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Staggered entrance
  useEffect(() => {
    if (!svgRef.current) return
    const svg = svgRef.current

    anime({
      targets: svg.querySelectorAll('.hud-ring'),
      strokeDashoffset: [anime.setDashoffset, 0],
      duration: 1000,
      delay: anime.stagger(180),
      easing: 'easeInOutQuad',
    })
    anime({
      targets: svg.querySelectorAll('.hud-arm'),
      opacity: [0, 1],
      duration: 600,
      delay: anime.stagger(100, { start: 700 }),
      easing: 'easeOutExpo',
    })
    anime({
      targets: svg.querySelectorAll('.hud-data'),
      opacity: [0, 1],
      translateY: [4, 0],
      duration: 400,
      delay: anime.stagger(80, { start: 1100 }),
      easing: 'easeOutQuad',
    })
  }, [])

  const timeStr   = now.toLocaleTimeString('en-US', { hour12: false })
  const dateStr   = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' }).toUpperCase()
  const uptimeS   = stats.uptime
  const uptimeStr = `UP ${Math.floor(uptimeS/3600)}h ${Math.floor((uptimeS%3600)/60)}m`
  const eosOnline = stats.latency.eos > 0
  const vpnActive = stats.latency.vpn > 0

  return (
    <div className="hud-overlay">
      <svg ref={svgRef} className="hud-orb-svg" viewBox="0 0 740 740" fill="none">
        {/* All rings + arms inside reactive scale group */}
        <g ref={ringGroupRef}>

        {/* ── Ring 1 — Lock ring ── */}
        <g className="hud-ring"><LockRing cx={CX} cy={CY} r={R1} /></g>

        {/* ── Ring 2 — Measurement arcs ── */}
        <g className="hud-ring"><MeasurementArcs cx={CX} cy={CY} r={R2} /></g>

        {/* ── Ring 3 — Scan arc 240° ── */}
        <g className="hud-ring">
          <path d={describeArc(CX, CY, R3, -120, 120)}
            stroke={BLUE} strokeWidth="0.5" fill="none" opacity="0.18"
            strokeDasharray="3 6" />
          <ScanTick cx={CX} cy={CY} r={R3} periodS={8} />
        </g>

        {/* ── Ring 4 — Outer decorative segments ── */}
        <OuterArcs cx={CX} cy={CY} r={R4} />

        {/* ── 12 o'clock — System identity ── */}
        <RadialArm deg={0} armLen={80} elbowLen={0} side="center-up">
          <g className="hud-data">
            <text x="0" y="-22"
              fill={BLUE} fontSize="12" fontFamily={FONT} letterSpacing="0.3em"
              style={{ filter: `drop-shadow(0 0 6px ${BLUE})` }}>
              {sysId}
            </text>
            <text x="0" y="-11"
              fill={MUTED} fontSize="5.5" fontFamily={FONT} letterSpacing="0.2em">
              {(cfg as { hud?: { subtitle?: string } }).hud?.subtitle ?? 'OMNI · NEURAL INTERFACE · v0.1'}
            </text>
            <line x1="-60" y1="-6" x2="60" y2="-6"
              stroke={BLUE} strokeWidth="0.4" opacity="0.3" />
          </g>
        </RadialArm>

        {/* ── 2 o'clock — Model ── */}
        <RadialArm deg={60} armLen={75} elbowLen={52} side="right">
          <g className="hud-data">
            <text x="0" y="-10"
              fill={MUTED} fontSize="6" fontFamily={FONT} letterSpacing="0.18em">MODEL</text>
            <text x="0" y="0"
              fill={WHITE} fontSize="9" fontFamily={FONT} letterSpacing="0.1em">
              {(cfg as { hud?: { modelLabel?: string } }).hud?.modelLabel ?? 'MODEL'}
            </text>
            <text x="0" y="10"
              fill={GOLD} fontSize="6.5" fontFamily={FONT} letterSpacing="0.12em">
              {(cfg as { hud?: { modelNote?: string } }).hud?.modelNote ?? ''}
            </text>
          </g>
        </RadialArm>

        {/* ── 4 o'clock — Status ── */}
        <RadialArm deg={120} armLen={75} elbowLen={52} side="right">
          <g className="hud-data">
            <text x="0" y="-10"
              fill={MUTED} fontSize="6" fontFamily={FONT} letterSpacing="0.18em">STATUS</text>
            <g transform="translate(8, 2)">
              <StatusDot ok={eosOnline} />
            </g>
            <text x="18" y="2"
              fill={eosOnline ? WHITE : 'var(--c-danger)'} fontSize="9" fontFamily={FONT}>
              {eosOnline ? 'NOMINAL' : 'DEGRADED'}
            </text>
            <text x="0" y="12"
              fill={MUTED} fontSize="5.5" fontFamily={FONT} letterSpacing="0.12em">
              ALL SYSTEMS
            </text>
          </g>
        </RadialArm>

        {/* ── 6 o'clock — Clock ── */}
        <RadialArm deg={180} armLen={78} elbowLen={0} side="center-down">
          <g className="hud-data">
            <line x1="-38" y1="6" x2="38" y2="6"
              stroke={BLUE} strokeWidth="0.4" opacity="0.3" />
            <text x="0" y="20" textAnchor="middle"
              fill={WHITE} fontSize="17" fontFamily={FONT} letterSpacing="0.08em">
              {timeStr}
            </text>
            <text x="0" y="31" textAnchor="middle"
              fill={MUTED} fontSize="6" fontFamily={FONT} letterSpacing="0.2em">
              {dateStr}
            </text>
            <text x="0" y="41" textAnchor="middle"
              fill={MUTED} fontSize="5.5" fontFamily={FONT} letterSpacing="0.15em" opacity="0.6">
              {uptimeStr}
            </text>
          </g>
        </RadialArm>

        {/* ── 8 o'clock — Remote node ── */}
        <RadialArm deg={240} armLen={75} elbowLen={52} side="left">
          <g className="hud-data">
            <text x="0" y="-10"
              fill={MUTED} fontSize="6" fontFamily={FONT} letterSpacing="0.18em">
              {cfg.nodes.find(n => n.id === 'remote' || (!n.vpn && n.id !== 'local'))?.label ?? 'REMOTE'}
              {cfg.eosHost ? ` · ${cfg.eosHost}` : ''}
            </text>
            <text x="0" y="0"
              fill={eosOnline ? latencyColor(stats.latency.eos) : 'var(--c-danger)'}
              fontSize="9" fontFamily={FONT} letterSpacing="0.1em">
              {eosOnline ? `${stats.latency.eos.toFixed(1)}ms` : 'OFFLINE'}
            </text>
            <g transform="translate(-46, 5)">
              <PingBars history={pingHist} align="right" />
            </g>
          </g>
        </RadialArm>

        {/* ── 10 o'clock — VPN ── */}
        <RadialArm deg={300} armLen={75} elbowLen={52} side="left">
          <g className="hud-data">
            <text x="0" y="-10"
              fill={MUTED} fontSize="6" fontFamily={FONT} letterSpacing="0.18em">
              {cfg.nodes.find(n => n.vpn)?.label ?? 'VPN'}
              {cfg.nodes.find(n => n.vpn)?.location ? ` · ${cfg.nodes.find(n => n.vpn)!.location.split(',')[0].toUpperCase()}` : ''}
            </text>
            <text x="0" y="0"
              fill={vpnActive ? BLUE : MUTED} fontSize="9" fontFamily={FONT} letterSpacing="0.08em">
              {vpnActive ? 'ACTIVE ⟁' : 'CHECKING'}
            </text>
            <text x="0" y="10"
              fill={MUTED} fontSize="5.5" fontFamily={FONT} letterSpacing="0.12em" opacity="0.7">
              {vpnActive
                ? (cfg.nodes.find(n => n.vpn)?.location ?? 'CONNECTED')
                : '—'}
            </text>
          </g>
        </RadialArm>

        </g>{/* end reactive scale group */}
      </svg>
    </div>
  )
}
