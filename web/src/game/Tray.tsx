import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card, GameView, NamedCards } from '../protocol/types'
import { CardView } from './CardView'
import { useInteraction } from './interaction'
import { plain } from './text'

export interface TrayList {
  key: string
  kind: 'revealed' | 'lookedAt' | 'hand' | 'exiled' | 'companion'
  title: string
  cards: Card[]
}

const KIND_TITLE: Record<TrayList['kind'], string> = {
  revealed: 'Revealed',
  lookedAt: 'Looking at',
  hand: 'Hand of',
  exiled: 'Exiled with',
  companion: 'Companion',
}

/** The card lists XMage shows in separate windows: revealed cards, looked-at cards, controlled hands, exile piles */
export function trayLists(game: GameView): TrayList[] {
  const lists = (kind: TrayList['kind'], source: NamedCards[]) =>
    source.filter((l) => l.cards.length > 0).map((l) => ({ key: `${kind}:${l.id}`, kind, title: plain(l.name), cards: l.cards }))
  return [
    ...lists('revealed', game.revealed),
    ...lists('lookedAt', game.lookedAt),
    ...lists('hand', game.opponentHands),
    ...lists('hand', game.watchedHands),
    ...lists('companion', game.companion),
    ...lists('exiled', game.exiles),
  ]
}

/**
 * Card lists that belong to no zone on the table. A list opens by itself when it appears or changes
 * (something was just revealed to you) and can be folded away; it stays reachable as a chip.
 */
export function Tray({ game }: { game: GameView }) {
  const live = useMemo(() => trayLists(game), [game])
  // XMage only reports looked-at and revealed cards for a moment. Like the Swing client's windows,
  // keep what was shown until the player closes it (or the turn is over).
  const [kept, setKept] = useState<TrayList[]>([])
  const before = useRef<TrayList[]>([])
  useEffect(() => {
    const now = new Set(live.map((l) => l.key))
    const gone = before.current.filter((l) => !now.has(l.key) && (l.kind === 'lookedAt' || l.kind === 'revealed'))
    before.current = live
    setKept((old) => {
      const next = [...old.filter((l) => !now.has(l.key) && !gone.some((g) => g.key === l.key)), ...gone]
      return next.length === old.length && next.every((l, i) => l === old[i]) ? old : next
    })
  }, [live])
  useEffect(() => setKept([]), [game.turn])
  const lists = useMemo(() => [...live, ...kept.map((l) => ({ ...l, past: true }))] as (TrayList & { past?: boolean })[], [live, kept])
  const { mark, click } = useInteraction()
  const [closed, setClosed] = useState<Record<string, string>>({})
  const signature = (list: TrayList) => list.cards.map((c) => c.id).join(',')

  // a list that was closed opens again when its content changes
  useEffect(() => {
    setClosed((old) => {
      const next: Record<string, string> = {}
      for (const list of lists) {
        if (old[list.key] === signature(list) || old[list.key] === 'open') next[list.key] = old[list.key]
      }
      return Object.keys(next).length === Object.keys(old).length ? old : next
    })
  }, [lists])

  if (lists.length === 0) return null
  return (
    <div className="tray">
      {lists.map((list) => {
        const open = closed[list.key] !== signature(list) && list.kind !== 'exiled'
        const explicit = closed[list.key] === 'open'
        const shown = open || explicit
        const playable = list.cards.filter((c) => mark(c.id, c)).length
        return (
          <section key={list.key} className={`tray-list kind-${list.kind} ${shown ? 'open' : ''} ${list.past ? 'past' : ''}`} data-tray={list.kind} data-title={list.title}>
            <button
              className="tray-head"
              onClick={() => setClosed((old) => ({ ...old, [list.key]: shown ? signature(list) : 'open' }))}
              title={shown ? 'Fold away' : 'Show'}
            >
              <small>{KIND_TITLE[list.kind]}</small>
              <span>{list.title}</span>
              <b>{list.cards.length}</b>
              {playable > 0 && <i className="tray-playable">▶{playable}</i>}
            </button>
            {list.past && (
              <button className="tray-close" title="Close" onClick={() => setKept((old) => old.filter((l) => l.key !== list.key))}>
                ✕
              </button>
            )}
            {shown && (
              <div className="tray-cards">
                {list.cards.map((card) => (
                  <CardView key={card.id} card={card} shared={false} className="in-tray" onClick={() => click(card.id)} />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** Everything XMage attached a note to, grouped by player: the Swing client's "card hints helper" */
export function HintsPanel({ game, onClose }: { game: GameView; onClose: () => void }) {
  const [filter, setFilter] = useState('')
  const groups = game.players.map((player) => {
    const cards = [
      ...player.commandZone,
      ...player.battlefield,
      ...(player.id === game.myPlayerId ? game.hand : []),
      ...player.graveyard,
      ...player.exile,
    ].filter((c) => (c.hints?.length ?? 0) > 0)
    return { player, cards }
  })
  const helper = game.helperEmblems.filter((c) => c.rules.length > 0 || (c.hints?.length ?? 0) > 0)
  const match = (card: Card) => !filter || `${card.name} ${(card.hints ?? []).join(' ')}`.toLowerCase().includes(filter.toLowerCase())
  return (
    <div className="hints-panel" data-hints>
      <header>
        <b>Hints</b>
        <input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="btn ghost" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="hints-body">
        {helper.filter(match).map((card) => (
          <div key={card.id} className="hint-card">
            <b>{card.name}</b>
            {[...card.rules, ...(card.hints ?? [])].map((h, i) => (
              <p key={i}>{plain(h)}</p>
            ))}
          </div>
        ))}
        {groups.map(({ player, cards }) => (
          <div key={player.id}>
            <h4>{player.name}</h4>
            {cards.filter(match).length === 0 && <p className="muted">Nothing to note.</p>}
            {cards.filter(match).map((card) => (
              <div key={card.id} className="hint-card" data-hint-card={card.name}>
                <b>{card.name}</b>
                {(card.hints ?? []).map((h, i) => (
                  <p key={i}>{plain(h)}</p>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
