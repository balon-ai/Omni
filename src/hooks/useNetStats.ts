import { useState, useEffect } from 'react'

export interface NetStats {
  hostname:   string
  platform:   string
  uptime:     number
  interfaces: Record<string, string[]>
  latency: {
    eos:     number
    gateway: number
    vpn:     number
  }
  memory: {
    total: number
    free:  number
  }
  loadavg: number[]
}

const FALLBACK: NetStats = {
  hostname:   'omni',
  platform:   '',
  uptime:     0,
  interfaces: {},
  latency:  { eos: -1, gateway: -1, vpn: -1 },
  memory:   { total: 0, free: 0 },
  loadavg:  [0, 0, 0],
}

export function useNetStats(): NetStats {
  const [stats, setStats] = useState<NetStats>(FALLBACK)

  useEffect(() => {
    // Initial fetch
    window.omni?.net.getStats().then(s => setStats(s as NetStats)).catch(() => {})

    // Live push every 3s from main process
    const unsub = window.omni?.net.onPush((data) => {
      setStats(data as NetStats)
    })

    return () => { unsub?.() }
  }, [])

  return stats
}

export function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function fmtBytes(bytes: number): string {
  if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + ' GB'
  if (bytes > 1e6) return (bytes / 1e6).toFixed(0) + ' MB'
  return (bytes / 1e3).toFixed(0) + ' KB'
}

export function latencyColor(ms: number): string {
  if (ms < 0)   return 'var(--c-muted)'
  if (ms < 10)  return 'var(--c-accent)'
  if (ms < 50)  return 'var(--c-accent)'
  if (ms < 150) return 'var(--c-gold)'
  return 'var(--c-gold)'
}
