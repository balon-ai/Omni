/**
 * OpenClawAdapter — persistent WebSocket connection to OpenClaw.
 * Ed25519 device signing — 174ms per call vs 1500ms CLI subprocess.
 * Full tool pipeline available — wiki, shell, browser, MCP servers.
 *
 * Implements BackendAdapter so it can be swapped for any other backend.
 */

import WebSocket from 'ws'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID, sign as ed25519Sign } from 'crypto'
import type { BackendAdapter, ChatSendResult } from './adapter.js'

const GATEWAY_URL   = 'ws://localhost:18789'
const IDENTITY_PATH = path.join(os.homedir(), '.openclaw', 'identity')
const STATE_PATH    = path.join(os.homedir(), '.openclaw', 'omni-state.json')
const PERSONA_PATH  = path.join(__dirname, '..', 'omni.persona.json')

// ── Persona ───────────────────────────────────────────────────────────────────
function loadPersona(): string {
  try {
    const p = JSON.parse(fs.readFileSync(PERSONA_PATH, 'utf8'))
    return [
      `You are speaking to ${p.userName}. Address them by name occasionally, not every response.`,
      `Tone: ${p.tone?.style ?? 'professional'}. ${(p.tone?.descriptors ?? []).join(', ')}.`,
      p.tone?.dryWit ? 'Dry wit is permitted when the moment calls for it.' : '',
      p.tone?.exclamations === false ? 'Do not exclaim. Do not express enthusiasm.' : '',
      p.tone?.markdown === false ? 'No markdown. No bullet lists. No headers.' : '',
      `Response format: ${p.responseStyle?.format ?? 'plain text'}.`,
      `Length: ${p.responseStyle?.lengthGuidance ?? 'concise'}.`,
    ].filter(Boolean).join(' ')
  } catch {
    return ''
  }
}

interface State { sessionKey?: string }

function loadState(): State {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) }
  catch { return {} }
}
function saveState(s: State) {
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)) }
  catch { /* non-fatal */ }
}
function readConfig() {
  return JSON.parse(fs.readFileSync(
    path.join(os.homedir(), '.openclaw', 'openclaw.json'), 'utf8'
  ))
}

function buildConnectParams(nonce: string) {
  const cfg      = readConfig()
  const token    = cfg?.gateway?.auth?.token ?? ''
  const identity = JSON.parse(fs.readFileSync(path.join(IDENTITY_PATH, 'device.json'), 'utf8'))
  const devAuth  = JSON.parse(fs.readFileSync(path.join(IDENTITY_PATH, 'device-auth.json'), 'utf8'))
  const devToken = devAuth?.tokens?.operator?.token ?? ''

  const scopes      = ['operator.admin','operator.read','operator.write','operator.approvals','operator.pairing']
  const signedAtMs  = Date.now()
  const payload     = ['v2', identity.deviceId, 'cli', 'cli', 'operator',
                       scopes.join(','), String(signedAtMs), token, nonce].join('|')
  const signature   = ed25519Sign(null, Buffer.from(payload), identity.privateKeyPem).toString('base64')

  return {
    minProtocol: 3, maxProtocol: 3,
    client: { id: 'cli', version: '0.1.0', platform: process.platform, mode: 'cli', instanceId: 'omni' },
    role:   'operator',
    scopes,
    caps:   ['tool-events'],
    auth:   { token, deviceToken: devToken },
    device: { id: identity.deviceId, publicKey: identity.publicKeyPem, signature, signedAt: signedAtMs, nonce },
  }
}

type EventHandler = (event: string, payload: unknown) => void

/**
 * OpenClawAdapter wraps the proprietary OpenClaw WebSocket gateway.
 * It implements BackendAdapter so `main.ts` only sees the generic interface.
 */
export class OpenClawAdapter implements BackendAdapter {
  private ws:            WebSocket | null = null
  private pending:       Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map()
  private seq            = 0
  private connected      = false
  private handlers:      Set<EventHandler> = new Set()
  private reconnTimer:   ReturnType<typeof setTimeout> | null = null
  private stopped        = false
  private defaultSessionKey: string | null = null
  private sessionCreating   = false

  start() {
    this.stopped = false
    this._connect()
  }

  stop() {
    this.stopped = true
    if (this.reconnTimer) clearTimeout(this.reconnTimer)
    this.ws?.close()
    this.ws = null
    this.connected = false
  }

  isConnected() { return this.connected }

  on(handler: EventHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  async request(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<unknown> {
    // Allow 'connect' method before connected flag is set
    if (!this.ws) throw new Error('Gateway not connected')
    if (!this.connected && method !== 'connect') throw new Error('Gateway not connected')
    const id  = String(++this.seq)
    const msg = JSON.stringify({ type: 'req', id, method, params })

    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, timeoutMs)
        : null
      this.pending.set(id, {
        resolve: v => { if (timer) clearTimeout(timer); resolve(v) },
        reject:  e => { if (timer) clearTimeout(timer); reject(e)  },
      })
      this.ws!.send(msg)
    })
  }

  private _connect() {
    if (this.stopped) return
    const ws = new WebSocket(GATEWAY_URL)
    this.ws  = ws

    ws.on('open', () => {
      console.log('[gateway] WebSocket open, waiting for challenge...')
    })

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(raw.toString()) } catch { return }

      if (msg.type === 'event') {
        const event = msg.event as string
        if (event === 'connect.challenge') {
          const nonce = (msg.payload as Record<string, string>)?.nonce ?? ''
          this._sendConnect(nonce)
          return
        }
        for (const h of this.handlers) {
          try { h(event, msg.payload) } catch { /* */ }
        }
        return
      }

      if (msg.type === 'res') {
        const m = msg as { id: string; ok: boolean; payload?: unknown; error?: { message: string } }
        const p = this.pending.get(m.id)
        if (p) {
          this.pending.delete(m.id)
          if (m.ok) p.resolve(m.payload)
          else      p.reject(new Error(m.error?.message ?? 'gateway error'))
        }
      }
    })

    ws.on('close', () => {
      this.connected = false
      this.pending.forEach(p => p.reject(new Error('Gateway disconnected')))
      this.pending.clear()
      if (!this.stopped) this.reconnTimer = setTimeout(() => this._connect(), 2000)
    })

    ws.on('error', () => { /* close fires */ })
  }

  private _sendConnect(nonce: string) {
    try {
      const params = buildConnectParams(nonce)
      this.request('connect', params, 10_000)
        .then(() => {
          this.connected = true
          console.log('[gateway] WebSocket connected (Ed25519)')
          for (const h of this.handlers) h('gateway.connected', null)
        })
        .catch(e => {
          console.error('[gateway] connect failed:', (e as Error).message)
          this.ws?.close()
        })
    } catch (e) {
      console.error('[gateway] signing failed:', e)
    }
  }

  async getOrCreateSession(): Promise<string> {
    if (this.defaultSessionKey) return this.defaultSessionKey
    if (this.sessionCreating) {
      while (this.sessionCreating) await new Promise(r => setTimeout(r, 50))
      return this.defaultSessionKey!
    }
    this.sessionCreating = true
    try {
      const state = loadState()
      if (state.sessionKey) {
        try {
          await this.request('chat.history', { sessionKey: state.sessionKey, limit: 1 })
          console.log('[gateway] reusing session:', state.sessionKey)
          this.defaultSessionKey = state.sessionKey
          return state.sessionKey
        } catch { console.log('[gateway] session invalid, creating new') }
      }
      const result = await this.request('sessions.create', {}) as { key?: string }
      const key    = result?.key ?? 'agent:main:main'
      this.defaultSessionKey = key
      saveState({ ...state, sessionKey: key })
      console.log('[gateway] created session:', key)
      return key
    } finally {
      this.sessionCreating = false
    }
  }

  async sendChat(
    text: string,
    sessionKey?: string,
    getWin?: () => Electron.BrowserWindow | null,
  ): Promise<ChatSendResult> {
    const t0 = Date.now()
    const sk = sessionKey ?? await this.getOrCreateSession()
    console.log(`[gateway] sendChat: "${text.slice(0, 60)}"`)

    function push(event: string, payload: unknown) {
      const w = getWin?.()
      if (w && !w.isDestroyed()) w.webContents.send('gateway:event', { event, payload })
      else console.log('[gateway] push FAILED:', event)
    }

    // Subscribe to session events for tool narration
    try { await this.request('sessions.subscribe', { sessionKey: sk }) } catch { /* */ }

    // Snapshot + send in parallel — both ~10ms over WebSocket
    const [lastContent] = await Promise.all([
      this.request('chat.history', { sessionKey: sk, limit: 5 }).then(before => {
        const msgs = (before as { messages?: Array<{ role: string; content: unknown }> })?.messages ?? []
        const last = [...msgs].reverse().find(m => m.role === 'assistant')
        if (!last) return null
        if (Array.isArray(last.content)) {
          const texts = (last.content as Array<{ type: string; text?: string }>)
            .filter(c => c.type === 'text' && (c.text ?? '').trim())
          return texts.map(c => c.text ?? '').join('').trim() || null
        }
        return String(last.content ?? '').trim() || null
      }).catch(() => null as string | null),

      this.request('chat.send', {
        sessionKey: sk, message: text, idempotencyKey: randomUUID(),
      }).then(() => console.log(`[gateway] sent at ${Date.now() - t0}ms`))
        .catch(e => console.error('[gateway] send failed:', e)),
    ])

    // Poll at 400ms — detect partial content growth and stream sentences as they complete.
    const deadline = Date.now() + 120_000
    let response         = ''
    let polls            = 0
    let lastToolNarrated = ''
    let lastMsgCount     = 0
    let done             = false
    let streamedUpTo     = 0
    let streamedChunks   = 0

    const dispatchNewSentences = (text: string, isFinal: boolean) => {
      const remaining = text.slice(streamedUpTo).replace(/\s+/g, ' ').trim()
      if (!remaining) return

      const TARGET     = 100
      const MAX_CHUNKS = 3

      const lines = remaining.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []
      const newChunks: string[] = []
      let cur = ''

      for (let i = 0; i < lines.length; i++) {
        const s = lines[i].trim()
        if (!s || s.length < 3) continue
        const isLast = i === lines.length - 1
        // Don't dispatch the trailing fragment unless final — it may still be growing
        if (isLast && !isFinal && !lines[i].match(/[.!?]$/)) continue
        cur = cur ? `${cur} ${s}` : s
        if (cur.length >= TARGET || (isFinal && isLast)) {
          newChunks.push(cur.trim())
          cur = ''
        }
      }
      if (isFinal && cur.trim()) newChunks.push(cur.trim())

      // Merge tail chunks if we'd exceed the worker pool
      while (newChunks.length + streamedChunks > MAX_CHUNKS) {
        const last = newChunks.pop()!
        if (newChunks.length) newChunks[newChunks.length - 1] += ' ' + last
        else { newChunks.push(last); break }
      }

      for (const chunk of newChunks) {
        push('chat.sentence', { text: chunk, sessionKey: sk })
        streamedChunks++
      }

      if (newChunks.length > 0) {
        // Advance pointer — in final mode consume everything, otherwise leave last fragment
        streamedUpTo = isFinal
          ? text.length
          : text.length - (lines[lines.length - 1]?.length ?? 0)
      }
    }

    const doPoll = async () => {
      if (done || Date.now() > deadline) return
      polls++
      try {
        const after = await this.request('chat.history', { sessionKey: sk, limit: 10 }) as {
          messages?: Array<{ role: string; content: unknown }>
        }
        const msgs = after?.messages ?? []

        if (msgs.length > lastMsgCount) {
          lastMsgCount = msgs.length
          for (const m of msgs.slice(-3)) {
            if (m.role === 'assistant' && Array.isArray(m.content)) {
              const toolCalls = (m.content as Array<{ type: string; name?: string; arguments?: unknown }>)
                .filter(c => c.type === 'toolCall')
              for (const tc of toolCalls) {
                const narration = narrateTool(tc.name ?? '', tc.arguments)
                if (narration && narration !== lastToolNarrated) {
                  push('chat.sentence', { text: narration, sessionKey: sk, isNarration: true })
                  lastToolNarrated = narration
                }
              }
            }
          }
        }

        let content = ''
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]
          if (m.role !== 'assistant') continue
          if (Array.isArray(m.content)) {
            const texts = (m.content as Array<{ type: string; text?: string }>)
              .filter(c => c.type === 'text' && (c.text ?? '').trim())
            content = texts.map(c => c.text ?? '').join('').trim()
          } else { content = String(m.content ?? '').trim() }
          break
        }

        if (content && content !== lastContent) {
          // Stream any new complete sentences as the response grows
          if (content.length > streamedUpTo + 100) {
            dispatchNewSentences(content, false)
          }
          response = content
          done     = true
          console.log(`[gateway] response at ${Date.now() - t0}ms (poll ${polls})`)
        }
      } catch { /* retry */ }
    }

    await new Promise<void>(resolve => {
      doPoll()
      const interval = setInterval(async () => {
        if (done || Date.now() > deadline) { clearInterval(interval); resolve(); return }
        doPoll()
      }, 400)
      setTimeout(() => { clearInterval(interval); resolve() }, 120_000)
    })

    if (response) {
      // Split into at most MAX_CHUNKS — all fire in parallel against 3 workers.
      // Any mid-poll streaming already dispatched is included in streamedChunks.
      if (streamedUpTo < response.length) {
        dispatchNewSentences(response, true)
      }
      console.log(`[gateway] ${streamedChunks} total chunks at ${Date.now() - t0}ms`)
      await new Promise(r => setTimeout(r, 50))
      push('chat.response', { text: response, sessionKey: sk })
    }

    return { sessionKey: sk, response }
  }
}


function narrateTool(name: string, args: unknown): string | null {
  const a = (args ?? {}) as Record<string, unknown>
  switch (name) {
    case 'web_search':   return `Searching for ${String(a.query ?? a.q ?? '').slice(0, 50)}.`
    case 'go_to_url':
    case 'browser_navigate':
    case 'goto':         return `Opening ${String(a.url ?? '').replace(/https?:\/\//, '').split('/')[0]}.`
    case 'browser_click':
    case 'click':        return `Clicking on the page.`
    case 'browser_type':
    case 'type':
    case 'fill':         return `Filling in a field.`
    case 'extract_content':
    case 'browser_extract': return `Extracting content from the page.`
    case 'browser_screenshot': return `Checking the page.`
    case 'web_fetch':
    case 'fetch': {
      const domain = String(a.url ?? '').replace(/https?:\/\//, '').split('/')[0]
      return domain ? `Fetching ${domain}.` : null
    }
    case 'shell':        return `Running a command.`
    case 'read_file':    return `Reading a file.`
    case 'write_file':   return `Writing a file.`
    case 'wiki_search':  return `Searching memory.`
    case 'wiki_get':     return `Retrieving a note.`
    case 'wiki_apply':   return `Updating memory.`
    default:
      if (name.includes('browser') || name.includes('playwright')) return `Interacting with the browser.`
      if (name.includes('search')) return `Searching.`
      return null
  }
}

export const gateway: BackendAdapter = new OpenClawAdapter()
