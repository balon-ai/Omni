// Type declarations for the context bridge
interface OmniWindow {
  minimize: () => void
  maximize: () => void
  close: () => void
}

interface OmniAPI {
  window: OmniWindow
}

declare global {
  interface Window {
    omni: OmniAPI
  }
}

export {}
