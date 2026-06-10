import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { execFile } from 'child_process'
import { fileURLToPath } from 'url'
import WebSocket from 'ws'
import { runMigrations } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Env ───────────────────────────────────────────────────────────────────────
// Vite only injects .env into the renderer — load it manually for main process.
try {
  const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  for (const line of envFile.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (match) process.env[match[1]] = match[2].trim()
  }
} catch { /* .env is optional */ }

// ── Config ────────────────────────────────────────────────────────────────────
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'omni.config.json'), 'utf8'))

const EOS_HOST     = CFG.eos?.host            as string | undefined
const TTS_PARAMS   = CFG.tts                  as Record<string, number> | undefined
const USER_NAME    = CFG.user?.name           as string
const PERSONA_PATH = path.join(__dirname, '..', 'omni.persona.json')

// ── Backend / Chat adapter ────────────────────────────────────────────────────
import { gateway } from './gateway.js'
import type { BackendAdapter } from './adapter.js'
const chatBackend: BackendAdapter = gateway

// ── TTS provider ──────────────────────────────────────────────────────────────
import {
  ChatterboxProvider,
  NullTTSProvider,
} from './tts.js'
import type { TTSProvider } from './tts.js'

let ttsProvider: TTSProvider

if (EOS_HOST && TTS_PARAMS) {
  const ttsPort = CFG.eos?.services?.chatterbox ?? 7852
  ttsProvider = new ChatterboxProvider({
    url: `http://${EOS_HOST}:${ttsPort}/tts`,
    params: {
      exaggeration:      TTS_PARAMS.exaggeration      ?? 0.4,
      cfgWeight:         TTS_PARAMS.cfgWeight          ?? 0.6,
      temperature:       TTS_PARAMS.temperature        ?? 0.7,
      repetitionPenalty: TTS_PARAMS.repetitionPenalty  ?? 1.2,
      topP:              TTS_PARAMS.topP               ?? 0.95,
      minP:              TTS_PARAMS.minP               ?? 0.05,
    },
  })
} else {
  ttsProvider = new NullTTSProvider()
  console.warn('[tts] no EOS host configured — TTS disabled (NullTTSProvider)')
}

// ── STT provider ──────────────────────────────────────────────────────────────
import {
  TogetherWhisperProvider,
  NullSTTProvider,
} from './stt.js'
import type { STTProvider } from './stt.js'

// Build proper-noun list from persona so Whisper hallucinations are deployment-specific
function loadPersonaProperNouns(): string[] {
  try {
    const p = JSON.parse(fs.readFileSync(PERSONA_PATH, 'utf8'))
    return [
      p.userName,
      p.assistantName,
      p.tone?.style,
    ].filter(Boolean) as string[]
  } catch { return [] }
}

let sttProvider: STTProvider

if (process.env.TOGETHER_API_KEY) {
  sttProvider = new TogetherWhisperProvider({
    apiKey:      process.env.TOGETHER_API_KEY,
    model:       CFG.together?.whisperModel,
    properNouns: loadPersonaProperNouns(),
  })
  console.log('[stt] TogetherWhisperProvider ready')
} else {
  sttProvider = new NullSTTProvider()
  console.warn('[stt] TOGETHER_API_KEY not set — STT disabled (NullSTTProvider)')
}

// ── Browser agent WebSocket — forward narration to renderer ──────────────────
const BROWSER_AGENT_WS  = CFG.local?.browserAgent?.ws  as string | undefined
const BROWSER_AGENT_URL = CFG.local?.browserAgent?.http as string | undefined

let browserAgentWs: WebSocket | null = null

function connectBrowserAgentWs() {
  if (!BROWSER_AGENT_WS) return
  if (browserAgentWs?.readyState === WebSocket.OPEN) return
  try {
    const ws = new WebSocket(BROWSER_AGENT_WS)
    ws.on('open', () => {
      console.log('[browser-agent] narration stream connected')
      browserAgentWs = ws
    })
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'ping') return
        if (win && !win.isDestroyed()) {
          win.webContents.send('gateway:event', {
            event:   'chat.sentence',
            payload: { text: msg.text, sessionKey: 'browser-agent', isNarration: true },
          })
        }
      } catch { /* */ }
    })
    ws.on('close', () => {
      browserAgentWs = null
      setTimeout(connectBrowserAgentWs, 3000)
    })
    ws.on('error', () => { /* retry on close */ })
  } catch { /* */ }
}

// ── GPU: optional discrete GPU offload ───────────────────────────────────────
// Only applied when OMNI_NVIDIA_PRIME=1 is set in the environment.
// Set this in .env if you have a hybrid GPU setup and want Electron
// to render on the discrete GPU via PRIME offload.
if (process.env['OMNI_NVIDIA_PRIME'] === '1') {
  process.env['__NV_PRIME_RENDER_OFFLOAD']          = '1'
  process.env['__NV_PRIME_RENDER_OFFLOAD_PROVIDER'] = 'NVIDIA-G0'
  process.env['__GLX_VENDOR_LIBRARY_NAME']          = 'nvidia'
  process.env['__VK_LAYER_NV_optimus']              = 'NVIDIA_only'
}

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const isDev = !!VITE_DEV_SERVER_URL

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#050810',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  win.once('ready-to-show', () => { win?.show() })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL(VITE_DEV_SERVER_URL!)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// ── Window controls ────────────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => win?.minimize())
ipcMain.on('window:maximize', () => {
  if (win?.isMaximized()) win.unmaximize()
  else win?.maximize()
})
ipcMain.on('window:close', () => win?.close())

// ── Network stats ──────────────────────────────────────────────────────────────

/** Async ping — never blocks the main thread. Returns -1 on failure/timeout. */
function pingAsync(host: string, timeoutMs = 1500): Promise<number> {
  return new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(-1) }, timeoutMs)
    const child = execFile(
      'ping', ['-c', '1', '-W', '1', host],
      { timeout: timeoutMs },
      (err, stdout) => {
        clearTimeout(timer)
        if (err) { resolve(-1); return }
        const m = stdout.match(/time[<=]([\d.]+)\s*ms/)
        resolve(m ? parseFloat(m[1]) : -1)
      },
    )
  })
}

function getBaseStats() {
  const ifaces = os.networkInterfaces()
  const interfaces: Record<string, string[]> = {}
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue
    interfaces[name] = addrs.map(a => a.address)
  }
  return {
    hostname:   os.hostname(),
    platform:   os.platform(),
    uptime:     os.uptime(),
    interfaces,
    memory: { total: os.totalmem(), free: os.freemem() },
    loadavg: os.loadavg(),
  }
}

async function getNetworkStats() {
  const pingTargets = CFG.network?.ping ?? {}
  const [eos, gateway, vpn] = await Promise.all([
    EOS_HOST              ? pingAsync(EOS_HOST)              : Promise.resolve(-1),
    pingTargets.gateway   ? pingAsync(pingTargets.gateway)   : Promise.resolve(-1),
    pingTargets.vpn       ? pingAsync(pingTargets.vpn)       : Promise.resolve(-1),
  ])
  return { ...getBaseStats(), latency: { eos, gateway, vpn } }
}

ipcMain.handle('net:stats', () => getNetworkStats())

// Expose the full resolved config (safe subset — no secrets) to the renderer
ipcMain.handle('config', () => ({
  userName:    USER_NAME,
  eosHost:     EOS_HOST ?? null,
  eosServices: CFG.eos?.services ?? {},
  network:     CFG.network ?? {},
  nodes:       CFG.nodes ?? [],
}))

// ── Chat / Gateway IPC ────────────────────────────────────────────────────────

chatBackend.on((event, payload) => {
  if (win && !win.isDestroyed()) {
    win.webContents.send('gateway:event', { event, payload })
  }
})

ipcMain.handle('chat:send', async (_e, { text, sessionKey }: { text: string; sessionKey?: string }) => {
  return await chatBackend.sendChat(text, sessionKey, () => win)
})

// ── Browser agent IPC ─────────────────────────────────────────────────────────
ipcMain.handle('browser:run', async (_e, { task, maxSteps }: { task: string; maxSteps?: number }) => {
  if (!BROWSER_AGENT_URL) throw new Error('Browser agent not configured')
  const res = await fetch(`${BROWSER_AGENT_URL}/run`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ task, max_steps: maxSteps ?? 20 }),
  })
  if (!res.ok) throw new Error(`Browser agent ${res.status}`)
  return await res.json()
})

ipcMain.handle('chat:history', async (_e, { sessionKey, limit = 50 }: { sessionKey?: string; limit?: number }) => {
  const sk = sessionKey ?? await chatBackend.getOrCreateSession()
  return await chatBackend.request('chat.history', { sessionKey: sk, limit })
})

ipcMain.handle('chat:session', async () => {
  return { sessionKey: await chatBackend.getOrCreateSession() }
})

ipcMain.handle('chat:abort', async (_e, { sessionKey }: { sessionKey: string }) => {
  await chatBackend.request('chat.abort', { sessionKey })
})

ipcMain.handle('gateway:status', () => ({
  connected: chatBackend.isConnected(),
}))

// ── STT IPC ───────────────────────────────────────────────────────────────────
ipcMain.handle('transcribe', async (_e, { buffer, mimeType }: { buffer: ArrayBuffer; mimeType: string }) => {
  return await sttProvider.transcribe(buffer, mimeType)
})

// ── TTS IPC ───────────────────────────────────────────────────────────────────
ipcMain.handle('tts:speak', (_e, { text }: { text: string }) => ttsProvider.speak(text))

ipcMain.on('tts:speak:async', (e, { replyChannel, args }: { replyChannel: string; args: { text: string } }) => {
  ttsProvider.speak(args.text)
    .then(value  => e.sender.send(replyChannel, { ok: true, value: Buffer.from(value) }))
    .catch(error => e.sender.send(replyChannel, { ok: false, error: String(error) }))
})

let statsInterval: ReturnType<typeof setInterval> | null = null

app.whenReady().then(() => {
  runMigrations()
  chatBackend.start()
  connectBrowserAgentWs()
  createWindow()
  statsInterval = setInterval(async () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('net:push', await getNetworkStats())
    }
  }, 3000)
})

app.on('window-all-closed', () => {
  if (statsInterval) clearInterval(statsInterval)
  chatBackend.stop()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
