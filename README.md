# Omni

An AI desktop interface built on Electron. Voice-in, voice-out. Designed for always-on use alongside a remote AI inference node.

---

## What it is

Omni is a desktop shell for AI interaction. It runs as a frameless Electron app with a HUD-style interface — a 3D globe, animated network topology, real-time system stats, and a voice pipeline that handles mic input, speech-to-text, backend chat, and text-to-speech output automatically.

The interface is fully data-driven. No IPs, names, node locations, or model identifiers are hardcoded — everything comes from `omni.config.json` and `omni.persona.json`, which are git-ignored and set per deployment.

---

## Architecture

```
electron/
  main.ts          — main process: config, IPC handlers, ping loop
  gateway.ts       — OpenClawAdapter (default BackendAdapter implementation)
  adapter.ts       — BackendAdapter interface (swap in any backend)
  tts.ts           — TTSProvider interface + ChatterboxProvider + NullTTSProvider
  stt.ts           — STTProvider interface + TogetherWhisperProvider + NullSTTProvider
  db.ts            — Drizzle/better-sqlite3 singleton + migrations
  preload.ts       — contextBridge IPC surface exposed to renderer

src/
  components/
    HudOverlay      — SVG HUD rings, radial arms, ping graph, system ID
    BlobVisualizer  — Three.js audio-reactive sphere (TTS drives deformation)
    GlobeView       — Three.js globe with node markers and arcs
    NetworkSidebar  — topology map, latency bars, node status, mic monitor
    IntroScreen     — boot sequence animation
    VoiceOrb        — state display, transcript/response text
    ActivityFeed    — live tool activity stream
    MicMonitor      — real-time mic frequency canvas
  hooks/
    useVoice        — VAD loop, recording, STT, chat, TTS queue, session
    useAudioBands   — shared mic stream singleton (one getUserMedia call)
    useNetStats     — net stats subscriber (IPC push every 3s)
    useConfig       — config singleton (one IPC call, shared across components)
    sfx             — Web Audio API HUD sounds
    ticker          — shared rAF loop
```

---

## Interfaces

Any backend, TTS engine, or STT engine can be swapped in by implementing the relevant interface.

**`BackendAdapter`** (`electron/adapter.ts`)
```ts
interface BackendAdapter {
  start(): void
  stop(): void
  isConnected(): boolean
  on(handler: (event: string, payload: unknown) => void): () => void
  sendChat(text: string, sessionKey?: string, getWin?: () => BrowserWindow | null): Promise<ChatSendResult>
  getOrCreateSession(): Promise<string>
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>
}
```

**`TTSProvider`** (`electron/tts.ts`)
```ts
interface TTSProvider {
  speak(text: string): Promise<ArrayBuffer>  // returns WAV bytes
}
```

**`STTProvider`** (`electron/stt.ts`)
```ts
interface STTProvider {
  transcribe(buffer: ArrayBuffer, mimeType: string): Promise<{ text: string; language: string; duration: number }>
}
```

---

## Setup

**Requirements:** Node 20+, Electron 35

```bash
git clone https://github.com/balon-ai/Omni.git
cd Omni
npm install
npx electron-rebuild -f -w better-sqlite3
```

**Config files** (git-ignored, must be created locally):

```bash
cp omni.config.example.json omni.config.json
cp omni.persona.example.json omni.persona.json
cp .env.example .env
```

Edit `omni.config.json`:

```json
{
  "user": { "name": "Your Name" },
  "eos": {
    "host": "YOUR_REMOTE_NODE_IP",
    "services": { "chatterbox": 7852 }
  },
  "tts": { "exaggeration": 0.4, "cfgWeight": 0.6, "temperature": 0.7, "repetitionPenalty": 1.2, "topP": 0.95, "minP": 0.05 },
  "together": { "whisperModel": "your-stt-model-id" },
  "network": { "ping": { "gateway": "192.168.1.1", "vpn": "10.8.0.1" } },
  "nodes": [
    { "id": "local",  "label": "THIS NODE", "lat": 0.0, "lon": 0.0, "location": "Your City",   "color": "#00e5ff", "r": 0.030 },
    { "id": "remote", "label": "REMOTE",    "lat": 0.0, "lon": 0.0, "location": "Remote City", "color": "#00e5ff", "r": 0.022 },
    { "id": "vpn",    "label": "VPN",       "lat": 0.0, "lon": 0.0, "location": "VPN City",    "color": "#80f0ff", "r": 0.022, "vpn": true }
  ],
  "hud": { "subtitle": "OMNI · NEURAL INTERFACE · v0.1", "modelLabel": "YOUR MODEL", "modelNote": "" }
}
```

Edit `.env`:

```
TOGETHER_API_KEY=your_key_here

# Optional — set to 1 for hybrid NVIDIA/discrete GPU setups (PRIME offload)
# OMNI_NVIDIA_PRIME=1
```

Edit `omni.persona.json` to set the assistant name, user name, and response tone.

**Run:**

```bash
npm run dev
```

---

## Database

Conversations, messages, and settings are stored locally in `omni.db` (SQLite via Drizzle ORM, git-ignored). Migrations run automatically on startup.

```bash
npm run db:generate   # generate a new migration after schema changes
npm run db:migrate    # apply migrations manually
```

---

## Providers

| Role | Default | Interface |
|---|---|---|
| Chat backend | `OpenClawAdapter` | `BackendAdapter` |
| TTS | `ChatterboxProvider` | `TTSProvider` |
| STT | `TogetherWhisperProvider` | `STTProvider` |

If `eos.host` is not set in config, TTS falls back to `NullTTSProvider` (silent).  
If `TOGETHER_API_KEY` is not set, STT falls back to `NullSTTProvider` (no transcription).

---

## Tech

- Electron 35 + Vite 6 + React 18
- Three.js — globe and blob visualizer
- Drizzle ORM + better-sqlite3 — local storage
- Anime.js — UI animations
- Web Audio API — mic VAD, TTS analysis, HUD sounds
- TanStack Router — client-side routing
