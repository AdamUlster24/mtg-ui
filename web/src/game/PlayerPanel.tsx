import { useEffect, useRef, useState } from 'react'
import type { ManaSymbol, Player } from '../protocol/types'
import { useStore } from '../store'
import { CardView } from './CardView'
import { useInteraction } from './interaction'

const MANA: ManaSymbol[] = ['W', 'U', 'B', 'R', 'G', 'C']
const MANA_TYPE: Record<ManaSymbol, string> = { W: 'WHITE', U: 'BLUE', B: 'BLACK', R: 'RED', G: 'GREEN', C: 'COLORLESS' }

/** Floating "+3" / "−5" next to the life total whenever it changes */
function useLifeChanges(life: number) {
  const last = useRef(life)
  const [changes, setChanges] = useState<{ key: number; delta: number }[]>([])
  useEffect(() => {
    const delta = life - last.current
    last.current = life
    if (delta === 0) return
    const key = Date.now() + Math.random()
    setChanges((list) => [...list, { key, delta }])
    const timer = window.setTimeout(() => setChanges((list) => list.filter((c) => c.key !== key)), 1600)
    return () => window.clearTimeout(timer)
  }, [life])
  return changes
}

interface Props {
  player: Player
  mine: boolean
  onShowZone: (title: string, zone: 'graveyard' | 'exile') => void
}

export function PlayerPanel({ player, mine, onShowZone }: Props) {
  const { mark, click, active } = useInteraction()
  const respond = useStore((s) => s.respond)
  const payingMana = useStore((s) => s.prompt?.method === 'GAME_PLAY_MANA')
  const state = mark(player.id)
  const lifeChanges = useLifeChanges(player.life)
  const lastChange = lifeChanges.at(-1)
  const graveTop = player.graveyard.at(-1)
  const exileTop = player.exile.at(-1)
  const pool = MANA.filter((m) => player.manaPool[m] > 0)
  const badges = [
    ...player.counters.map((c) => `${c.count} ${c.name}`),
    ...(player.monarch ? ['Monarch'] : []),
    ...(player.initiative ? ['Initiative'] : []),
    ...player.designations.filter((d) => d !== 'The Monarch' && d !== 'The Initiative'),
  ]
  return (
    <div className={`player-panel ${mine ? 'mine' : 'theirs'} ${player.active ? 'is-active' : ''}`}>
      <button
        className={`life-orb ${state ? `mark-${state}` : ''} ${player.hasPriority ? 'has-priority' : ''} ${active && state ? 'clickable' : ''}`}
        data-oid={player.id}
        onClick={() => click(player.id)}
        title={player.hasPriority ? `${player.name} has priority` : player.name}
      >
        <span key={player.life} className={`life ${lastChange ? (lastChange.delta < 0 ? 'lost' : 'gained') : ''}`}>
          {player.life}
        </span>
        {lifeChanges.map((c) => (
          <span key={c.key} className={`life-change ${c.delta < 0 ? 'lost' : 'gained'}`}>
            {c.delta > 0 ? `+${c.delta}` : `−${-c.delta}`}
          </span>
        ))}
      </button>
      <div className="player-info">
        <div className="player-name">
          {player.name}
          {player.active && <span className="turn-tag">turn</span>}
          {player.hasLeft && <span className="turn-tag left">left</span>}
        </div>
        <div className="hand-count" title="Cards in hand">
          {player.handCount} in hand
        </div>
        {badges.length > 0 && (
          <div className="player-badges">
            {badges.map((b) => (
              <span key={b}>{b}</span>
            ))}
          </div>
        )}
        {pool.length > 0 && (
          <div className="mana-pool">
            {pool.map((m) => (
              <button
                key={m}
                disabled={!mine || !payingMana}
                onClick={() => respond('manaType', MANA_TYPE[m], { playerId: player.id })}
                title="Mana pool"
              >
                <img className="mana" src={`https://svgs.scryfall.io/card-symbols/${m}.svg`} alt={m} />
                {player.manaPool[m]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="zone-piles">
        <div className="pile" data-pile={`library-${player.id}`} title="Library">
          {player.libraryCount > 0 ? <div className="card-back" /> : <div className="pile-empty" />}
          <span className="pile-size">{player.libraryCount}</span>
        </div>
        <button className="pile" data-pile={`graveyard-${player.id}`} title="Graveyard" onClick={() => onShowZone(`${player.name}'s graveyard`, 'graveyard')}>
          {graveTop ? (
            <CardView card={graveTop} className="in-pile" onClick={() => onShowZone(`${player.name}'s graveyard`, 'graveyard')} />
          ) : (
            <div className="pile-empty" />
          )}
          <span className="pile-size">{player.graveyard.length}</span>
          <span className="pile-label">Graveyard</span>
        </button>
        <button className="pile" data-pile={`exile-${player.id}`} title="Exile" onClick={() => onShowZone(`${player.name}'s exile`, 'exile')}>
          {exileTop ? (
            <CardView card={exileTop} className="in-pile" onClick={() => onShowZone(`${player.name}'s exile`, 'exile')} />
          ) : (
            <div className="pile-empty" />
          )}
          <span className="pile-size">{player.exile.length}</span>
          <span className="pile-label">Exile</span>
        </button>
      </div>
      <div className="command-zone">
        {player.commandZone.map((card) => (
          <CardView key={card.id} card={card} className="in-command" />
        ))}
      </div>
    </div>
  )
}
