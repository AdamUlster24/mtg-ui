import { useEffect, useRef, useState } from 'react'
import type { Card, GameView, ManaSymbol, Player } from '../protocol/types'
import { useStore } from '../store'
import { CardView } from './CardView'
import { useInteraction } from './interaction'
import { speed, tookFromLibrary, playedFromHand } from './motion'
import { plain } from './text'

const MANA: ManaSymbol[] = ['W', 'U', 'B', 'R', 'G', 'C']
const MANA_TYPE: Record<ManaSymbol, string> = { W: 'WHITE', U: 'BLUE', B: 'BLACK', R: 'RED', G: 'GREEN', C: 'COLORLESS' }

/** Floating "+3" / "−5" next to the life total whenever it changes */
function useLifeChanges(life: number) {
  const last = useRef(life)
  const [changes, setChanges] = useState<{ key: number; delta: number }[]>([])
  useEffect(() => {
    const delta = life - last.current
    last.current = life
    if (delta === 0 || speed() === 0) return
    const key = Date.now() + Math.random()
    setChanges((list) => [...list, { key, delta }])
    const timer = window.setTimeout(() => setChanges((list) => list.filter((c) => c.key !== key)), 1600)
    return () => window.clearTimeout(timer)
  }, [life])
  return changes
}

/** The player's chess clock, counted down locally between server updates */
function Clock({ player }: { player: Player }) {
  const [left, setLeft] = useState(player.priorityTimeLeftSecs ?? 0)
  useEffect(() => setLeft(player.priorityTimeLeftSecs ?? 0), [player.priorityTimeLeftSecs])
  useEffect(() => {
    if (!player.timerActive) return
    const timer = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [player.timerActive])
  const text = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  return (
    <span className={`clock ${player.timerActive ? 'running' : ''} ${left < 60 ? 'low' : ''}`} title="Time left on this player's clock">
      {text}
    </span>
  )
}

/** Which "pass until ..." the player has switched on, if any */
export function passingMode(player: Player): string | null {
  if (player.passedAllTurns) return 'until my next turn'
  if (player.passedUntilEndStepBeforeMyTurn) return 'until the end step before my turn'
  if (player.passedTurn) return 'until next turn'
  if (player.passedUntilEndOfTurn) return 'until end step'
  if (player.passedUntilNextMain) return 'until next main phase'
  if (player.passedUntilStackResolved) return 'until the stack resolves'
  return null
}

const COMMAND_TITLE: Record<string, string> = { emblem: 'Emblem', dungeon: 'Dungeon', plane: 'Plane', other: 'Command object' }

interface Props {
  player: Player
  game: GameView
  mine: boolean
  onShowZone: (title: string, zone: 'graveyard' | 'exile') => void
}

export function PlayerPanel({ player, game, mine, onShowZone }: Props) {
  const { mark, click, active } = useInteraction()
  const respond = useStore((s) => s.respond)
  const setPreview = useStore((s) => s.setPreview)
  const payingMana = useStore((s) => s.prompt?.method === 'GAME_PLAY_MANA')
  const state = mark(player.id)
  const lifeChanges = useLifeChanges(player.life)
  const lastChange = lifeChanges.at(-1)
  const graveTop = player.graveyard.at(-1)
  const exileTop = player.exile.at(-1)
  const pool = MANA.filter((m) => player.manaPool[m] > 0)
  const passing = passingMode(player)
  const badges = [
    ...player.counters.map((c) => `${c.count} ${c.name}`),
    ...(player.monarch ? ['Monarch'] : []),
    ...(player.initiative ? ['Initiative'] : []),
    ...player.designations.filter((d) => !/monarch|initiative/i.test(d)),
  ]
  // auras on the player (curses) live on somebody's battlefield
  const all = new Map<string, Card>()
  for (const p of game.players) for (const c of p.battlefield) all.set(c.id, c)
  const attached = (player.attachments ?? []).map((id) => all.get(id)).filter((c): c is Card => !!c)
  // cards in hidden piles that can be played right now (flashback, cast from exile, top of library)
  const playableIn = (cards: Card[]) => cards.filter((c) => c.playable).length
  const playableGrave = playableIn(player.graveyard)
  const playableExile = playableIn(player.exile)
  const top = player.topCard
  // like the Swing client: how many card types the graveyard holds (delirium, Tarmogoyf)
  const cardTypes = new Set(player.graveyard.flatMap((c) => c.types)).size
  const pileOrigin = (pid: string) => (playedFromHand(pid) ? (mine ? '.hand' : '.opp-hand') : tookFromLibrary(pid) ? `[data-pile="library-${pid}"]` : null)
  const commanders = player.commandZone.filter((c) => c.commandKind === 'commander' || !c.commandKind)
  const objects = player.commandZone.filter((c) => c.commandKind && c.commandKind !== 'commander')

  return (
    <div className={`player-panel ${mine ? 'mine' : 'theirs'} ${player.active ? 'is-active' : ''}`} data-player={player.name}>
      <button
        className={`life-orb ${state ? `mark-${state}` : ''} ${player.hasPriority ? 'has-priority' : ''} ${active && state ? 'clickable' : ''} ${lastChange && lastChange.delta < 0 ? 'was-hit' : ''}`}
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
          {game.priorityTime > 0 && <Clock player={player} />}
        </div>
        <div className="hand-count" title="Cards in hand">
          {player.handCount} in hand
          {(player.winsNeeded ?? 1) > 1 && (
            <span className="match-score" title="Games won in this match">
              {' '}
              · {player.wins}/{player.winsNeeded} wins
            </span>
          )}
        </div>
        {passing && (
          <div className="passing" data-passing title="F3 stops passing">
            passing {passing}
          </div>
        )}
        {(badges.length > 0 || attached.length > 0) && (
          <div className="player-badges">
            {badges.map((b) => (
              <span key={b} data-badge={b}>
                {b}
              </span>
            ))}
            {attached.map((c) => (
              <span key={c.id} className="attached" data-attached={c.name} onMouseEnter={() => setPreview(c)} onMouseLeave={() => setPreview(null)}>
                {c.name}
              </span>
            ))}
          </div>
        )}
        {pool.length > 0 && (
          <div className="mana-pool">
            {pool.map((m) => (
              <button key={m} disabled={!mine || !payingMana} onClick={() => respond('manaType', MANA_TYPE[m], { playerId: player.id })} title="Mana pool">
                <img className="mana" src={`https://svgs.scryfall.io/card-symbols/${m}.svg`} alt={m} />
                {player.manaPool[m]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="zone-piles">
        <div className={`pile ${top ? 'revealed' : ''}`} data-pile={`library-${player.id}`} title="Library">
          {/* the top card lies face up when an effect reveals it; it can be playable (Future Sight) */}
          {top ? <CardView card={top} className="in-pile" /> : player.libraryCount > 0 ? <div className="card-back" /> : <div className="pile-empty" />}
          <span className="pile-size">{player.libraryCount}</span>
          <span className="pile-label">Library</span>
        </div>
        <button
          className={`pile ${playableGrave ? 'has-playable' : ''}`}
          data-pile={`graveyard-${player.id}`}
          data-card-types={cardTypes}
          title={`Graveyard · ${cardTypes} card type${cardTypes === 1 ? '' : 's'}`}
          onClick={() => onShowZone(`${player.name}'s graveyard`, 'graveyard')}
        >
          {graveTop ? (
            <CardView card={graveTop} className="in-pile" enterFrom={pileOrigin(player.id)} onClick={() => onShowZone(`${player.name}'s graveyard`, 'graveyard')} />
          ) : (
            <div className="pile-empty" />
          )}
          <span className="pile-size">{player.graveyard.length}</span>
          {playableGrave > 0 && <span className="pile-playable" title="Cards you can play from here">▶{playableGrave}</span>}
          <span className="pile-label">Graveyard</span>
        </button>
        <button
          className={`pile ${playableExile ? 'has-playable' : ''}`}
          data-pile={`exile-${player.id}`}
          title="Exile"
          onClick={() => onShowZone(`${player.name}'s exile`, 'exile')}
        >
          {exileTop ? (
            <CardView card={exileTop} className="in-pile" enterFrom={pileOrigin(player.id)} onClick={() => onShowZone(`${player.name}'s exile`, 'exile')} />
          ) : (
            <div className="pile-empty" />
          )}
          <span className="pile-size">{player.exile.length}</span>
          {playableExile > 0 && <span className="pile-playable" title="Cards you can play from here">▶{playableExile}</span>}
          <span className="pile-label">Exile</span>
        </button>
      </div>
      <div className="command-zone">
        {commanders.map((card) => (
          <CardView key={card.id} card={card} className="in-command" />
        ))}
        {objects.map((card) => (
          <button
            key={card.id}
            className={`command-object kind-${card.commandKind} ${mark(card.id, card) ? `mark-${mark(card.id, card)}` : ''}`}
            data-oid={card.id}
            data-name={card.name}
            data-command-kind={card.commandKind}
            title={`${COMMAND_TITLE[card.commandKind ?? 'other']}: ${plain(card.rules.join(' '))}`}
            onMouseEnter={() => setPreview(card)}
            onMouseLeave={() => setPreview(null)}
            onClick={() => click(card.id)}
          >
            <small>{COMMAND_TITLE[card.commandKind ?? 'other']}</small>
            {card.name.replace(/^Emblem /, '')}
          </button>
        ))}
      </div>
    </div>
  )
}
