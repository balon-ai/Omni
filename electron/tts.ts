/**
 * TTSProvider — interface for any text-to-speech backend.
 *
 * Built-in implementations:
 *   ChatterboxProvider  — multipart/form-data to a local Chatterbox HTTP server (default)
 *   NullTTSProvider     — silent no-op, useful when no TTS node is available
 *
 * Third-party implementations (not bundled) only need to implement TTSProvider.
 */
export interface TTSProvider {
  /** Synthesise `text` and return a WAV ArrayBuffer. */
  speak(text: string): Promise<ArrayBuffer>
}

// ---------------------------------------------------------------------------
// Text normalisation helpers — shared by all providers
// ---------------------------------------------------------------------------

export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function toSpokenText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/(\d+(?:\.\d+)?)\s*°F/g, (_, n) => `${n} degrees Fahrenheit`)
    .replace(/(\d+(?:\.\d+)?)\s*°C/g, (_, n) => `${n} degrees Celsius`)
    .replace(/\$(\d[\d,]*(?:\.\d{1,2})?)/g, (_, n) => `${n.replace(/,/g, '')} dollars`)
    .replace(/(\d+(?:\.\d+)?)%/g, (_, n) => `${n} percent`)
    .replace(/#(\d+)/g, (_, n) => `number ${n}`)
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// ChatterboxProvider — the default TTS for EOS node deployments
// ---------------------------------------------------------------------------

export interface ChatterboxProviderOptions {
  /** Full URL to the Chatterbox TTS endpoint. e.g. http://YOUR_EOS_HOST:7852/tts */
  url: string
  params: {
    exaggeration:      number
    cfgWeight:         number
    temperature:       number
    repetitionPenalty: number
    topP:              number
    minP:              number
  }
}

export class ChatterboxProvider implements TTSProvider {
  constructor(private readonly opts: ChatterboxProviderOptions) {}

  async speak(text: string): Promise<ArrayBuffer> {
    const clean  = stripMarkdown(text)
    if (!clean) return new ArrayBuffer(0)
    const spoken = toSpokenText(clean)

    const boundary = `----FormBoundary${Date.now()}`
    const CRLF     = '\r\n'
    const { params } = this.opts

    function field(name: string, value: string) {
      return `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`
    }

    const body = Buffer.from(
      field('text',               spoken)                             +
      field('exaggeration',       String(params.exaggeration))       +
      field('cfg_weight',         String(params.cfgWeight))          +
      field('temperature',        String(params.temperature))        +
      field('repetition_penalty', String(params.repetitionPenalty))  +
      field('top_p',              String(params.topP))               +
      field('min_p',              String(params.minP))               +
      `--${boundary}--${CRLF}`
    )

    const res = await fetch(this.opts.url, {
      method:  'POST',
      body,
      headers: {
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
    })
    if (!res.ok) throw new Error(`TTS ${res.status}: ${this.opts.url}`)
    return res.arrayBuffer()
  }
}

// ---------------------------------------------------------------------------
// NullTTSProvider — silent no-op when TTS is not configured
// ---------------------------------------------------------------------------

export class NullTTSProvider implements TTSProvider {
  async speak(_text: string): Promise<ArrayBuffer> {
    return new ArrayBuffer(0)
  }
}
