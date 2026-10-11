import { useState, type ReactNode } from 'react'
import type { Card, Prompt } from '../protocol/types'
import { useStore } from '../store'
import { CardView } from './CardView'
import { useInteraction } from './interaction'
import { RichText, plain } from './text'

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose?: () => void; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>{title}</h3>
          {onClose && (
            <button className="btn ghost" onClick={onClose}>
              ✕
            </button>
          )}
        </header>
        {children}
      </div>
    </div>
  )
}

export function CardGrid({ cards, onPick }: { cards: Card[]; onPick?: (card: Card) => void }) {
  const { mark } = useInteraction()
  if (cards.length === 0) return <p className="muted">Empty</p>
  return (
    <div className="card-grid">
      {cards.map((card) => (
        <CardView
          key={card.id}
          card={card}
          shared={false}
          className={onPick && !mark(card.id, card) ? 'dimmed' : ''}
          onClick={onPick ? () => onPick(card) : undefined}
        />
      ))}
    </div>
  )
}

function ChoiceDialog({ prompt }: { prompt: Prompt }) {
  const respond = useStore((s) => s.respond)
  const choice = prompt.data.choice!
  const [filter, setFilter] = useState('')
  const items = choice.items.filter((i) => plain(i.text).toLowerCase().includes(filter.toLowerCase()))
  return (
    <Modal title={plain(choice.message) || 'Choose'} onClose={choice.required ? undefined : () => respond('string', null)}>
      {choice.subMessage && <p className="muted">{plain(choice.subMessage)}</p>}
      {choice.items.length > 12 && <input autoFocus placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      <div className="option-list">
        {items.map((item) => (
          <button key={item.key} onClick={() => respond('string', item.key)}>
            <RichText html={item.text} />
          </button>
        ))}
      </div>
    </Modal>
  )
}

function AmountDialog({ prompt }: { prompt: Prompt }) {
  const respond = useStore((s) => s.respond)
  const min = prompt.data.min ?? 0
  const max = prompt.data.max ?? 0
  const [value, setValue] = useState(min)
  const clamp = (n: number) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min))
  return (
    <Modal title={plain(prompt.data.message) || 'Choose a number'}>
      <div className="amount">
        <button className="btn" onClick={() => setValue((v) => clamp(v - 1))}>
          −
        </button>
        <input type="number" autoFocus min={min} max={max} value={value} onChange={(e) => setValue(clamp(e.target.valueAsNumber))} />
        <button className="btn" onClick={() => setValue((v) => clamp(v + 1))}>
          +
        </button>
        <button className="btn ghost" onClick={() => setValue(max)}>
          Max {max}
        </button>
      </div>
      <footer>
        <button className="btn primary" onClick={() => respond('integer', value)}>
          Confirm
        </button>
      </footer>
    </Modal>
  )
}

function MultiAmountDialog({ prompt }: { prompt: Prompt }) {
  const respond = useStore((s) => s.respond)
  const rows = prompt.data.multiAmount ?? []
  const [values, setValues] = useState(rows.map((r) => r.defaultValue))
  const total = values.reduce((a, b) => a + b, 0)
  const min = prompt.data.min ?? 0
  const max = prompt.data.max ?? 0
  const valid = total >= min && total <= max
  return (
    <Modal title={plain(text(prompt.data.options?.title)) || 'Distribute'}>
      <p className="muted">
        {plain(text(prompt.data.options?.header))} Total {total} (needs {min === max ? min : `${min}–${max}`})
      </p>
      <div className="multi-amount">
        {rows.map((row, i) => (
          <label key={i}>
            <span>
              <RichText html={row.message} />
            </span>
            <input
              type="number"
              min={row.min}
              max={row.max}
              value={values[i]}
              onChange={(e) => setValues(values.map((v, j) => (j === i ? Math.max(row.min, Math.min(row.max, e.target.valueAsNumber || 0)) : v)))}
            />
          </label>
        ))}
      </div>
      <footer>
        <button className="btn primary" disabled={!valid} onClick={() => respond('string', values.join(' '))}>
          Confirm
        </button>
      </footer>
    </Modal>
  )
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Dialog for the prompts that can't be answered by clicking on the board */
export function PromptDialog({ prompt }: { prompt: Prompt }) {
  const respond = useStore((s) => s.respond)
  const [hidden, setHidden] = useState<number | null>(null)
  const data = prompt.data

  switch (prompt.method) {
    case 'GAME_CHOOSE_CHOICE':
      return data.choice ? <ChoiceDialog key={prompt.messageId} prompt={prompt} /> : null
    case 'GAME_GET_AMOUNT':
      return <AmountDialog key={prompt.messageId} prompt={prompt} />
    case 'GAME_GET_MULTI_AMOUNT':
      return <MultiAmountDialog key={prompt.messageId} prompt={prompt} />
    case 'GAME_CHOOSE_ABILITY':
      return (
        <Modal title={plain(data.message) || 'Choose an ability'} onClose={() => respond('boolean', false)}>
          <div className="option-list">
            {(data.abilities ?? []).map((a) => (
              <button key={a.id} onClick={() => respond('uuid', a.id)}>
                <RichText html={a.text} />
              </button>
            ))}
          </div>
        </Modal>
      )
    case 'GAME_CHOOSE_PILE':
      return (
        <Modal title={plain(data.message) || 'Choose a pile'} wide>
          <div className="piles-choice">
            {[data.cards1 ?? [], data.cards2 ?? []].map((pile, i) => (
              <section key={i}>
                <CardGrid cards={pile} />
                <button className="btn primary" onClick={() => respond('boolean', i === 0)}>
                  Pile {i + 1}
                </button>
              </section>
            ))}
          </div>
        </Modal>
      )
    case 'GAME_TARGET':
      // picking from cards that are not on the table (library search, graveyard, revealed cards)
      if (!data.cards1 || data.cards1.length === 0) return null
      if (hidden === prompt.messageId) {
        return (
          <button className="btn primary reopen" onClick={() => setHidden(null)}>
            Show choices
          </button>
        )
      }
      return (
        <Modal title={plain(data.message) || 'Choose'} wide onClose={() => setHidden(prompt.messageId)}>
          <CardGrid cards={data.cards1} onPick={(card) => respond('uuid', card.id)} />
          <footer>
            <button className="btn ghost" onClick={() => setHidden(prompt.messageId)}>
              Look at the board
            </button>
            {!data.required && (
              <button className="btn" onClick={() => respond('boolean', false)}>
                {text(data.options?.['UI.right.btn.text']) || 'Done'}
              </button>
            )}
          </footer>
        </Modal>
      )
    default:
      return null
  }
}
