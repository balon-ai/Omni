/**
 * STTProvider — interface for any speech-to-text backend.
 *
 * Built-in implementations:
 *   TogetherWhisperProvider  — Together AI hosted Whisper (default)
 *   NullSTTProvider          — always returns empty string (no STT)
 */
export interface TranscribeResult {
  text:     string
  language: string
  duration: number
}

export interface STTProvider {
  /**
   * Transcribe raw audio bytes.
   *
   * @param buffer   — raw audio bytes (WebM/OPUS from MediaRecorder)
   * @param mimeType — MIME type of the audio data
   */
  transcribe(buffer: ArrayBuffer, mimeType: string): Promise<TranscribeResult>
}

// ---------------------------------------------------------------------------
// Shared hallucination filter — all providers should use this
// ---------------------------------------------------------------------------

const HALLUCINATION_EXACT = new Set([
  'thank you', 'thanks for watching', 'thanks for listening',
  'please subscribe', 'like and subscribe', "don't forget to subscribe",
  'see you next time', 'see you in the next video',
  'bye bye', 'goodbye', 'good bye',
  "you're welcome", 'no problem',
  'subtitles by', 'captions by', 'transcribed by',
  'www.', '.com', '.org',
  'you', 'yeah', 'yes', 'no', 'okay', 'ok', 'hm', 'hmm', 'uh', 'um',
])

const HALLUCINATION_CONTAINS = [
  'thanks for watching', 'thanks for listening', 'please subscribe',
  'like and subscribe', 'subtitles by', 'captions by', 'transcribed by',
]

/**
 * Filter out known Whisper hallucinations.
 * `properNouns` can be provided per deployment (e.g. the assistant name,
 * company name, operator name) so each deployment filters its own context.
 */
export function isHallucination(text: string, properNouns: string[] = []): boolean {
  if (!text || text.length < 2) return true
  const lower = text.toLowerCase().trim().replace(/[.,!?]+$/, '')

  if (!lower.includes(' ') && lower.length < 8) return true
  if (HALLUCINATION_EXACT.has(lower)) return true

  for (const phrase of HALLUCINATION_CONTAINS) {
    if (lower.includes(phrase)) return true
  }

  for (const noun of properNouns) {
    if (lower === noun.toLowerCase()) return true
  }

  return false
}

export function fixTranscript(text: string): string {
  return text
    .replace(/\btwo thousand\s+(and\s+)?forty[\s-]two\b/gi, '2:42')
    .replace(/\btwo thousand\s+(and\s+)?forty[\s-]([a-z]+)\b/gi, (_m, _a, b) => `2:${wordToNum(b) ?? b}`)
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+thousand\s+(and\s+)?(\w+)\b/gi, (m, h, _a, min) => {
      const hour = wordToNum(h), mins = wordToNum(min)
      if (hour && mins !== null && mins < 60) return `${hour}:${String(mins).padStart(2, '0')}`
      return m
    })
    .replace(/\b([\w-]+)\s+dollars?\b/gi, (m, w) => {
      const n = wordToNum(w); return n !== null ? `$${n}` : m
    })
    .trim()
}

function wordToNum(word: string): number | null {
  const map: Record<string, number> = {
    zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,
    ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,
    seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,
    fifty:50,sixty:60,seventy:70,eighty:80,ninety:90,
    'twenty-one':21,'twenty-two':22,'twenty-three':23,'twenty-four':24,
    'twenty-five':25,'twenty-six':26,'twenty-seven':27,'twenty-eight':28,'twenty-nine':29,
    'thirty-one':31,'thirty-two':32,'thirty-three':33,'thirty-four':34,'thirty-five':35,
    'thirty-six':36,'thirty-seven':37,'thirty-eight':38,'thirty-nine':39,
    'forty-one':41,'forty-two':42,'forty-three':43,'forty-four':44,'forty-five':45,
    'forty-six':46,'forty-seven':47,'forty-eight':48,'forty-nine':49,
    'fifty-nine':59,'fifty-eight':58,'fifty-seven':57,'fifty-six':56,'fifty-five':55,
  }
  return map[word.toLowerCase()] ?? null
}

// ---------------------------------------------------------------------------
// TogetherWhisperProvider — Together AI Whisper large-v3
// ---------------------------------------------------------------------------

export interface TogetherWhisperOptions {
  apiKey:  string
  model?:  string
  /** Proper nouns for this deployment — filtered as hallucinations */
  properNouns?: string[]
}

export class TogetherWhisperProvider implements STTProvider {
  private readonly model:       string
  private readonly properNouns: string[]

  constructor(private readonly opts: TogetherWhisperOptions) {
    this.model       = opts.model ?? ''
    this.properNouns = opts.properNouns ?? []
  }

  async transcribe(buffer: ArrayBuffer, _mimeType: string): Promise<TranscribeResult> {
    const data = Buffer.from(buffer)
    if (data.length < 4000) return { text: '', language: 'en', duration: 0 }

    // Lazy-import together-ai so the rest of the module works without it
    const { default: Together } = await import('together-ai')
    const together = new Together({ apiKey: this.opts.apiKey })

    const file = new File([data], 'recording.webm', { type: 'audio/webm' })
    const response = await together.audio.transcriptions.create({
      file,
      model:           this.model,
      language:        'en',
      response_format: 'json',
    })

    const raw  = response.text?.trim() ?? ''
    const text = fixTranscript(raw)

    if (isHallucination(text, this.properNouns)) return { text: '', language: 'en', duration: 0 }
    return { text, language: 'en', duration: 0 }
  }
}

// ---------------------------------------------------------------------------
// NullSTTProvider — always returns empty string (no STT hardware/key)
// ---------------------------------------------------------------------------

export class NullSTTProvider implements STTProvider {
  async transcribe(_buffer: ArrayBuffer, _mimeType: string): Promise<TranscribeResult> {
    return { text: '', language: 'en', duration: 0 }
  }
}
