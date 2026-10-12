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
  // when picking (e.g. a land out of a whole library), what can be picked comes first;
  // prompts that don't say which cards are legal (ordering triggers) allow all of them
  const anyMarked = cards.some((card) => mark(card.id, card))
  const pickable = (card: Card) => !onPick || !anyMarked || !!mark(card.id, card)
  const ordered = onPick ? [...cards.filter(pickable), ...cards.filter((c) => !pickable(c))] : cards
  return (
    <div className="card-grid">
      {ordered.map((card) => (
        <CardView
          key={card.id}
          card={card}
          shared={false}
          className={pickable(card) ? '' : 'dimmed'}
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

/**
 * Several of your triggers go on the stack at once: pick which goes first.
 * Each one can also be told to always go first or last, so the question stops coming.
 */
function TriggerOrderDialog({ prompt, abilities }: { prompt: Prompt; abilities: Card[] }) {
  const respond = useStore((s) => s.respond)
  const action = useStore((s) => s.action)
  const [menu, setMenu] = useState<string | null>(null)
  const remember = (ability: Card, kind: 'ABILITY_FIRST' | 'ABILITY_LAST' | 'NAME_FIRST' | 'NAME_LAST') => {
    const byName = kind.startsWith('NAME')
    action(`TRIGGER_AUTO_ORDER_${kind}`, byName ? plain(ability.rules.join(' ')) : ability.id)
    // "first": this one goes on the stack now; "last": nothing is picked, XMage asks again without it
    respond('uuid', kind.endsWith('FIRST') ? ability.id : null)
    setMenu(null)
  }
  return (
    <Modal title={plain(prompt.data.message) || 'Order your triggers'} wide>
      <div className="trigger-order">
        {abilities.map((ability) => (
          <div key={ability.id} className="trigger" data-trigger={ability.sourceCard?.name ?? ability.name}>
            <CardView card={ability} shared={false} onClick={() => respond('uuid', ability.id)} />
            <button className="btn ghost" data-trigger-menu onClick={() => setMenu(menu === ability.id ? null : ability.id)}>
              Always… ▾
            </button>
            {menu === ability.id && (
              <div className="menu">
                <button onClick={() => remember(ability, 'ABILITY_FIRST')}>Always put this ability first</button>
                <button onClick={() => remember(ability, 'ABILITY_LAST')}>Always put this ability last</button>
                <button onClick={() => remember(ability, 'NAME_FIRST')}>Always first: every ability with this text</button>
                <button onClick={() => remember(ability, 'NAME_LAST')}>Always last: every ability with this text</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <footer>
        <button className="btn ghost" data-trigger-reset onClick={() => action('TRIGGER_AUTO_ORDER_RESET_ALL')}>
          Forget remembered orders
        </button>
      </footer>
    </Modal>
  )
}

/** Targets of the prompt that sit in a graveyard or in exile, where they can't be clicked directly */
function offBoardTargets(prompt: Prompt): Card[] {
  const game = prompt.data.game
  const wanted = new Set([...(prompt.data.targets ?? []), ...((prompt.data.options?.possibleTargets as string[]) ?? [])])
  if (wanted.size === 0) return []
  const hidden = [
    ...game.players.flatMap((p) => [...p.graveyard, ...p.exile]),
    ...game.exiles.flatMap((l) => l.cards),
  ]
  const seen = new Set<string>()
  return hidden.filter((c) => wanted.has(c.id) && !seen.has(c.id) && seen.add(c.id))
}

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
    case 'GAME_TARGET': {
      // picking from cards that are not on the table: a library search or revealed cards (sent along
      // with the prompt), or targets lying in a graveyard / exile
      const picks = data.cards1 && data.cards1.length > 0 ? data.cards1 : offBoardTargets(prompt)
      if (picks.length === 0) return null
      if (data.options?.queryType === 'PICK_ABILITY') {
        return <TriggerOrderDialog key={prompt.messageId} prompt={prompt} abilities={picks} />
      }
      if (hidden === prompt.messageId) {
        return (
          <button className="btn primary reopen" onClick={() => setHidden(null)}>
            Show choices
          </button>
        )
      }
      return (
        <Modal title={plain(data.message) || 'Choose'} wide onClose={() => setHidden(prompt.messageId)}>
          <CardGrid cards={picks} onPick={(card) => respond('uuid', card.id)} />
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
    }
    default:
      return null
  }
}
