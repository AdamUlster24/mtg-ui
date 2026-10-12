import type { GameView } from '../protocol/types'
import { useStore } from '../store'

/**
 * XMage sends whole board snapshots, never "this card moved". Cards that stay visible are animated by
 * their shared layout id (see CardView). This module covers the rest by comparing snapshots:
 *  - cards that appear from a hidden zone fly in from where they came from (library, opponent's hand)
 *  - cards that vanish into a hidden zone leave a "ghost" that flies there
 */

const DURATION = 420
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/** every card that has its own element on the table */
function visibleIds(game: GameView | null): Set<string> {
  const ids = new Set<string>()
  if (!game) return ids
  for (const c of game.hand) ids.add(c.id)
  for (const c of game.stack) ids.add(c.id)
  for (const p of game.players) {
    for (const c of p.battlefield) ids.add(c.id)
    for (const c of p.commandZone) ids.add(c.id)
    const grave = p.graveyard.at(-1)
    const exile = p.exile.at(-1)
    if (grave) ids.add(grave.id)
    if (exile) ids.add(exile.id)
  }
  return ids
}

let previous = new Set<string>()
let hadGame = false
const handShrank = new Set<string>()

/** was this card already on screen before the current snapshot */
export const wasVisible = (id: string) => previous.has(id)
/** false for the very first snapshot (page load): nothing should fly in then */
export const animateEntrances = () => hadGame
/** the player's hand got smaller with the current snapshot, i.e. they played something from it */
export const playedFromHand = (playerId: string) => handShrank.has(playerId)

const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })

/** Moves `el` (already at its final place) in from `origin` */
export function flyIn(el: HTMLElement, origin: Element | null, delay = 0) {
  const to = el.getBoundingClientRect()
  if (!origin || to.width === 0) {
    el.animate(
      [
        { transform: 'scale(0.55)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: 300, easing: EASING, delay, fill: 'backwards' },
    )
    return
  }
  const from = origin.getBoundingClientRect()
  const a = center(from)
  const b = center(to)
  const scale = Math.max(0.2, Math.min(1.5, from.width / to.width))
  el.animate(
    [
      { transform: `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(${scale})`, opacity: 0.4 },
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    ],
    { duration: DURATION, easing: EASING, delay, fill: 'backwards' },
  )
}

function ghostLayer(): HTMLElement {
  let layer = document.getElementById('ghost-layer')
  if (!layer) {
    layer = document.createElement('div')
    layer.id = 'ghost-layer'
    document.body.appendChild(layer)
  }
  return layer
}

/** A copy of a card that is about to disappear, flying to `target` (or just fading) */
function flyOut(el: HTMLElement, target: Element | null) {
  const from = el.getBoundingClientRect()
  if (from.width === 0) return
  const ghost = el.cloneNode(true) as HTMLElement
  // the copy must not be found by arrows or tests
  for (const node of [ghost, ...Array.from(ghost.querySelectorAll<HTMLElement>('[data-oid], [data-card-id]'))]) {
    node.removeAttribute('data-oid')
    node.removeAttribute('data-card-id')
    node.removeAttribute('data-name')
  }
  ghost.classList.add('fly-ghost')
  ghost.style.cssText = `position:fixed;left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;margin:0;transform:none;`
  ghostLayer().appendChild(ghost)

  let end = 'scale(0.5)'
  if (target) {
    const a = center(from)
    const b = center(target.getBoundingClientRect())
    const scale = Math.max(0.2, Math.min(1.2, target.getBoundingClientRect().width / from.width))
    end = `translate(${b.x - a.x}px, ${b.y - a.y}px) scale(${scale})`
  }
  ghost
    .animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: end, opacity: target ? 0.25 : 0 },
      ],
      { duration: DURATION, easing: EASING, fill: 'forwards' },
    )
    .finished.finally(() => ghost.remove())
}

function onSnapshot(next: GameView | null, prev: GameView | null) {
  hadGame = !!prev
  previous = visibleIds(prev)
  handShrank.clear()
  if (!next || !prev) return

  const before = new Map(prev.players.map((p) => [p.id, p]))
  for (const p of next.players) {
    const old = before.get(p.id)
    if (old && p.handCount < old.handCount) handShrank.add(p.id)
  }

  const now = visibleIds(next)
  for (const id of previous) {
    if (now.has(id)) continue
    // this runs before React re-renders, so the card's element is still where it was
    const el = document.querySelector<HTMLElement>(`[data-oid="${id}"]`)
    if (!el) continue
    flyOut(el, destination(id, el, next, before))
  }
}

/** Where a card that left the table went, as far as the snapshots tell */
function destination(id: string, el: HTMLElement, next: GameView, before: Map<string, GameView['players'][number]>): Element | null {
  for (const p of next.players) {
    if (p.graveyard.some((c) => c.id === id)) return document.querySelector(`[data-pile="graveyard-${p.id}"]`)
    if (p.exile.some((c) => c.id === id)) return document.querySelector(`[data-pile="exile-${p.id}"]`)
  }
  if (next.exiles.some((l) => l.cards.some((c) => c.id === id))) {
    // exiled "by" something (Oblivion Ring and friends): shown in the exile list chips, no pile to fly to
    return document.querySelector('.zone-chips')
  }
  // back to a hand or a library: only the counts tell which
  const mine = !el.closest('.theirs') && !el.closest('.top')
  const owner = next.players.find((p) => (p.id === next.myPlayerId) === mine)
  const old = owner && before.get(owner.id)
  if (!owner || !old) return null
  if (owner.handCount > old.handCount) return document.querySelector(mine ? '.hand' : '.opp-hand')
  if (owner.libraryCount > old.libraryCount) return document.querySelector(`[data-pile="library-${owner.id}"]`)
  return null
}

useStore.subscribe((state, prev) => {
  if (state.game !== prev.game) onSnapshot(state.game, prev.game)
})
