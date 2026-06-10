import { useEffect, useRef } from 'react'
import anime from 'animejs'

export type TaskStatus = 'running' | 'done' | 'error'

export interface TaskEvent {
  id:      string
  type:    'task' | 'tool' | 'complete' | 'error'
  text:    string
  status:  TaskStatus
  ts:      number
}

interface ActivityFeedProps {
  events: TaskEvent[]
}

function StatusDot({ status }: { status: TaskStatus }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!ref.current || status !== 'running') return
    const a = anime({
      targets:   ref.current,
      opacity:   [1, 0.2],
      duration:  800,
      loop:      true,
      direction: 'alternate',
      easing:    'easeInOutSine',
    })
    return () => a.pause()
  }, [status])

  const color = status === 'running' ? 'var(--c-gold)'
              : status === 'done'    ? 'var(--c-accent)'
              : 'var(--c-danger)'

  return (
    <span ref={ref} style={{
      display:      'inline-block',
      width:        '5px',
      height:       '5px',
      borderRadius: '50%',
      background:   color,
      flexShrink:   0,
      boxShadow:    `0 0 4px ${color}`,
    }} />
  )
}

function TaskRow({ event }: { event: TaskEvent }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    anime({
      targets:     ref.current,
      opacity:     [0, 1],
      translateX:  [-8, 0],
      duration:    200,
      easing:      'easeOutQuad',
    })
  }, [])

  const indent = event.type === 'tool' || event.type === 'complete' || event.type === 'error'

  return (
    <div ref={ref} className="task-row" style={{ opacity: 0, paddingLeft: indent ? '12px' : '0' }}>
      <StatusDot status={event.status} />
      <span className={`task-text task-text--${event.type}`}>
        {event.text}
      </span>
      <span className="task-ts">
        {new Date(event.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    </div>
  )
}

export function ActivityFeed({ events }: ActivityFeedProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to latest
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [events])

  if (events.length === 0) return null

  return (
    <div className="activity-feed">
      <div className="activity-feed-header">
        <span className="activity-feed-label">ACTIVITY</span>
      </div>
      <div ref={listRef} className="activity-feed-list">
        {events.slice(-12).map(e => <TaskRow key={e.id} event={e} />)}
      </div>
    </div>
  )
}
