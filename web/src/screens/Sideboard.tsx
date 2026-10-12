import { useEffect, useMemo, useState } from 'react'
import { CardView } from '../game/CardView'
import type { Card } from '../protocol/types'
import { useStore } from '../store'

/** Between the games of a match: move cards between main deck and sideboard, then submit */
export function Sideboard() {
  const { sideboarding, request, notify, userName } = useStore()
  const [side, setSide] = useState<Set<string>>(() => new Set(sideboarding?.deck.sideboard.map((c) => c.id)))
  const [left, setLeft] = useState(sideboarding?.time ?? 0)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const all = useMemo(() => (sideboarding ? [...sideboarding.deck.main, ...sideboarding.deck.sideboard] : []), [sideboarding])
  if (!sideboarding) return null
  const byName = (a: Card, b: Card) => (a.manaValue ?? 0) - (b.manaValue ?? 0) || a.name.localeCompare(b.name)
  const main = all.filter((c) => !side.has(c.id)).sort(byName)
  const sideboard = all.filter((c) => side.has(c.id)).sort(byName)
  const move = (card: Card) => {
    if (sent) return
    const next = new Set(side)
    if (!next.delete(card.id)) next.add(card.id)
    setSide(next)
  }
  const submit = async () => {
    setSent(true)
    try {
      await request('submitDeck', { tableId: sideboarding.tableId, main: main.map((c) => c.id), sideboard: sideboard.map((c) => c.id) })
    } catch (e) {
      setSent(false)
      notify('Deck', (e as Error).message)
    }
  }
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`

  return (
    <div className="sideboard-screen">
      <header className="lobby-head">
        <h1>Next game</h1>
        <span className="muted">
          {userName}, adjust your deck. Click a card to move it. In Commander the sideboard holds your commander.
        </span>
        <span className="sb-clock" title="Time left to submit">
          {clock}
        </span>
        <button className="btn primary big" disabled={sent} onClick={submit}>
          {sent ? 'Waiting for the opponent…' : 'Submit deck'}
        </button>
      </header>
      <div className="sb-columns">
        <section className="panel" data-zone="main">
          <h2>Main deck · {main.length}</h2>
          <div className="sb-cards">
            {main.map((card) => (
              <CardView key={card.id} card={card} shared={false} onClick={() => move(card)} />
            ))}
          </div>
        </section>
        <section className="panel" data-zone="sideboard">
          <h2>Sideboard · {sideboard.length}</h2>
          <div className="sb-cards">
            {sideboard.map((card) => (
              <CardView key={card.id} card={card} shared={false} onClick={() => move(card)} />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
