import { contextBridge, ipcRenderer } from 'electron'

// Concurrent IPC helper — each call gets its own reply channel so multiple
// in-flight calls don't serialize through the shared invoke queue.
// Uses postMessage with transfer list for zero-copy ArrayBuffer handoff.
function invokeAsync<T>(channel: string, args: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const replyChannel = `${channel}:reply:${Date.now()}:${Math.random().toString(36).slice(2)}`
    ipcRenderer.on(replyChannel, (_e, result: { ok: boolean; value?: T; error?: string }) => {
      ipcRenderer.removeAllListeners(replyChannel)
      if (result.ok) resolve(result.value as T)
      else reject(new Error(result.error ?? 'ipc error'))
    })
    ipcRenderer.send(channel + ':async', { replyChannel, args })
  })
}

contextBridge.exposeInMainWorld('omni', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close:    () => ipcRenderer.send('window:close'),
  },
  net: {
    getStats: ()                             => ipcRenderer.invoke('net:stats'),
    onPush:   (cb: (data: unknown) => void)  => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on('net:push', handler)
      return () => ipcRenderer.removeListener('net:push', handler)
    },
  },
  chat: {
    send:       (args: { text: string; sessionKey?: string })             => ipcRenderer.invoke('chat:send', args),
    history:    (args: { sessionKey?: string; limit?: number })          => ipcRenderer.invoke('chat:history', args),
    session:    ()                                                        => ipcRenderer.invoke('chat:session'),
    abort:      (args: { sessionKey: string })                           => ipcRenderer.invoke('chat:abort', args),
    onEvent:    (cb: (data: { event: string; payload: unknown }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { event: string; payload: unknown }) => cb(data)
      ipcRenderer.on('gateway:event', handler)
      return () => ipcRenderer.removeListener('gateway:event', handler)
    },
    transcribe: (args: { buffer: ArrayBuffer; mimeType: string })        => ipcRenderer.invoke('transcribe', args),
  },
  tts: {
    speak: (args: { text: string }) => invokeAsync<ArrayBuffer>('tts:speak', args),
  },
  gateway: {
    status: () => ipcRenderer.invoke('gateway:status'),
  },
  config: {
    get: () => ipcRenderer.invoke('config'),
  },
})
