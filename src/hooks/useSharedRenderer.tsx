/**
 * Single shared WebGLRenderer for the entire app.
 * Components mount their scene into a sub-viewport via setViewport/setScissor.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { subscribe } from './ticker'

interface RendererCtx {
  renderer: THREE.WebGLRenderer
}

const Ctx = createContext<RendererCtx | null>(null)

export function useSharedRenderer() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSharedRenderer must be used inside <SharedRendererProvider>')
  return ctx.renderer
}

export function SharedRendererProvider({ children }: { children: ReactNode }) {
  const [renderer, setRenderer] = useState<THREE.WebGLRenderer | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const r = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      precision: 'highp',
      stencil: false,
      depth: true,
    })
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    r.setSize(window.innerWidth, window.innerHeight)
    r.setClearColor(0x000000, 0)
    r.autoClear = false // we clear manually per viewport
    r.info.autoReset = false

    // Clear the full canvas once at the start of every frame
    // This subscriber runs before the scene subscribers (added later)
    const unsub = subscribe(() => {
      r.setScissorTest(false)
      r.clear(true, true, false)
      r.info.reset()
    })

    const onResize = () => r.setSize(window.innerWidth, window.innerHeight)
    window.addEventListener('resize', onResize)

    setRenderer(r)
    return () => {
      unsub()
      window.removeEventListener('resize', onResize)
      r.dispose()
    }
  }, [])

  return (
    <>
      {/* Single full-window canvas, pointer-events none — visuals only */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed', inset: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      {renderer && (
        <Ctx.Provider value={{ renderer }}>
          {children}
        </Ctx.Provider>
      )}
    </>
  )
}
