import { createFileRoute } from '@tanstack/react-router'
import { BlobVisualizer } from '@/components/BlobVisualizer'
import { HudOverlay } from '@/components/HudOverlay'
import { LeftSidebar, RightSidebar } from '@/components/NetworkSidebar'
import { VoiceOrb } from '@/components/VoiceOrb'
import { VoiceProvider } from '@/hooks/useVoice'
import { ActivityFeed } from '@/components/ActivityFeed'
import { useActivityFeed } from '@/hooks/useActivityFeed'
import { IntroScreen } from '@/components/IntroScreen'
import { useState, useRef, useEffect, useCallback } from 'react'
import anime from 'animejs'
import { sfxRingDraw, sfxWhoosh } from '@/hooks/sfx'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  const [introComplete, setIntroComplete] = useState(false)
  const sceneRef   = useRef<HTMLDivElement>(null)
  const orbWrapRef = useRef<HTMLDivElement>(null)
  const { events } = useActivityFeed()

  const handleIntroComplete = useCallback(() => {
    setIntroComplete(true)
  }, [])

  useEffect(() => {
    if (!introComplete || !sceneRef.current || !orbWrapRef.current) return

    const scene   = sceneRef.current
    const orbWrap = orbWrapRef.current

    anime.timeline({ easing: 'easeOutExpo' })
      .add({ targets: scene, opacity: [0, 1], duration: 400 })
      .add({
        targets: orbWrap, opacity: [0, 1], scale: [0.4, 1],
        duration: 900, easing: 'easeOutBack',
      }, '-=100')
      .add({
        targets: scene.querySelectorAll('.sidebar'),
        opacity: [0, 1],
        translateX: (el: Element) =>
          el.classList.contains('sidebar--left') ? [-24, 0] : [24, 0],
        duration: 600,
        begin: () => {
          sfxWhoosh('left')
          setTimeout(() => sfxWhoosh('right'), 80)
        },
      }, '-=400')
      .add({
        targets: scene.querySelectorAll('.hud-overlay'),
        opacity: [0, 1], duration: 400,
        begin: () => {
          sfxRingDraw(0)
          setTimeout(() => sfxRingDraw(1), 200)
          setTimeout(() => sfxRingDraw(2), 400)
        },
      }, '-=200')
  }, [introComplete])

  return (
    <VoiceProvider>
      {!introComplete && <IntroScreen onComplete={handleIntroComplete} />}

      <div ref={sceneRef} className="layout" style={{ opacity: 0 }}>
        <LeftSidebar />

        <div className="scene">
          <div ref={orbWrapRef} className="orb-wrap" style={{ opacity: 0 }}>
            <BlobVisualizer wireframe={true} />
          </div>
          <HudOverlay />
          <ActivityFeed events={events} />
          <VoiceOrb />
        </div>

        <RightSidebar />
      </div>
    </VoiceProvider>
  )
}
