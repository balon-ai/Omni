interface OmniWindowControls {
  minimize: () => void
  maximize: () => void
  close:    () => void
}

interface NetStats {
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

interface OmniNet {
  getStats: () => Promise<NetStats>
  onPush:   (cb: (data: NetStats) => void) => () => void
}

interface ChatMessage {
  role:      'user' | 'assistant' | 'tool'
  content:   string
  id?:       string
  createdAt?: number
}

interface ChatHistory {
  messages:   ChatMessage[]
  sessionKey: string
}

interface OmniChat {
  send:       (args: { text: string; sessionKey?: string }) => Promise<{ sessionKey: string }>
  history:    (args: { sessionKey?: string; limit?: number }) => Promise<ChatHistory>
  session:    () => Promise<{ sessionKey: string }>
  abort:      (args: { sessionKey: string }) => Promise<void>
  onEvent:    (cb: (data: { event: string; payload: unknown }) => void) => () => void
  transcribe: (args: { buffer: ArrayBuffer; mimeType: string }) => Promise<{ text: string; language: string; duration: number }>
}

interface OmniGateway {
  status: () => Promise<{ connected: boolean }>
}

interface OmniTTS {
  speak: (args: { text: string }) => Promise<ArrayBuffer>
}

interface OmniNodeConfig {
  id:       string
  label:    string
  lat:      number
  lon:      number
  location: string
  color:    string
  r:        number
  vpn?:     boolean
}

interface OmniConfig {
  get: () => Promise<{
    userName:    string
    eosHost:     string | null
    eosServices: Record<string, number>
    network:     { ping?: { gateway?: string; vpn?: string } }
    nodes:       OmniNodeConfig[]
  }>
}

interface OmniAPI {
  window:  OmniWindowControls
  net:     OmniNet
  chat:    OmniChat
  tts:     OmniTTS
  gateway: OmniGateway
  config:  OmniConfig
}

declare interface Window {
  omni?: OmniAPI
}
