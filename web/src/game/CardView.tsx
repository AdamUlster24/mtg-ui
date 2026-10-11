import { motion } from 'motion/react'
import { memo, useState } from 'react'
import type { Card } from '../protocol/types'
import { useStore } from '../store'
import { useInteraction } from './interaction'
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
        <span>{card.displayName || card.name}</span>
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
  if (card.faceDown || (!card.name && !card.isAbility)) {
    return <div className="face card-back" />
  }
  if (failed >= urls.length) {
    return <TextFace card={card} />
  }
  return (
    <div className="face">
      <img
        key={urls[failed]}
        src={urls[failed]}
        alt={card.name}
        draggable={false}
        loading="lazy"
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
}

export const CardView = memo(function CardView({ card, shared = true, className = '', onClick, attacking, blocking }: Props) {
  const setPreview = useStore((s) => s.setPreview)
  const { mark, click, active } = useInteraction()
  const state = mark(card.id, card)
  const pt = card.permanent && card.types.includes('CREATURE') ? `${card.power}/${card.toughness}` : null
  const loyalty = card.permanent ? card.loyalty || card.defense : null
  const classes = [
    'card',
    className,
    card.tapped ? 'tapped' : '',
    state ? `mark-${state}` : '',
    attacking ? 'attacking' : '',
    blocking ? 'blocking' : '',
    card.summoningSick && card.types.includes('CREATURE') ? 'sick' : '',
    card.phasedIn === false ? 'phased-out' : '',
    active && state ? 'clickable' : '',
  ]
  return (
    <motion.div
      layout={shared}
      layoutId={shared ? card.id : undefined}
      className={classes.filter(Boolean).join(' ')}
      data-oid={shared ? card.id : undefined}
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
      <div className="card-body">
        <CardFace card={card} />
        {card.damage ? <div className="badge damage">{card.damage}</div> : null}
        {card.counters.length > 0 && (
          <div className="counters">
            {card.counters.map((c) => (
              <span key={c.name} title={c.name}>
                {c.count} {c.name.length > 5 ? c.name.slice(0, 4) + '…' : c.name}
              </span>
            ))}
          </div>
        )}
        {pt && <div className={`badge pt ${card.damage ? 'hurt' : ''}`}>{pt}</div>}
        {!pt && loyalty && <div className="badge loyalty">{loyalty}</div>}
        {card.copy && <div className="badge copy">copy</div>}
      </div>
    </motion.div>
  )
})
