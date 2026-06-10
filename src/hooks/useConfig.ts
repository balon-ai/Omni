import { useState, useEffect } from 'react'

export interface OmniNodeConfig {
  id:       string
  label:    string
  lat:      number
  lon:      number
  location: string
  color:    string
  r:        number
  vpn?:     boolean
}

export interface OmniFullConfig {
  userName:    string
  eosHost:     string | null
  eosServices: Record<string, number>
  network:     { ping?: { gateway?: string; vpn?: string } }
  nodes:       OmniNodeConfig[]
}

const FALLBACK: OmniFullConfig = {
  userName:    'User',
  eosHost:     null,
  eosServices: {},
  network:     {},
  nodes:       [],
}

// ── Module-level singleton — one IPC call, shared across all components ───────
let cached: OmniFullConfig | null = null
const listeners = new Set<(cfg: OmniFullConfig) => void>()
let fetchStarted = false

function fetchConfig() {
  if (fetchStarted) return
  fetchStarted = true
  window.omni?.config.get()
    .then(c => {
      cached = c as OmniFullConfig
      listeners.forEach(fn => fn(cached!))
      listeners.clear()
    })
    .catch(() => {
      cached = FALLBACK
      listeners.forEach(fn => fn(cached!))
      listeners.clear()
    })
}

export function useConfig(): OmniFullConfig {
  const [cfg, setCfg] = useState<OmniFullConfig>(() => cached ?? FALLBACK)

  useEffect(() => {
    // Already resolved — nothing to do
    if (cached !== null) {
      setCfg(cached)
      return
    }
    // Subscribe before fetching so we never miss the response
    listeners.add(setCfg)
    fetchConfig()
    return () => { listeners.delete(setCfg) }
  }, [])

  return cfg
}
