import { useEffect, useRef, useState } from 'react'
import type { TaskEvent, TaskStatus } from '@/components/ActivityFeed'

let _nextId = 0
const uid = () => String(++_nextId)

export function useActivityFeed() {
  const [events, setEvents] = useState<TaskEvent[]>([])
  const currentTaskId = useRef<string | null>(null)

  const push = (event: Omit<TaskEvent, 'id' | 'ts'>) => {
    setEvents(prev => {
      const next = [...prev, { ...event, id: uid(), ts: Date.now() }]
      return next.slice(-30)  // keep last 30
    })
  }

  const updateLast = (id: string, status: TaskStatus) => {
    setEvents(prev => prev.map(e => e.id === id ? { ...e, status } : e))
  }

  useEffect(() => {
    const unsub = window.omni?.chat.onEvent(({ event, payload }) => {
      const p = (payload ?? {}) as Record<string, unknown>

      // Gateway tool narrations from our gateway.ts poll loop
      if (event === 'chat.sentence' && p.isNarration) {
        const text = (p.text ?? '') as string
        if (!text) return

        // Classify the narration type
        const lower = text.toLowerCase()
        const type = lower.includes('search') || lower.includes('finding') ? 'tool'
                   : lower.includes('opening') || lower.includes('navigating') ? 'tool'
                   : lower.includes('reading') || lower.includes('extracting') ? 'tool'
                   : lower.includes('on it') || lower.includes('let me') ? 'task'
                   : 'tool'

        const taskId = uid()
        currentTaskId.current = taskId
        push({ type, text: text.replace(/\.$/, ''), status: 'running' })
        return
      }

      // Browser agent narrations (from ws://localhost:7855/stream)
      if (event === 'chat.sentence' && p.sessionKey === 'browser-agent') {
        const text   = (p.text ?? '') as string
        const evType = (p.type ?? 'narration') as string
        if (!text) return

        const type: TaskEvent['type'] =
          evType === 'start'    ? 'task'
        : evType === 'goal'     ? 'tool'
        : evType === 'complete' ? 'complete'
        : evType === 'error'    ? 'error'
        : 'tool'

        const status: TaskStatus =
          type === 'complete' ? 'done'
        : type === 'error'    ? 'error'
        : 'running'

        push({ type, text: text.slice(0, 80), status })
        return
      }

      // Final response — mark last task done
      if (event === 'chat.response') {
        if (currentTaskId.current) {
          updateLast(currentTaskId.current, 'done')
          currentTaskId.current = null
        }
        return
      }
    })
    return () => { unsub?.() }
  }, [])

  const clear = () => setEvents([])

  return { events, clear }
}
