import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { RichText, tidy } from './text'

export function LogPanel() {
  const log = useStore((s) => s.log)
  const sendChat = useStore((s) => s.sendChat)
  const [draft, setDraft] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  useEffect(() => {
    const el = list.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [log])

  return (
    <div className="log-panel">
      <div
        className="log-lines"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {log.map((line) => (
          <div key={line.key} className={`log-line type-${line.messageType?.toLowerCase()}`}>
            {line.username && line.messageType !== 'GAME' && <b>{line.username}: </b>}
            <RichText html={tidy(line.message)} />
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          sendChat(draft)
          setDraft('')
        }}
      >
        <input placeholder="Chat…" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={300} />
      </form>
    </div>
  )
}
