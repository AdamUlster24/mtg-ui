import { LayoutGroup } from 'motion/react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Arrows } from '../game/Arrows'
import { Battlefield, battlefieldUnits } from '../game/Battlefield'
import { CardFace, CardView } from '../game/CardView'
import { CardGrid, Modal, PromptDialog } from '../game/Dialogs'
import { InteractionContext, buildInteraction } from '../game/interaction'
import { LogPanel } from '../game/LogPanel'
import { animateEntrances, flyIn, playedFromHand, wasVisible } from '../game/motion'
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

function Hand({ cards, playerId }: { cards: Card[]; playerId: string }) {
  const mid = (cards.length - 1) / 2
  return (
    <div className="hand" style={{ ['--n' as string]: cards.length }}>
      {cards.map((card, i) => (
        <div key={card.id} className="hand-slot" style={{ ['--o' as string]: i - mid }}>
          <CardView card={card} className="in-hand" enterFrom={`[data-pile="library-${playerId}"]`} />
        </div>
      ))}
    </div>
  )
}

function OpponentHand({ count, playerId }: { count: number; playerId: string }) {
  const shown = Math.min(count, 12)
  const mid = (shown - 1) / 2
  const root = useRef<HTMLDivElement>(null)
  const before = useRef(shown)
  // cards the opponent draws come from their library
  useLayoutEffect(() => {
    const backs = Array.from(root.current?.children ?? []) as HTMLElement[]
    if (animateEntrances()) {
      const library = document.querySelector(`[data-pile="library-${playerId}"]`)
      backs.slice(before.current).forEach((el, i) => flyIn(el, library, i * 60))
    }
    before.current = shown
  }, [shown, playerId])
  return (
    <div className="opp-hand" title={`${count} cards in hand`} ref={root}>
      {Array.from({ length: shown }, (_, i) => (
        <div key={i} className="opp-card" style={{ ['--o' as string]: i - mid }}>
          <div className="card-back mini" />
        </div>
      ))}
    </div>
  )
}

function Stack({ cards, opponentId }: { cards: Card[]; opponentId: string }) {
  if (cards.length === 0) return null
  // abilities come out of their source; spells that were not in my hand come from the opponent's
  const origin = (card: Card) =>
    card.isAbility && card.sourceCard && wasVisible(card.sourceCard.id)
      ? `[data-oid="${card.sourceCard.id}"]`
      : playedFromHand(opponentId)
        ? '.opp-hand'
        : null
  return (
    <div className="stack-zone">
      <div className="zone-title">Stack · {cards.length}</div>
      <div className="stack-cards">
        {cards.map((card, i) => (
          <div key={card.id} className="stack-slot" style={{ ['--i' as string]: i, zIndex: cards.length - i }}>
            <CardView card={card} className="in-stack" enterFrom={origin(card)} />
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
  const table = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight, tableWidth: window.innerWidth * 0.7 })
  const hasGame = !!game
  useLayoutEffect(() => {
    const measure = () => {
      const el = table.current
      if (!el) return
      // the stack floats over the right edge of the table, rows must stay clear of it
      const reserved = Math.min(window.innerHeight * 0.15, window.innerWidth * 0.104) * 1.25
      setSize({ width: window.innerWidth, height: window.innerHeight, tableWidth: el.clientWidth - reserved })
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (table.current) observer.observe(table.current)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [hasGame, showLog])

  const interaction = useMemo(() => buildInteraction(prompt, answering, respond), [prompt, answering, respond])

  if (!game || game.players.length === 0) {
    return <div className="center-screen">Shuffling up…</div>
  }

  const me = game.players.find((p) => p.id === game.myPlayerId) ?? game.players[0]
  const opponent = game.players.find((p) => p.id !== me.id) ?? me

  // battlefield cards are as big as the height allows, and shrink when a row would not fit the width
  const units = Math.max(1, ...game.players.map((p) => battlefieldUnits(p, game)))
  const cardHeight = Math.min(size.height * 0.14, size.width * 0.104, ((size.tableWidth - 32) / units) * 1.4)

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
          <div className="table" ref={table} style={{ ['--bf-ch' as string]: `${Math.max(40, cardHeight)}px` }}>
            <div className="strip top">
              <PlayerPanel player={opponent} mine={false} onShowZone={(title, z) => setZone({ title, playerId: opponent.id, zone: z })} />
              <OpponentHand count={opponent.handCount} playerId={opponent.id} />
            </div>

            <Battlefield player={opponent} game={game} mine={false} />
            <PhaseTrack game={game} />
            <Battlefield player={me} game={game} mine />

            <div className="strip bottom">
              <PlayerPanel player={me} mine onShowZone={(title, z) => setZone({ title, playerId: me.id, zone: z })} />
              <Hand cards={game.hand} playerId={me.id} />
              <PromptBar prompt={prompt} game={game} />
            </div>

            <Stack cards={game.stack} opponentId={opponent.id} />

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
