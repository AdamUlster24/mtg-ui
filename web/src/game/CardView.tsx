import { motion } from 'motion/react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Card, CardIcon } from '../protocol/types'
import { useStore } from '../store'
import { useInteraction } from './interaction'
import { animateEntrances, flyIn, speed, wasVisible } from './motion'
import { ManaCost, RichText, imageUrls } from './text'

const FRAME: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }

function frameClass(card: Card): string {
  const colors = card.frameColors || card.colors || ''
  if (colors.length > 1) return 'gold'
  if (colors.length === 1) return FRAME[colors] ?? 'colorless'
  return card.types?.includes('LAND') ? 'land' : 'colorless'
}

/** Short labels for the icons XMage attaches to cards (keyword abilities, counts, marks) */
const ICON_LABEL: Record<string, string> = {
  ABILITY_FLYING: 'Fly',
  ABILITY_DEFENDER: 'Def',
  ABILITY_DEATHTOUCH: 'Dth',
  ABILITY_LIFELINK: 'Lnk',
  ABILITY_DOUBLE_STRIKE: '2xS',
  ABILITY_FIRST_STRIKE: '1st',
  ABILITY_CREW: 'Crew',
  ABILITY_TRAMPLE: 'Tra',
  ABILITY_HEXPROOF: 'Hex',
  ABILITY_INFECT: 'Inf',
  ABILITY_INDESTRUCTIBLE: 'Ind',
  ABILITY_VIGILANCE: 'Vig',
  ABILITY_CLASS_LEVEL: 'Lvl',
  ABILITY_REACH: 'Rch',
  OTHER_FACEDOWN: 'Face-down',
  OTHER_COST_X: 'X',
  OTHER_HAS_RESTRICTIONS: '!',
  OTHER_HAS_TARGETS: '◎',
  RINGBEARER: 'Ring',
  COMMANDER: 'Cmd',
  PLAYABLE_COUNT: '▶',
}

export const iconName = (icon: CardIcon) =>
  icon.type
    .replace(/^(ABILITY|OTHER)_/, '')
    .replace(/_/g, ' ')
    .toLowerCase()

function Icons({ icons }: { icons?: CardIcon[] }) {
  const shown = (icons ?? []).filter((i) => i.type !== 'SYSTEM_COMBINED' && i.type !== 'SYSTEM_DEBUG')
  if (shown.length === 0) return null
  return (
    <div className="card-icons">
      {shown.map((icon, i) => (
        <span key={icon.type + i} className={`card-icon icon-${icon.type.toLowerCase()}`} data-icon={icon.type} title={`${iconName(icon)}${icon.hint ? ` — ${icon.hint.replace(/<[^>]+>/g, ' ')}` : ''}`}>
          {ICON_LABEL[icon.type] ?? iconName(icon)}
          {icon.text ? <b>{icon.text}</b> : null}
        </span>
      ))}
    </div>
  )
}

/** What kind of face-down thing a permanent is */
export function faceDownKind(card: Card): string | null {
  if (card.morphed) return 'Morph'
  if (card.disguised) return 'Disguise'
  if (card.manifested) return 'Manifest'
  if (card.cloaked) return 'Cloak'
  return card.faceDown && card.permanent ? 'Face-down' : null
}

/** Drawn card frame, used when there is no art (abilities, emblems, unknown tokens) and while art loads */
function TextFace({ card }: { card: Card }) {
  const creature = card.types?.includes('CREATURE')
  const pt = creature ? `${card.power}/${card.toughness}` : card.loyalty || card.defense
  const halves = card.leftHalf && card.rightHalf ? [card.leftHalf, card.rightHalf] : null
  return (
    <div className={`face text-face frame-${frameClass(card)}`}>
      <div className="tf-title">
        <span>{(card.isAbility && card.sourceCard?.name) || card.displayName || card.name}</span>
        <ManaCost cost={card.manaCost} />
      </div>
      <div className="tf-type">{card.isAbility ? 'Ability' : card.typeLine || card.commandKind}</div>
      <div className="tf-rules">
        {halves
          ? halves.map((half) => (
              <p key={half.name}>
                <b>{half.name}</b> <ManaCost cost={half.manaCost} />
                <br />
                <RichText html={half.rules.join(' ')} />
              </p>
            ))
          : card.rules.map((rule, i) => (
              <p key={i}>
                <RichText html={rule} />
              </p>
            ))}
      </div>
      {pt && <div className="tf-pt">{pt}</div>}
    </div>
  )
}

export function CardFace({ card }: { card: Card }) {
  const urls = imageUrls(card)
  const [failed, setFailed] = useState(0)
  const [loaded, setLoaded] = useState(false)
  if (card.faceDown || (!card.name && !card.isAbility)) {
    return <div className="face card-back" />
  }
  if (failed >= urls.length) {
    return <TextFace card={card} />
  }
  return (
    <div className={`face ${loaded ? 'art-loaded' : 'art-loading'}`}>
      {/* readable right away; the art fades in over it once it has arrived */}
      {!loaded && <TextFace card={card} />}
      <img
        key={urls[failed]}
        src={urls[failed]}
        alt={card.name}
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed((n) => n + 1)}
      />
      {card.isAbility && (
        <div className="ability-strip">
          <b>{card.abilityType === 'TRIGGERED' ? 'Triggered' : 'Ability'}</b>
          <span>
            <RichText html={card.rules.join(' ')} />
          </span>
        </div>
      )}
    </div>
  )
}

/** "+1" / "−2" floating off a card when the total of its counters changes */
function useCounterChanges(card: Card) {
  const total = card.counters.reduce((sum, c) => sum + c.count, 0)
  const last = useRef(total)
  const [changes, setChanges] = useState<{ key: number; delta: number }[]>([])
  useEffect(() => {
    const delta = total - last.current
    last.current = total
    if (delta === 0 || speed() === 0) return
    const key = Date.now() + Math.random()
    setChanges((list) => [...list, { key, delta }])
    const timer = window.setTimeout(() => setChanges((list) => list.filter((c) => c.key !== key)), 1300)
    return () => window.clearTimeout(timer)
  }, [total])
  return changes
}

interface Props {
  card: Card
  /** animate between zones by id; off for copies shown in dialogs */
  shared?: boolean
  className?: string
  /** dialogs handle clicks themselves */
  onClick?: () => void
  attacking?: boolean
  blocking?: boolean
  /** where the card flies in from when it was not on the table before (selector or position); default: pops in */
  enterFrom?: string | DOMRect | null
}

export const CardView = memo(function CardView({ card, shared = true, className = '', onClick, attacking, blocking, enterFrom }: Props) {
  const body = useRef<HTMLDivElement>(null)
  // cards that were visible a moment ago are moved by their layout id; new ones fly in from their origin
  useLayoutEffect(() => {
    if (shared && body.current && animateEntrances() && !wasVisible(card.id)) {
      flyIn(body.current, typeof enterFrom === 'string' ? document.querySelector(enterFrom) : (enterFrom ?? null))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setPreview = useStore((s) => s.setPreview)
  const animations = useStore((s) => s.prefs.animations)
  const { mark, click, active } = useInteraction()
  const state = mark(card.id, card)
  const creature = card.types.includes('CREATURE')
  const pt = card.permanent && creature ? `${card.power}/${card.toughness}` : null
  const loyalty = card.permanent ? card.loyalty || card.defense : null
  // loyalty and defense already have their own badge
  const counters = card.counters.filter((c) => !(loyalty && /^(loyalty|defense)$/i.test(c.name)))
  const counterChanges = useCounterChanges(card)
  const hidden = faceDownKind(card)
  const boosted = pt && card.basePower !== undefined && (Number(card.power) > card.basePower || Number(card.toughness) > (card.baseToughness ?? 0))
  const shrunk = pt && card.basePower !== undefined && (Number(card.power) < card.basePower || Number(card.toughness) < (card.baseToughness ?? 0))
  const classes = [
    'card',
    className,
    card.tapped ? 'tapped' : '',
    state ? `mark-${state}` : '',
    attacking ? 'attacking' : '',
    blocking ? 'blocking' : '',
    card.summoningSick && creature ? 'sick' : '',
    card.phasedIn === false ? 'phased-out' : '',
    card.damage ? 'damaged' : '',
    card.flipped ? 'flipped' : '',
    card.token ? 'is-token' : '',
    active && state ? 'clickable' : '',
  ]
  const spring = animations === 'off' ? { duration: 0 } : { type: 'spring' as const, stiffness: animations === 'fast' ? 700 : 380, damping: animations === 'fast' ? 45 : 34, mass: 0.9 }
  return (
    <motion.div
      layout={shared}
      layoutId={shared ? card.id : undefined}
      className={classes.filter(Boolean).join(' ')}
      data-oid={shared ? card.id : undefined}
      data-card-id={card.id}
      data-name={card.name}
      initial={false}
      transition={spring}
      onMouseEnter={() => setPreview(card)}
      onMouseLeave={() => setPreview(null)}
      onClick={(e) => {
        e.stopPropagation()
        if (onClick) onClick()
        else click(card.id)
      }}
    >
      <div className="card-body" ref={body}>
        <CardFace card={card} />
        <Icons icons={card.icons} />
        {/* key: the hit animation plays again every time the damage changes */}
        {card.damage ? (
          <div key={card.damage} className="badge damage">
            {card.damage}
          </div>
        ) : null}
        {counters.length > 0 && (
          <div className="counters">
            {counters.map((c) => (
              <span key={c.name + c.count} title={c.name} data-counter={c.name}>
                {c.count} {c.name.length > 5 ? c.name.slice(0, 4) + '…' : c.name}
              </span>
            ))}
          </div>
        )}
        {counterChanges.map((c) => (
          <span key={c.key} className={`counter-change ${c.delta < 0 ? 'lost' : 'gained'}`}>
            {c.delta > 0 ? `+${c.delta}` : `−${-c.delta}`}
          </span>
        ))}
        {pt && (
          <div key={pt} className={`badge pt ${card.damage ? 'hurt' : ''} ${boosted ? 'boosted' : ''} ${shrunk ? 'shrunk' : ''}`}>
            {pt}
          </div>
        )}
        {!pt && loyalty && (
          <div key={loyalty} className="badge loyalty">
            {loyalty}
          </div>
        )}
        <div className="marks">
          {card.copy && <span className="mark-chip copy">copy</span>}
          {hidden && <span className="mark-chip hidden-kind">{hidden}</span>}
          {card.mutated && <span className="mark-chip mutated" title={card.mutateView ? `Mutated: ${card.mutateView.name}` : 'Mutated'}>mutated</span>}
          {card.permanent && card.controlledByOwner === false && <span className="mark-chip stolen" title={`Owned by ${card.ownerName || 'the opponent'}`}>stolen</span>}
          {card.pairedCard && <span className="mark-chip paired" title="Paired (soulbond)">paired</span>}
          {(card.bandedCards?.length ?? 0) > 0 && <span className="mark-chip banded">band</span>}
          {card.transformed && <span className="mark-chip transformed">transformed</span>}
        </div>
      </div>
    </motion.div>
  )
})
