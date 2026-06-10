import { useEffect, useRef } from 'react'
import anime from 'animejs'
import { GlobeView } from './GlobeView'
import { MicMonitor } from './MicMonitor'
import { useNetStats, fmtUptime, fmtBytes, latencyColor } from '@/hooks/useNetStats'
import { useConfig } from '@/hooks/useConfig'
import { subscribe } from '@/hooks/ticker'

// ── Animated topology map ─────────────────────────────────────────────────────
// Colors: Stark blue (#00e5ff) for THIS NODE + INTERNET, gold (#ffb700) for EOS, orange (#ff6030) for MULLVAD

const TOPO_BLUE   = '#00e5ff'
const TOPO_GOLD   = '#48cae4'
const TOPO_ORANGE = '#0099bb'
const TOPO_OFF    = '#0d2226'

function TopologyMap({ latEos, latVpn }: { latEos: number; latVpn: number }) {
  const svgRef      = useRef<SVGSVGElement>(null)
  const eosOnline   = latEos > 0
  const vpnOnline   = latVpn > 0

  // Packet dot refs — direct DOM, no React re-renders per frame
  const eosPktRef   = useRef<SVGCircleElement>(null)
  const vpnPktRef   = useRef<SVGCircleElement>(null)
  const netPktRef     = useRef<SVGCircleElement>(null)

  // Trail refs (3 trailing dots per packet, decreasing opacity)
  const eosTrailRef = useRef<SVGGElement>(null)
  const vpnTrailRef = useRef<SVGGElement>(null)
  const netTrailRef = useRef<SVGGElement>(null)

  useEffect(() => {
    let t = 0

    function lerp(x1: number, y1: number, x2: number, y2: number, u: number) {
      const uc = Math.max(0, Math.min(1, u))
      return { x: x1 + (x2 - x1) * uc, y: y1 + (y2 - y1) * uc }
    }

    function setTrail(g: SVGGElement | null, x1: number, y1: number, x2: number, y2: number, t: number) {
      if (!g) return
      const circles = g.children
      const TRAIL_GAP   = 0.055
      for (let i = 0; i < circles.length; i++) {
        const c   = circles[i] as SVGCircleElement
        const tu  = Math.max(0, t - (i + 1) * TRAIL_GAP)
        const pos = lerp(x1, y1, x2, y2, tu)
        c.setAttribute('cx', String(pos.x))
        c.setAttribute('cy', String(pos.y))
        c.setAttribute('opacity', String(0.45 - i * 0.13))
      }
    }

    const unsub = subscribe(() => {
      t = (t + 0.005) % 1
      const t2 = (t + 0.33) % 1
      const t3 = (t + 0.66) % 1

      // EOS edge: THIS NODE → EOS
      const p1 = lerp(100, 55, 40, 90, t)
      if (eosPktRef.current) {
        eosPktRef.current.setAttribute('cx', String(p1.x))
        eosPktRef.current.setAttribute('cy', String(p1.y))
      }
      setTrail(eosTrailRef.current, 100, 55, 40, 90, t)

      // MULLVAD edge: THIS NODE → MULLVAD
      const p2 = lerp(100, 55, 160, 90, t2)
      if (vpnPktRef.current) {
        vpnPktRef.current.setAttribute('cx', String(p2.x))
        vpnPktRef.current.setAttribute('cy', String(p2.y))
      }
      setTrail(vpnTrailRef.current, 100, 55, 160, 90, t2)

      // INTERNET edge: THIS NODE → INTERNET
      const p3 = lerp(100, 55, 100, 20, t3)
      if (netPktRef.current) {
        netPktRef.current.setAttribute('cx', String(p3.x))
        netPktRef.current.setAttribute('cy', String(p3.y))
      }
      setTrail(netTrailRef.current, 100, 55, 100, 20, t3)
    })
    return unsub
  }, [])

  // Pulse ring animation
  useEffect(() => {
    if (!svgRef.current) return
    anime({
      targets: svgRef.current.querySelectorAll('.topo-pulse'),
      r: [5, 12],
      opacity: [0.7, 0],
      duration: 1800,
      delay: anime.stagger(500),
      loop: true,
      easing: 'easeOutQuad',
    })
  }, [])

  const eosStroke     = eosOnline     ? TOPO_GOLD   : TOPO_OFF
  const vpnStroke = vpnOnline ? TOPO_ORANGE : TOPO_OFF

  return (
    <svg ref={svgRef} className="topo-map" viewBox="0 0 200 118" fill="none">

      {/* ── Edge paths — use path so strokeDashoffset animates properly ── */}
      <path d="M100,55 L40,90"  stroke={eosStroke}     strokeWidth="0.7" strokeDasharray="3 4" opacity="0.45" />
      <path d="M100,55 L160,90" stroke={vpnStroke} strokeWidth="0.7" strokeDasharray="3 4" opacity="0.45" />
      <path d="M100,55 L100,20" stroke={TOPO_BLUE}     strokeWidth="0.7" strokeDasharray="3 4" opacity="0.45" />

      {/* ── EOS trail + packet ── */}
      {eosOnline && (
        <>
          <g ref={eosTrailRef}>
            <circle cx="100" cy="55" r="1.2" fill={TOPO_GOLD} />
            <circle cx="100" cy="55" r="1.0" fill={TOPO_GOLD} />
            <circle cx="100" cy="55" r="0.8" fill={TOPO_GOLD} />
          </g>
          <circle ref={eosPktRef} cx="100" cy="55" r="2"
            fill={TOPO_GOLD} style={{ filter: `drop-shadow(0 0 4px ${TOPO_GOLD})` }} />
        </>
      )}

      {/* ── VPN trail + packet ── */}
      {vpnOnline && (
        <>
          <g ref={vpnTrailRef}>
            <circle cx="100" cy="55" r="1.2" fill={TOPO_ORANGE} />
            <circle cx="100" cy="55" r="1.0" fill={TOPO_ORANGE} />
            <circle cx="100" cy="55" r="0.8" fill={TOPO_ORANGE} />
          </g>
          <circle ref={vpnPktRef} cx="100" cy="55" r="2"
            fill={TOPO_ORANGE} style={{ filter: `drop-shadow(0 0 4px ${TOPO_ORANGE})` }} />
        </>
      )}

      {/* ── INTERNET trail + packet ── */}
      <g ref={netTrailRef}>
        <circle cx="100" cy="55" r="1.2" fill={TOPO_BLUE} />
        <circle cx="100" cy="55" r="1.0" fill={TOPO_BLUE} />
        <circle cx="100" cy="55" r="0.8" fill={TOPO_BLUE} />
      </g>
      <circle ref={netPktRef} cx="100" cy="55" r="2"
        fill={TOPO_BLUE} style={{ filter: `drop-shadow(0 0 4px ${TOPO_BLUE})` }} />

      {/* ── THIS NODE ── */}
      <circle className="topo-pulse" cx="100" cy="55" r="5" fill="none"
        stroke={TOPO_BLUE} strokeWidth="0.6" opacity="0" />
      <circle cx="100" cy="55" r="5.5" fill="#020d1c" stroke={TOPO_BLUE} strokeWidth="1.2" />
      <circle cx="100" cy="55" r="2.2" fill={TOPO_BLUE}
        style={{ filter: `drop-shadow(0 0 5px ${TOPO_BLUE})` }} />
      <text x="100" y="47.5" textAnchor="middle" fill={TOPO_BLUE}
        fontSize="5.5" fontFamily="Share Tech Mono" letterSpacing="0.8">THIS NODE</text>

      {/* ── EOS ── */}
      <circle className="topo-pulse" cx="40" cy="90" r="5" fill="none"
        stroke={eosStroke} strokeWidth="0.6" opacity="0" />
      <circle cx="40" cy="90" r="4.5" fill="#020d1c" stroke={eosStroke} strokeWidth="1" />
      <circle cx="40" cy="90" r="1.8" fill={eosStroke}
        style={eosOnline ? { filter: `drop-shadow(0 0 4px ${TOPO_GOLD})` } : {}} />
      <text x="40" y="100.5" textAnchor="middle" fill={eosStroke}
        fontSize="5.5" fontFamily="Share Tech Mono" letterSpacing="0.8">EOS</text>
      {eosOnline && (
        <text x="40" y="108" textAnchor="middle" fill={`${TOPO_GOLD}66`}
          fontSize="4.5" fontFamily="Share Tech Mono">{latEos.toFixed(1)}ms</text>
      )}

      {/* ── VPN ── */}
      <circle className="topo-pulse" cx="160" cy="90" r="5" fill="none"
        stroke={vpnStroke} strokeWidth="0.6" opacity="0" />
      <circle cx="160" cy="90" r="4.5" fill="#020d1c" stroke={vpnStroke} strokeWidth="1" />
      <circle cx="160" cy="90" r="1.8" fill={vpnStroke}
        style={vpnOnline ? { filter: `drop-shadow(0 0 4px ${TOPO_ORANGE})` } : {}} />
      <text x="160" y="100.5" textAnchor="middle" fill={vpnStroke}
        fontSize="5.5" fontFamily="Share Tech Mono" letterSpacing="0.8">VPN</text>
      {vpnOnline && (
        <text x="160" y="108" textAnchor="middle" fill={`${TOPO_ORANGE}66`}
          fontSize="4.5" fontFamily="Share Tech Mono">{latVpn.toFixed(1)}ms</text>
      )}

      {/* ── INTERNET ── */}
      <circle cx="100" cy="20" r="4.5" fill="#020d1c"
        stroke={TOPO_BLUE} strokeWidth="0.7" strokeDasharray="2 2" opacity="0.6" />
      <circle cx="100" cy="20" r="1.5" fill={TOPO_BLUE} opacity="0.6" />
      <text x="100" y="13" textAnchor="middle" fill={`${TOPO_BLUE}55`}
        fontSize="5" fontFamily="Share Tech Mono" letterSpacing="0.8">INTERNET</text>

    </svg>
  )
}

// ── Data stream waveform (right sidebar decoration) ───────────────────────────
function DataWave({ color = '#00e5ff', height = 28 }: { color?: string; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    let W = 0
    const H = height
    let offset = 0
    let unsub: (() => void) | null = null

    function startDraw(width: number) {
      if (width === W || width === 0) return
      W = width
      canvas!.width  = W
      canvas!.height = H

      if (unsub) unsub()
      unsub = subscribe(() => {
        ctx.clearRect(0, 0, W, H)
        ctx.beginPath()
        ctx.strokeStyle = color
        ctx.lineWidth   = 1
        ctx.shadowColor = color
        ctx.shadowBlur  = 4
        for (let x = 0; x <= W; x++) {
          const y = H / 2
            + Math.sin((x + offset) * 0.06) * H * 0.18
            + Math.sin((x + offset) * 0.13) * H * 0.10
            + Math.sin((x + offset) * 0.27) * H * 0.05
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.shadowBlur = 0
        offset += 1.8
      })
    }

    // Use ResizeObserver so we get the real width after layout
    const ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width)
      startDraw(w)
    })
    ro.observe(canvas)

    // Fallback: try immediately in case already laid out
    if (canvas.offsetWidth > 0) startDraw(canvas.offsetWidth)

    return () => {
      ro.disconnect()
      unsub?.()
    }
  }, [color, height])

  return <canvas ref={canvasRef} className="data-wave" style={{ height }} />
}

// ── Animated node dot ─────────────────────────────────────────────────────────
function PulseDot({ online }: { online: boolean }) {
  const dotRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!dotRef.current || !online) return
    anime({
      targets: dotRef.current,
      boxShadow: [
        '0 0 4px var(--c-teal)',
        '0 0 10px var(--c-teal), 0 0 20px rgba(0,229,200,0.3)',
        '0 0 4px var(--c-teal)',
      ],
      duration: 2000,
      loop: true,
      easing: 'easeInOutSine',
    })
  }, [online])
  return <span ref={dotRef} className={`sb-node-dot ${online ? 'sb-node-dot--on' : 'sb-node-dot--off'}`} />
}

// ── Animated service badge ────────────────────────────────────────────────────
function LiveBadge() {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!ref.current) return
    anime({
      targets: ref.current,
      opacity: [1, 0.35, 1],
      duration: 2200,
      loop: true,
      delay: Math.random() * 1000,
      easing: 'easeInOutSine',
    })
  }, [])
  return <span ref={ref} className="sb-service-badge">LIVE</span>
}

// ── Sidebar shared sub-components ─────────────────────────────────────────────
function Divider() {
  return <div className="sb-divider" />
}

function SbRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="sb-row">
      <span className="sb-row-label">{label}</span>
      <span className={`sb-row-value ${accent ? 'sb-row-value--accent' : ''}`}>{value}</span>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="globe-legend-row">
      <span className="globe-legend-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <span className="globe-legend-label">{label}</span>
    </div>
  )
}

function NodeStatusRow({ id, ip, status, ping, vpn }: {
  id: string; ip: string; status: string; ping: number; vpn?: boolean
}) {
  const online = status === 'ONLINE' || status === 'ACTIVE'
  return (
    <div className="sb-node-row">
      <PulseDot online={online} />
      <div className="sb-node-info">
        <span className="sb-node-id">{id}{vpn ? ' ⟁' : ''}</span>
        <span className="sb-node-ip">{ip}</span>
      </div>
      <div className="sb-node-right">
        <span className="sb-node-status" style={{ color: online ? 'var(--c-accent)' : 'var(--c-gold)' }}>{status}</span>
        {ping > 0  && <span className="sb-node-ping" style={{ color: latencyColor(ping) }}>{ping.toFixed(1)}ms</span>}
        {ping === 0 && <span className="sb-node-ping" style={{ color: 'var(--c-teal)' }}>LOCAL</span>}
      </div>
    </div>
  )
}

function LatencyBar({ label, ms, max }: { label: string; ms: number; max: number }) {
  const pct = ms > 0 ? Math.min((ms / max) * 100, 100) : 0
  const col = latencyColor(ms)
  return (
    <div className="sb-lat-row">
      <span className="sb-row-label">{label}</span>
      <div className="sb-lat-bar-wrap">
        <div className="sb-lat-bar" style={{ width: `${pct}%`, background: col, boxShadow: `0 0 6px ${col}` }} />
      </div>
      <span className="sb-lat-value" style={{ color: col }}>
        {ms > 0 ? `${ms.toFixed(1)}ms` : '—'}
      </span>
    </div>
  )
}

function ServiceRow({ label, port, host }: { label: string; port: number; host: string }) {
  return (
    <div className="sb-row">
      <span className="sb-row-label">{label}</span>
      <span className="sb-service-port">{host}:{port}</span>
      <LiveBadge />
    </div>
  )
}

// ── Left sidebar ──────────────────────────────────────────────────────────────
export function LeftSidebar() {
  const panelRef = useRef<HTMLDivElement>(null)
  const stats    = useNetStats()
  const cfg      = useConfig()

  useEffect(() => {
    if (!panelRef.current) return
    anime({
      targets: panelRef.current.querySelectorAll('.sb-section, .sb-row'),
      opacity: [0, 1],
      translateX: [-20, 0],
      duration: 800,
      delay: anime.stagger(50, { start: 250 }),
      easing: 'easeOutExpo',
    })
  }, [])

  // Detect VPN tunnel IPs (10.x.x.x private range) and LAN IPs dynamically
  // — no hardcoded interface names
  const allIfaces = Object.values(stats.interfaces).flat()
  const vpnIPs = allIfaces.filter(ip =>
    /^10\.\d+\.\d+\.\d+$/.test(ip) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(ip)
  )
  const lanIPs = allIfaces.filter(ip =>
    /^192\.168\.\d+\.\d+$/.test(ip)
  )

  return (
    <aside ref={panelRef} className="sidebar sidebar--left">

      <div className="sb-section sb-globe-wrap">
        <div className="sb-section-header">
          <span className="sb-section-icon">◈</span>
          <span>NETWORK GLOBE</span>
        </div>
        <GlobeView />
        <div className="globe-legend">
          <LegendDot color="var(--c-accent)" label="THIS NODE" />
          <LegendDot color="var(--c-teal)"   label="EOS" />
          <LegendDot color="#7b61ff"          label="VPN EXIT" />
        </div>
      </div>

      <Divider />

      <div className="sb-section">
        <div className="sb-section-header">
          <span className="sb-section-icon">⬡</span>
          <span>WIREGUARD MESH</span>
        </div>
        <TopologyMap latEos={stats.latency.eos} latVpn={stats.latency.vpn} />
      </div>

      <Divider />

      <div className="sb-section">
        <div className="sb-section-header">
          <span className="sb-section-icon">◻</span>
          <span>INTERFACES</span>
        </div>
        <div className="sb-row-group">
          <SbRow label="TUNNEL" value={vpnIPs[0]  ?? '—'} accent />
          <SbRow label="LAN"    value={lanIPs[0] ?? '—'} />
          <SbRow label="VPN EXIT"  value={cfg.nodes.find(n => n.vpn)?.location ?? '—'} />
          <SbRow label="UPTIME"    value={fmtUptime(stats.uptime)} />
        </div>
        <DataWave color="rgba(0,212,255,0.45)" height={24} />
      </div>

    </aside>
  )
}

// ── Right sidebar ─────────────────────────────────────────────────────────────
export function RightSidebar() {
  const panelRef = useRef<HTMLDivElement>(null)
  const stats    = useNetStats()
  const cfg      = useConfig()

  useEffect(() => {
    if (!panelRef.current) return
    anime({
      targets: panelRef.current.querySelectorAll('.sb-section, .sb-row'),
      opacity: [0, 1],
      translateX: [20, 0],
      duration: 800,
      delay: anime.stagger(50, { start: 300 }),
      easing: 'easeOutExpo',
    })
  }, [])

  const memUsed = stats.memory.total - stats.memory.free
  const memPct  = stats.memory.total > 0 ? (memUsed / stats.memory.total) * 100 : 0

  // Build node rows from config
  const nodeRows = cfg.nodes.map(node => ({
    id:     node.label,
    ip:     node.id === 'local' ? (cfg.network as { localIp?: string }).localIp ?? '—' : (node.id === 'eos' ? cfg.eosHost ?? '—' : '—'),
    status: node.vpn
      ? (stats.latency.vpn > 0 ? 'ACTIVE'  : 'CHECKING')
      : (node.id === 'local' ? 'ONLINE' : stats.latency.eos > 0 ? 'ONLINE' : 'OFFLINE'),
    ping:   node.vpn ? stats.latency.vpn : node.id === 'local' ? 0 : stats.latency.eos,
    vpn:    node.vpn ?? false,
  }))

  // Build service rows from config
  const serviceRows = Object.entries(cfg.eosServices)
    .filter(([, port]) => typeof port === 'number')
    .map(([name, port]) => ({ label: name.toUpperCase(), port, host: cfg.eosHost ?? '—' }))

  return (
    <aside ref={panelRef} className="sidebar sidebar--right">

      <div className="sb-section">
        <div className="sb-section-header">
          <span className="sb-section-icon">◈</span>
          <span>NODE STATUS</span>
        </div>
        <div className="sb-row-group">
          {nodeRows.length > 0
            ? nodeRows.map(n => (
                <NodeStatusRow key={n.id} id={n.id} ip={n.ip} status={n.status} ping={n.ping} vpn={n.vpn} />
              ))
            : (
                // Fallback when config hasn't loaded yet
                <NodeStatusRow id="THIS NODE" ip="—" status="CHECKING" ping={-1} />
              )
          }
        </div>
      </div>

      <Divider />

      <div className="sb-section">
        <div className="sb-section-header">
          <span className="sb-section-icon">◻</span>
          <span>LATENCY</span>
        </div>
        <div className="sb-row-group">
          <LatencyBar label="EOS"     ms={stats.latency.eos}     max={100} />
          <LatencyBar label="GATEWAY" ms={stats.latency.gateway} max={50}  />
          <LatencyBar label="VPN" ms={stats.latency.vpn} max={200} />
        </div>
        <DataWave color="rgba(0,229,200,0.4)" height={24} />
      </div>

      <Divider />

      <div className="sb-section">
        <div className="sb-section-header">
          <span className="sb-section-icon">⬡</span>
          <span>{cfg.eosHost ? 'EOS SERVICES' : 'SERVICES'}</span>
        </div>
        <div className="sb-row-group">
          {serviceRows.length > 0
            ? serviceRows.map(s => (
                <ServiceRow key={s.label} label={s.label} port={s.port as number} host={s.host} />
              ))
            : <span className="sb-row-label" style={{ opacity: 0.4 }}>NOT CONFIGURED</span>
          }
        </div>
      </div>

      <Divider />

      <div className="sb-section">
        <div className="sb-section-header">
          <span className="sb-section-icon">◻</span>
          <span>SYSTEM</span>
        </div>
        <div className="sb-row-group">
          <SbRow label="HOST" value={stats.hostname.toUpperCase()} />
          <SbRow label="LOAD" value={stats.loadavg.map(n => n.toFixed(2)).join('  ')} />
          <div className="sb-mem-row">
            <span className="sb-row-label">MEM</span>
            <div className="sb-mem-bar-wrap">
              <div className="sb-mem-bar" style={{ width: `${memPct.toFixed(0)}%` }} />
            </div>
            <span className="sb-row-value">{memPct.toFixed(0)}%</span>
          </div>
          <SbRow label="RAM" value={`${fmtBytes(memUsed)} / ${fmtBytes(stats.memory.total)}`} />
        </div>
      </div>

      <Divider />

      <div className="sb-section">
        <MicMonitor />
      </div>

    </aside>
  )
}
