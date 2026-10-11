import { LayoutGroup } from 'motion/react'
import { useMemo, useState } from 'react'
import { Arrows } from '../game/Arrows'
import { Battlefield } from '../game/Battlefield'
import { CardFace, CardView } from '../game/CardView'
import { CardGrid, Modal, PromptDialog } from '../game/Dialogs'
import { InteractionContext, buildInteraction } from '../game/interaction'
import { LogPanel } from '../game/LogPanel'
import { PhaseTrack } from '../game/PhaseTrack'
import { PlayerPanel } from '../game/PlayerPanel'
import { PromptBar } from '../game/PromptBar'
import { ManaCost, RichText } from '../game/text'
import type { Card, GameView, NamedCards } from '../protocol/types'
import { useStore } from '../store'

type Zone = { title: string; playerId?: string; zone?: 'graveyard' | 'exile'; listId?: string; kind?: 'exiles' | 'revealed' | 'lookedAt' | 'companion' }

function zoneCards(game: GameView, zone: Zone): Card[] {
  if (zone.playerId && zone.zone) {
    return game.players.find((p) => p.id === zone.playerId)?.[zone.zone] ?? []
  }
  if (zone.kind) {
    return game[zone.kind].find((l) => l.id === zone.listId)?.cards ?? []
  }
  return []
}

function Hand({ cards }: { cards: Card[] }) {
  const mid = (cards.length - 1) / 2
  return (
    <div className="hand" style={{ ['--n' as string]: cards.length }}>
      {cards.map((card, i) => (
        <div key={card.id} className="hand-slot" style={{ ['--o' as string]: i - mid }}>
          <CardView card={card} className="in-hand" />
        </div>
      ))}
    </div>
  )
}

function OpponentHand({ count }: { count: number }) {
  const shown = Math.min(count, 12)
  const mid = (shown - 1) / 2
  return (
    <div className="opp-hand" title={`${count} cards in hand`}>
      {Array.from({ length: shown }, (_, i) => (
        <div key={i} className="card-back mini" style={{ ['--o' as string]: i - mid }} />
      ))}
    </div>
  )
}

function Stack({ cards }: { cards: Card[] }) {
  if (cards.length === 0) return null
  return (
    <div className="stack-zone">
      <div className="zone-title">Stack · {cards.length}</div>
      <div className="stack-cards">
        {cards.map((card, i) => (
          <div key={card.id} className="stack-slot" style={{ ['--i' as string]: i, zIndex: cards.length - i }}>
            <CardView card={card} className="in-stack" />
          </div>
        ))}
      </div>
    </div>
  )
}

function Preview() {
  const card = useStore((s) => s.preview)
  if (!card) return null
  const shown = card.isAbility && card.sourceCard ? card.sourceCard : card
  return (
    <div className="preview">
      <div className="preview-card">
        <CardFace card={card} />
      </div>
      {!card.faceDown && (
        <div className="preview-text">
          <div className="pv-title">
            <b>{card.displayName || card.name || shown.name}</b>
            <ManaCost cost={card.manaCost} />
          </div>
          <div className="pv-type">{card.typeLine}</div>
          {card.rules.map((rule, i) => (
            <p key={i}>
              <RichText html={rule} />
            </p>
          ))}
          {card.types.includes('CREATURE') && (
            <div className="pv-pt">
              {card.power}/{card.toughness}
              {card.damage ? ` · ${card.damage} damage` : ''}
            </div>
          )}
          {card.counters.length > 0 && <div className="pv-type">{card.counters.map((c) => `${c.count} ${c.name}`).join(', ')}</div>}
        </div>
      )}
    </div>
  )
}

export function GameScreen() {
  const game = useStore((s) => s.game)
  const prompt = useStore((s) => s.prompt)
  const answering = useStore((s) => s.answering)
  const respond = useStore((s) => s.respond)
  const gameEnd = useStore((s) => s.gameEnd)
  const leaveGame = useStore((s) => s.leaveGame)
  const [zone, setZone] = useState<Zone | null>(null)
  const [showLog, setShowLog] = useState(true)

  const interaction = useMemo(() => buildInteraction(prompt, answering, respond), [prompt, answering, respond])

  if (!game || game.players.length === 0) {
    return <div className="center-screen">Shuffling up…</div>
  }

  const me = game.players.find((p) => p.id === game.myPlayerId) ?? game.players[0]
  const opponent = game.players.find((p) => p.id !== me.id) ?? me

  // few permanents: bigger cards; crowded board: smaller ones
  const widest = Math.max(
    ...game.players.flatMap((p) => {
      const creatures = p.battlefield.filter((c) => c.types.includes('CREATURE')).length
      return [creatures, new Set(p.battlefield.filter((c) => !c.types.includes('CREATURE')).map((c) => c.name + c.tapped)).size]
    }),
  )
  const density = widest <= 7 ? 'roomy' : widest >= 13 ? 'dense' : ''

  const lists: [NonNullable<Zone['kind']>, NamedCards][] = [
    ...game.revealed.map((l) => ['revealed', l] as [NonNullable<Zone['kind']>, NamedCards]),
    ...game.lookedAt.map((l) => ['lookedAt', l] as [NonNullable<Zone['kind']>, NamedCards]),
    ...game.exiles.map((l) => ['exiles', l] as [NonNullable<Zone['kind']>, NamedCards]),
    ...game.companion.map((l) => ['companion', l] as [NonNullable<Zone['kind']>, NamedCards]),
  ].filter(([, list]) => list.cards.length > 0) as [NonNullable<Zone['kind']>, NamedCards][]

  return (
    <InteractionContext.Provider value={interaction}>
      <LayoutGroup>
        <div className={`game ${showLog ? '' : 'log-hidden'}`}>
          <div className={`table ${density}`}>
            <div className="strip top">
              <PlayerPanel player={opponent} mine={false} onShowZone={(title, z) => setZone({ title, playerId: opponent.id, zone: z })} />
              <OpponentHand count={opponent.handCount} />
            </div>

            <Battlefield player={opponent} game={game} mine={false} />
            <PhaseTrack game={game} />
            <Battlefield player={me} game={game} mine />

            <div className="strip bottom">
              <PlayerPanel player={me} mine onShowZone={(title, z) => setZone({ title, playerId: me.id, zone: z })} />
              <Hand cards={game.hand} />
              <PromptBar prompt={prompt} game={game} />
            </div>

            <Stack cards={game.stack} />

            {lists.length > 0 && (
              <div className="zone-chips">
                {lists.map(([kind, list]) => (
                  <button key={kind + list.id} onClick={() => setZone({ title: list.name, kind, listId: list.id })}>
                    {list.name} · {list.cards.length}
                  </button>
                ))}
              </div>
            )}
            <Preview />
          </div>

          <aside className="side">
            <button className="btn ghost side-toggle" onClick={() => setShowLog((v) => !v)}>
              {showLog ? 'Hide log ▸' : '◂ Log'}
            </button>
            {showLog && <LogPanel />}
          </aside>

          <Arrows game={game} />

          {prompt && <PromptDialog prompt={prompt} />}

          {zone && (
            <Modal title={zone.title} wide onClose={() => setZone(null)}>
              <CardGrid
                cards={zoneCards(game, zone)}
                onPick={
                  interaction.active
                    ? (card) => {
                        interaction.click(card.id)
                        setZone(null)
                      }
                    : undefined
                }
              />
            </Modal>
          )}

          {gameEnd && (
            <Modal title={gameEnd.won ? 'Victory' : 'Defeat'}>
              <div className={`game-end ${gameEnd.won ? 'won' : 'lost'}`}>
                <p>
                  <RichText html={gameEnd.gameInfo} />
                </p>
                <p className="muted">
                  <RichText html={gameEnd.matchInfo} />
                </p>
              </div>
              <footer>
                <button className="btn primary" onClick={leaveGame}>
                  Back to lobby
                </button>
              </footer>
            </Modal>
          )}
        </div>
      </LayoutGroup>
    </InteractionContext.Provider>
  )
}
