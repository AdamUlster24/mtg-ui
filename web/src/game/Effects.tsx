import { useEffect, useRef, useState } from 'react'
import type { ChatLine, GameView } from '../protocol/types'
import { useStore } from '../store'
import { speed } from './motion'

interface Effect {
  key: number
  kind: 'die' | 'coin' | 'turn' | 'countered'
  text: string
  detail?: string
}

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

/** What the game log says happened, for the things the board snapshots don't show */
export function readLog(line: ChatLine): { kind: Effect['kind'] | 'shuffle' | 'search'; text: string; detail?: string; player?: string } | null {
  const text = strip(line.message)
  // "[Roll a die] ann rolled 1d20, result: 14"
  let m = /\[Roll a die\] (.+?) rolled \S+, result\w*: (\d+)/i.exec(text)
  if (m) return { kind: 'die', text: m[2], detail: text.replace(/^\[Roll a die\] /, ''), player: m[1] }
  // "ann flipped Heads" (the "won / lost the flip" line that follows is the same event)
  m = /^(.+?) flipped (heads|tails)\b/i.exec(text)
  if (m) return { kind: 'coin', text: m[2].toLowerCase(), detail: text, player: m[1] }
  m = /^(.+?)(?:'s|’s) library is shuffled/i.exec(text) ?? /^(.+?) shuffles/i.exec(text)
  if (m) return { kind: 'shuffle', text: '', player: m[1] }
  m = /^(.+?) searches (?:their|his or her|its) library/i.exec(text)
  if (m) return { kind: 'search', text: '', player: m[1] }
  if (/\bis countered\b|\bcounters? /i.test(text) && !/counters? on\b|\bcounter(s)? (from|to)\b/i.test(text)) return { kind: 'countered', text: 'Countered', detail: text }
  return null
}

/** Marks a player's library pile for a moment so CSS can animate it */
function pulsePile(game: GameView | null, playerName: string | undefined, className: string) {
  const player = game?.players.find((p) => p.name === playerName)
  const pile = player && document.querySelector(`[data-pile="library-${player.id}"]`)
  if (!pile) return
  pile.classList.remove(className)
  // restart the animation when the same thing happens twice in a row
  void (pile as HTMLElement).offsetWidth
  pile.classList.add(className)
  window.setTimeout(() => pile.classList.remove(className), 1200)
}

/**
 * Animations for events that only show up as log lines or as a changed number:
 * dice, coin flips, shuffles, library searches, countered spells and the turn passing.
 */
export function Effects({ game }: { game: GameView }) {
  const log = useStore((s) => s.log)
  const [effects, setEffects] = useState<Effect[]>([])
  const seen = useRef(log.at(-1)?.key ?? 0)
  const turn = useRef({ turn: game.turn, active: game.activePlayerId })

  const show = (effect: Omit<Effect, 'key'>, ms = 1900) => {
    const k = speed()
    if (k === 0) return
    const key = Date.now() + Math.random()
    setEffects((list) => [...list, { ...effect, key }])
    window.setTimeout(() => setEffects((list) => list.filter((e) => e.key !== key)), ms * Math.max(k, 0.6))
  }

  useEffect(() => {
    const fresh = log.filter((l) => l.key > seen.current)
    seen.current = log.at(-1)?.key ?? seen.current
    // a reload replays the whole log: that is history, not something happening now
    if (fresh.length > 12) return
    for (const line of fresh) {
      const event = readLog(line)
      if (!event) continue
      if (event.kind === 'shuffle') pulsePile(game, event.player, 'shuffling')
      else if (event.kind === 'search') pulsePile(game, event.player, 'searching')
      else show({ kind: event.kind, text: event.text, detail: event.detail })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log])

  useEffect(() => {
    if (game.turn !== turn.current.turn || game.activePlayerId !== turn.current.active) {
      turn.current = { turn: game.turn, active: game.activePlayerId }
      const mine = game.activePlayerId === game.myPlayerId
      show({ kind: 'turn', text: mine ? 'Your turn' : `${game.activePlayerName}'s turn`, detail: `Turn ${game.turn}` }, 1500)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.turn, game.activePlayerId])

  return (
    <div className="effects">
      {effects.map((e) => (
        <div key={e.key} className={`effect effect-${e.kind}`} data-effect={e.kind}>
          {e.kind === 'die' && <div className="die">{e.text}</div>}
          {e.kind === 'coin' && (
            <div className="coin">
              <span>{e.text}</span>
            </div>
          )}
          {e.kind === 'turn' && (
            <div className="turn-banner">
              <small>{e.detail}</small>
              <b>{e.text}</b>
            </div>
          )}
          {e.kind === 'countered' && <div className="countered-mark">✕</div>}
          {e.kind !== 'turn' && e.detail && <div className="effect-detail">{e.detail}</div>}
        </div>
      ))}
    </div>
  )
}
