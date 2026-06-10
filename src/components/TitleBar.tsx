import { useEffect, useRef } from 'react'
import anime from 'animejs'

export function TitleBar() {
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    anime({
      targets: barRef.current,
      opacity: [0, 1],
      duration: 600,
      easing: 'easeOutQuad',
    })
  }, [])

  return (
    <div ref={barRef} className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left">
        <span className="titlebar-logo">◈</span>
        <span className="titlebar-name">OMNI</span>
      </div>
      <div className="titlebar-drag-region" />
      <div className="titlebar-controls">
        <button className="wc-btn wc-min" onClick={() => window.omni?.window.minimize()} aria-label="Minimize">
          <span />
        </button>
        <button className="wc-btn wc-max" onClick={() => window.omni?.window.maximize()} aria-label="Maximize">
          <span />
        </button>
        <button className="wc-btn wc-close" onClick={() => window.omni?.window.close()} aria-label="Close">
          <span />
        </button>
      </div>
    </div>
  )
}
