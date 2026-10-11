import type { Card, GameView, Player } from '../protocol/types'
import { CardView } from './CardView'

interface Slot {
  key: string
  cards: Card[] // identical permanents piled together (lands, tokens)
  attachments: Card[]
}

const isType = (card: Card, type: string) => card.types.includes(type)

function pileKey(card: Card, attacking: boolean): string | null {
  // only pile things that are indistinguishable at a glance
  if (attacking || card.counters.length > 0 || card.damage || (card.attachments?.length ?? 0) > 0) return null
  if (!isType(card, 'LAND') && !card.token) return null
  return [card.name, card.tapped, card.summoningSick, card.power, card.toughness].join('|')
}

function buildSlots(cards: Card[], all: Map<string, Card>, attacking: Set<string>): Slot[] {
  const slots: Slot[] = []
  const piles = new Map<string, Slot>()
  for (const card of cards) {
    const attachments = (card.attachments ?? []).map((id) => all.get(id)).filter((c): c is Card => !!c)
    const key = pileKey(card, attacking.has(card.id))
    const pile = key ? piles.get(key) : undefined
    if (pile && pile.cards.length < 8) {
      pile.cards.push(card)
      continue
    }
    const slot = { key: card.id, cards: [card], attachments }
    slots.push(slot)
    if (key) piles.set(key, slot)
  }
  return slots
}

function Row({ slots, attacking, blocking, className }: { slots: Slot[]; attacking: Set<string>; blocking: Set<string>; className: string }) {
  return (
    <div className={`bf-row ${className}`}>
        {slots.map((slot) => (
          <div
            key={slot.key}
            className={`bf-slot ${slot.cards[0].tapped ? 'slot-tapped' : ''}`}
            style={{ ['--pile' as string]: slot.cards.length - 1, ['--att' as string]: slot.attachments.length }}
          >
            {slot.attachments.map((card, i) => (
              <div key={card.id} className="attachment" style={{ ['--i' as string]: slot.attachments.length - i }}>
                <CardView card={card} />
              </div>
            ))}
            {slot.cards.map((card, i) => (
              <div key={card.id} className="piled" style={{ ['--i' as string]: i }}>
                <CardView card={card} attacking={attacking.has(card.id)} blocking={blocking.has(card.id)} />
              </div>
            ))}
            {slot.cards.length > 1 && <span className="pile-count">×{slot.cards.length}</span>}
          </div>
        ))}
    </div>
  )
}

export function Battlefield({ player, game, mine }: { player: Player; game: GameView; mine: boolean }) {
  const all = new Map<string, Card>()
  for (const p of game.players) for (const c of p.battlefield) all.set(c.id, c)
  const attacking = new Set(game.combat.flatMap((g) => g.attackers))
  const blocking = new Set(game.combat.flatMap((g) => g.blockers))

  // auras and equipment sit behind what they are attached to (when it is on this side of the table)
  const own = new Set(player.battlefield.map((c) => c.id))
  const free = player.battlefield.filter((c) => !(c.attachedToPermanent && c.attachedTo && own.has(c.attachedTo)))

  const creatures = free.filter((c) => isType(c, 'CREATURE'))
  const lands = free.filter((c) => isType(c, 'LAND') && !isType(c, 'CREATURE'))
  const others = free.filter((c) => !isType(c, 'CREATURE') && !isType(c, 'LAND'))

  const front = <Row key="front" className="front" slots={buildSlots(creatures, all, attacking)} attacking={attacking} blocking={blocking} />
  const back = (
    <div key="back" className="bf-back">
      <Row className="lands" slots={buildSlots(lands, all, attacking)} attacking={attacking} blocking={blocking} />
      <Row className="others" slots={buildSlots(others, all, attacking)} attacking={attacking} blocking={blocking} />
    </div>
  )
  return <div className={`battlefield ${mine ? 'mine' : 'theirs'}`}>{mine ? [front, back] : [back, front]}</div>
}
