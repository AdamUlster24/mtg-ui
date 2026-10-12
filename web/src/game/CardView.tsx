import { motion } from 'motion/react'
import { memo, useLayoutEffect, useRef, useState } from 'react'
import type { Card } from '../protocol/types'
import { useStore } from '../store'
import { useInteraction } from './interaction'
import { animateEntrances, flyIn, wasVisible } from './motion'
import { ManaCost, RichText, imageUrls } from './text'

const FRAME: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }

function frameClass(card: Card): string {
  const colors = card.frameColors || card.colors || ''
  if (colors.length > 1) return 'gold'
  if (colors.length === 1) return FRAME[colors] ?? 'colorless'
  return card.types?.includes('LAND') ? 'land' : 'colorless'
}

/** Drawn card frame, used when there is no art (abilities, emblems, unknown tokens) */
function TextFace({ card }: { card: Card }) {
  const pt = card.types?.includes('CREATURE') ? `${card.power}/${card.toughness}` : card.loyalty || card.defense
  return (
    <div className={`face text-face frame-${frameClass(card)}`}>
      <div className="tf-title">
        <span>{(card.isAbility && card.sourceCard?.name) || card.displayName || card.name}</span>
        <ManaCost cost={card.manaCost} />
      </div>
      <div className="tf-type">{card.isAbility ? 'Ability' : card.typeLine || card.commandKind}</div>
      <div className="tf-rules">
        {card.rules.map((rule, i) => (
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

interface Props {
  card: Card
  /** animate between zones by id; off for copies shown in dialogs */
  shared?: boolean
  className?: string
  /** dialogs handle clicks themselves */
  onClick?: () => void
  attacking?: boolean
  blocking?: boolean
  /** where the card flies in from when it was not on the table before (CSS selector); default: pops in */
  enterFrom?: string | null
}

export const CardView = memo(function CardView({ card, shared = true, className = '', onClick, attacking, blocking, enterFrom }: Props) {
  const body = useRef<HTMLDivElement>(null)
  // cards that were visible a moment ago are moved by their layout id; new ones fly in from their origin
  useLayoutEffect(() => {
    if (shared && body.current && animateEntrances() && !wasVisible(card.id)) {
      flyIn(body.current, enterFrom ? document.querySelector(enterFrom) : null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const setPreview = useStore((s) => s.setPreview)
  const { mark, click, active } = useInteraction()
  const state = mark(card.id, card)
  const pt = card.permanent && card.types.includes('CREATURE') ? `${card.power}/${card.toughness}` : null
  const loyalty = card.permanent ? card.loyalty || card.defense : null
  // loyalty and defense already have their own badge
  const counters = card.counters.filter((c) => !(loyalty && /^(loyalty|defense)$/i.test(c.name)))
  const classes = [
    'card',
    className,
    card.tapped ? 'tapped' : '',
    state ? `mark-${state}` : '',
    attacking ? 'attacking' : '',
    blocking ? 'blocking' : '',
    card.summoningSick && card.types.includes('CREATURE') ? 'sick' : '',
    card.phasedIn === false ? 'phased-out' : '',
    card.damage ? 'damaged' : '',
    active && state ? 'clickable' : '',
  ]
  return (
    <motion.div
      layout={shared}
      layoutId={shared ? card.id : undefined}
      className={classes.filter(Boolean).join(' ')}
      data-oid={shared ? card.id : undefined}
      data-card-id={card.id}
      data-name={card.name}
      initial={false}
      transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }}
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
        {card.damage ? (
          <div key={card.damage} className="badge damage">
            {card.damage}
          </div>
        ) : null}
        {counters.length > 0 && (
          <div className="counters">
            {counters.map((c) => (
              <span key={c.name + c.count} title={c.name}>
                {c.count} {c.name.length > 5 ? c.name.slice(0, 4) + '…' : c.name}
              </span>
            ))}
          </div>
        )}
        {pt && (
          <div key={pt} className={`badge pt ${card.damage ? 'hurt' : ''}`}>
            {pt}
          </div>
        )}
        {!pt && loyalty && (
          <div key={loyalty} className="badge loyalty">
            {loyalty}
          </div>
        )}
        {card.copy && <div className="badge copy">copy</div>}
      </div>
    </motion.div>
  )
})
