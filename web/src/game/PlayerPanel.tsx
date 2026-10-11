import type { ManaSymbol, Player } from '../protocol/types'
import { useStore } from '../store'
import { CardView } from './CardView'
import { useInteraction } from './interaction'

const MANA: ManaSymbol[] = ['W', 'U', 'B', 'R', 'G', 'C']
const MANA_TYPE: Record<ManaSymbol, string> = { W: 'WHITE', U: 'BLUE', B: 'BLACK', R: 'RED', G: 'GREEN', C: 'COLORLESS' }

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
        <span className="life">{player.life}</span>
      </button>
      <div className="player-info">
        <div className="player-name">
          {player.name}
          {player.active && <span className="turn-tag">turn</span>}
          {player.hasLeft && <span className="turn-tag left">left</span>}
        </div>
        <div className="piles">
          <span title="Library">
            <i className="ico lib" />
            {player.libraryCount}
          </span>
          <span title="Hand">
            <i className="ico in-hand" />
            {player.handCount}
          </span>
          <button title="Graveyard" onClick={() => onShowZone(`${player.name}'s graveyard`, 'graveyard')}>
            <i className="ico in-grave" />
            {player.graveyard.length}
          </button>
          <button title="Exile" onClick={() => onShowZone(`${player.name}'s exile`, 'exile')}>
            <i className="ico in-exile" />
            {player.exile.length}
          </button>
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
      <div className="command-zone">
        {player.commandZone.map((card) => (
          <CardView key={card.id} card={card} className="in-command" />
        ))}
      </div>
    </div>
  )
}
