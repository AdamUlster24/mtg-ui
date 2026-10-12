import { LayoutGroup } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Arrows } from '../game/Arrows'
import { Battlefield, battlefieldUnits } from '../game/Battlefield'
import { CardFace, CardView, faceDownKind, iconName } from '../game/CardView'
import { CardGrid, Modal, PromptDialog } from '../game/Dialogs'
import { Effects } from '../game/Effects'
import { InteractionContext, buildInteraction } from '../game/interaction'
import { LogPanel } from '../game/LogPanel'
import { animateEntrances, flyIn, playedFromHand, wasVisible } from '../game/motion'
import { PhaseTrack } from '../game/PhaseTrack'
import { PlayerPanel } from '../game/PlayerPanel'
import { PromptBar } from '../game/PromptBar'
import { ManaCost, RichText, plain } from '../game/text'
import { HintsPanel, Tray } from '../game/Tray'
import type { Card, CardHalf, GameView, Player } from '../protocol/types'
import { useStore } from '../store'
import { SettingsPanel } from './SettingsPanel'

type Zone = { title: string; playerId: string; zone: 'graveyard' | 'exile' | 'sideboard' }

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
    <div className="stack-zone" style={{ ['--n' as string]: cards.length }} data-stack-size={cards.length}>
      <div className="zone-title">Stack · {cards.length}</div>
      <div className="stack-cards">
        {cards.map((card, i) => (
          <div key={card.id} className="stack-slot" style={{ ['--i' as string]: i, zIndex: cards.length - i }}>
            <CardView card={card} className="in-stack" enterFrom={origin(card)} />
            {i === 0 && cards.length > 1 && <span className="stack-next">next</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

function Half({ half }: { half: CardHalf }) {
  return (
    <div className="pv-half">
      <div className="pv-title">
        <b>{half.name}</b>
        <ManaCost cost={half.manaCost} />
      </div>
      <div className="pv-type">
        {half.typeLine}
        {half.spellType ? ` · ${half.spellType}` : ''}
      </div>
      {half.rules.map((rule, i) => (
        <p key={i}>
          <RichText html={rule} />
        </p>
      ))}
    </div>
  )
}

function Details({ card }: { card: Card }) {
  const creature = card.types.includes('CREATURE')
  const changed = creature && card.basePower !== undefined && (String(card.basePower) !== card.power || String(card.baseToughness) !== card.toughness)
  const icons = (card.icons ?? []).filter((i) => !i.type.startsWith('SYSTEM'))
  return (
    <>
      <div className="pv-title">
        <b>{card.displayFullName || card.displayName || card.name}</b>
        <ManaCost cost={card.manaCost} />
      </div>
      <div className="pv-type">{card.typeLine}</div>
      {card.leftHalf && card.rightHalf ? (
        <>
          <Half half={card.leftHalf} />
          <Half half={card.rightHalf} />
        </>
      ) : (
        card.rules.map((rule, i) => (
          <p key={i}>
            <RichText html={rule} />
          </p>
        ))
      )}
      {creature && (
        <div className="pv-pt">
          {card.power}/{card.toughness}
          {changed ? ` (printed ${card.basePower}/${card.baseToughness})` : ''}
          {card.damage ? ` · ${card.damage} damage` : ''}
        </div>
      )}
      {!creature && (card.loyalty || card.defense) && <div className="pv-pt">{card.loyalty ? `Loyalty ${card.loyalty}` : `Defense ${card.defense}`}</div>}
      {card.counters.length > 0 && <div className="pv-type">{card.counters.map((c) => `${c.count} ${c.name}`).join(', ')}</div>}
      {icons.length > 0 && (
        <div className="pv-icons">
          {icons.map((icon, i) => (
            <span key={i}>
              {iconName(icon)}
              {icon.text ? ` ${icon.text}` : ''}
              {icon.hint ? `: ${plain(icon.hint)}` : ''}
            </span>
          ))}
        </div>
      )}
      {(card.hints?.length ?? 0) > 0 && (
        <div className="pv-hints" data-preview-hints>
          {card.hints!.map((hint, i) => (
            <p key={i}>
              <RichText html={hint} />
            </p>
          ))}
        </div>
      )}
    </>
  )
}

function Preview() {
  const card = useStore((s) => s.preview)
  if (!card) return null
  const hiddenKind = faceDownKind(card)
  // my own face-down cards: XMage tells me what they are
  const real = card.faceDown && card.original ? card.original : null
  const other = card.secondFace
  return (
    <div className="preview" data-preview={card.name}>
      <div className="preview-card">
        <CardFace card={real ?? card} />
      </div>
      <div className="preview-text">
        {hiddenKind && <div className="pv-flag">{hiddenKind}{real ? ` · really ${real.name}` : ''}</div>}
        {card.faceDown && !real ? <div className="pv-type">A face-down card.</div> : <Details card={real ?? card} />}
        {card.mutated && card.mutateView && <div className="pv-flag">Mutated with {card.mutateView.name}</div>}
        {card.permanent && card.controlledByOwner === false && <div className="pv-flag">Owned by {card.ownerName || 'the opponent'}</div>}
        {other && (
          <div className="pv-other" data-preview-other={other.name}>
            <small>{card.transformed ? 'Front side' : 'Other side'}</small>
            <Details card={other} />
          </div>
        )}
      </div>
    </div>
  )
}

/** "Krenko did 6 combat damage to bob" style notes XMage keeps on commanders, as numbers per player */
export function commanderDamage(game: GameView): { commander: string; player: string; damage: number }[] {
  const out: { commander: string; player: string; damage: number }[] = []
  for (const owner of game.players) {
    const commanders = [...owner.commandZone, ...owner.battlefield].filter((c) => c.commandKind === 'commander' || c.icons?.some((i) => i.type === 'COMMANDER'))
    for (const card of commanders) {
      for (const line of [...card.rules, ...(card.hints ?? [])]) {
        for (const m of plain(line).matchAll(/(\d+) combat damage to (?:player )?([^.,]+)/gi)) {
          out.push({ commander: card.name, player: m[2].trim(), damage: Number(m[1]) })
        }
      }
    }
  }
  return out
}

/** Day or night, when an effect has started the cycle (XMage reports it as a hint on daybound cards) */
function dayNight(game: GameView): 'day' | 'night' | null {
  for (const p of game.players) {
    for (const card of [...p.battlefield, ...p.commandZone]) {
      for (const hint of card.hints ?? []) {
        const m = /It's currently (day|night)/i.exec(plain(hint))
        if (m) return m[1].toLowerCase() as 'day' | 'night'
      }
    }
  }
  return null
}

export function GameScreen() {
  const game = useStore((s) => s.game)
  const prompt = useStore((s) => s.prompt)
  const answering = useStore((s) => s.answering)
  const respond = useStore((s) => s.respond)
  const gameEnd = useStore((s) => s.gameEnd)
  const leaveGame = useStore((s) => s.leaveGame)
  const prefs = useStore((s) => s.prefs)
  const savePrefs = useStore((s) => s.savePrefs)
  const showSideboardOf = useStore((s) => s.showSideboardOf)
  const clearShowSideboard = useStore((s) => s.clearShowSideboard)
  const [zone, setZone] = useState<Zone | null>(null)
  const [settings, setSettings] = useState(false)
  const [hints, setHints] = useState(false)
  const showLog = prefs.showLog
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

  // "animations off / fast" also applies to everything done in CSS
  useEffect(() => {
    document.body.dataset.animations = prefs.animations
  }, [prefs.animations])

  const interaction = useMemo(() => buildInteraction(prompt, answering, respond), [prompt, answering, respond])

  // the server opens the sideboard viewer on request (More > Look at my sideboard)
  useEffect(() => {
    if (showSideboardOf && game) {
      const owner = game.players.find((p) => p.id === showSideboardOf)
      if (owner) setZone({ title: `${owner.name}'s sideboard`, playerId: owner.id, zone: 'sideboard' })
      clearShowSideboard()
    }
  }, [showSideboardOf, game, clearShowSideboard])

  if (!game || game.players.length === 0) {
    return <div className="center-screen">Shuffling up…</div>
  }

  const me: Player = game.players.find((p) => p.id === game.myPlayerId) ?? game.players[0]
  const opponent: Player = game.players.find((p) => p.id !== me.id) ?? me

  // battlefield cards are as big as the height allows, and shrink when a row would not fit the width
  const units = Math.max(1, ...game.players.map((p) => battlefieldUnits(p, game)))
  const cardHeight = Math.min(size.height * 0.14, size.width * 0.104, ((size.tableWidth - 32) / units) * 1.4) * prefs.cardScale

  const zoneCards = zone ? (game.players.find((p) => p.id === zone.playerId)?.[zone.zone] ?? []) : []
  const damage = commanderDamage(game)
  const cycle = dayNight(game)

  return (
    <InteractionContext.Provider value={interaction}>
      <LayoutGroup>
        <div className={`game ${showLog ? '' : 'log-hidden'}`}>
          <div className="table" ref={table} style={{ ['--bf-ch' as string]: `${Math.max(40, cardHeight)}px` }}>
            <div className="strip top">
              <PlayerPanel player={opponent} game={game} mine={false} onShowZone={(title, z) => setZone({ title, playerId: opponent.id, zone: z })} />
              <OpponentHand count={opponent.handCount} playerId={opponent.id} />
            </div>

            <Battlefield player={opponent} game={game} mine={false} />
            <PhaseTrack game={game} onOpenStops={() => setSettings(true)}>
              {cycle && (
                <span className={`day-night ${cycle}`} data-day-night={cycle} title={`It is ${cycle}`}>
                  {cycle === 'day' ? '☀ Day' : '☾ Night'}
                </span>
              )}
              {damage.map((d) => (
                <span key={d.commander + d.player} className="commander-damage" data-commander-damage={d.damage} title={`Combat damage dealt by ${d.commander} to ${d.player} (21 is lethal)`}>
                  {d.commander.split(',')[0]} → {d.player}: {d.damage}/21
                </span>
              ))}
            </PhaseTrack>
            <Battlefield player={me} game={game} mine />

            <div className="strip bottom">
              <PlayerPanel player={me} game={game} mine onShowZone={(title, z) => setZone({ title, playerId: me.id, zone: z })} />
              <Hand cards={game.hand} playerId={me.id} />
              <PromptBar prompt={prompt} game={game} onSettings={() => setSettings(true)} onHints={() => setHints((v) => !v)} />
            </div>

            <Stack cards={game.stack} opponentId={opponent.id} />
            <Tray game={game} />
            <Preview />
            <Effects game={game} />
          </div>

          <aside className="side">
            <button className="btn ghost side-toggle" onClick={() => savePrefs({ showLog: !showLog })}>
              {showLog ? 'Hide log ▸' : '◂ Log'}
            </button>
            {showLog && (hints ? <HintsPanel game={game} onClose={() => setHints(false)} /> : <LogPanel />)}
          </aside>

          <Arrows game={game} />

          {prompt && <PromptDialog prompt={prompt} />}
          {settings && <SettingsPanel onClose={() => setSettings(false)} />}
          {hints && !showLog && (
            <Modal title="Hints" wide onClose={() => setHints(false)}>
              <HintsPanel game={game} onClose={() => setHints(false)} />
            </Modal>
          )}

          {zone && (
            <Modal title={zone.title} wide onClose={() => setZone(null)}>
              <CardGrid
                cards={zoneCards}
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
                {gameEnd.winsNeeded > 1 && (
                  <p className="match-line" data-match-score>
                    Match: {gameEnd.wins} – {gameEnd.loses} (first to {gameEnd.winsNeeded})
                  </p>
                )}
              </div>
              <footer>
                {gameEnd.winsNeeded > 1 && (
                  <span className="muted" data-next-game>
                    If the match goes on, sideboarding opens by itself.
                  </span>
                )}
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
