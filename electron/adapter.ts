/**
 * BackendAdapter — the contract any chat backend must satisfy.
 *
 * Omni ships with `OpenClawAdapter` as the default backend implementation.
 * Drop-in replacements (e.g. a direct REST adapter, an Ollama adapter,
 * or an OpenAI-compatible adapter) only need to implement this interface
 * and return the same event protocol.
 *
 * Events pushed to the renderer via `onEvent`:
 *   "gateway.connected"   — backend is ready
 *   "chat.sentence"       — partial text chunk ready for TTS
 *                           payload: { text, sessionKey, isNarration? }
 *   "chat.response"       — full response text
 *                           payload: { text, sessionKey }
 */

export interface ChatSendResult {
  sessionKey: string
  response:   string
}

export interface BackendAdapter {
  /** Start the adapter (open connections, authenticate, etc.). */
  start(): void

  /** Stop the adapter and free resources. */
  stop(): void

  /** Returns true when the adapter is ready to accept messages. */
  isConnected(): boolean

  /**
   * Register a listener for backend events.
   * Returns an unsubscribe function.
   */
  on(handler: (event: string, payload: unknown) => void): () => void

  /**
   * Send a chat message and stream sentences back via `on("chat.sentence")`.
   * Resolves when the full response is available.
   *
   * @param text        — user message text
   * @param sessionKey  — optional session identifier
   * @param getWin      — optional callback to obtain the BrowserWindow for IPC pushes
   */
  sendChat(
    text:       string,
    sessionKey?: string,
    getWin?:    () => Electron.BrowserWindow | null,
  ): Promise<ChatSendResult>

  /**
   * Get or create the default persistent session key.
   */
  getOrCreateSession(): Promise<string>

  /**
   * Send a raw protocol request (adapter-specific).
   * Implementations may expose this for advanced callers;
   * open-source adapters that don't have a native request/reply layer
   * should throw `new Error("not supported")`.
   */
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>
}
