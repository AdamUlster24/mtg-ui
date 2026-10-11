import { useEffect, useState } from 'react'
import type { GameView, Prompt } from '../protocol/types'
import { useStore } from '../store'
import { RichText, plain, tidy } from './text'

interface Button {
  label: string
  primary?: boolean
  run: () => void
  hotkey?: string
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

/** Which buttons a prompt needs; mirrors the Swing client's FeedbackPanel modes */
function buttonsFor(prompt: Prompt, game: GameView, s: ReturnType<typeof useStore.getState>): Button[] {
  const options = prompt.data.options ?? {}
  const message = plain(prompt.data.message)
  const yes = () => s.respond('boolean', true)
  const no = () => s.respond('boolean', false)
  const special = text(options.specialButton) ?? (game.special ? 'Special' : undefined)
  const extra: Button[] = special ? [{ label: special, run: () => s.respond('string', 'special') }] : []

  switch (prompt.method) {
    case 'GAME_ASK':
      return [
        { label: text(options['UI.left.btn.text']) ?? 'Yes', primary: true, run: yes, hotkey: 'y' },
        { label: text(options['UI.right.btn.text']) ?? 'No', run: no, hotkey: 'n' },
      ]
    case 'GAME_SELECT': {
      let label = game.stack.length > 0 ? 'Resolve' : 'Pass'
      if (/attackers/i.test(message)) label = game.combat.length > 0 ? 'Attack' : 'No attacks'
      else if (/blockers/i.test(message)) label = game.combat.some((g) => g.blockers.length > 0) ? 'Block' : 'No blocks'
      return [{ label: text(options['UI.right.btn.text']) ?? label, primary: true, run: no, hotkey: ' ' }, ...extra]
    }
    case 'GAME_TARGET':
      return prompt.data.required ? extra : [{ label: text(options['UI.right.btn.text']) ?? 'Cancel', run: no, hotkey: 'Escape' }, ...extra]
    case 'GAME_PLAY_MANA':
      return [{ label: 'Cancel', run: no, hotkey: 'Escape' }, ...extra]
    case 'GAME_PLAY_XMANA':
      return [
        { label: 'OK', primary: true, run: yes, hotkey: ' ' },
        { label: 'Cancel', run: no, hotkey: 'Escape' },
      ]
    case 'GAME_OVER':
      return [{ label: 'Leave game', primary: true, run: s.leaveGame }]
    default:
      return []
  }
}

const PASSES: [string, string, string][] = [
  ['PASS_PRIORITY_UNTIL_NEXT_TURN', 'Pass until next turn', 'F4'],
  ['PASS_PRIORITY_UNTIL_TURN_END_STEP', 'Pass until end step', 'F5'],
  ['PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE', 'Pass until next main phase', 'F7'],
  ['PASS_PRIORITY_UNTIL_STACK_RESOLVED', 'Pass until stack resolves', 'F8'],
  ['PASS_PRIORITY_UNTIL_MY_NEXT_TURN', 'Pass until my next turn', 'F9'],
  ['PASS_PRIORITY_CANCEL_ALL_ACTIONS', 'Stop passing', 'F3'],
]

export function PromptBar({ prompt, game }: { prompt: Prompt | null; game: GameView }) {
  const store = useStore()
  const [menu, setMenu] = useState(false)
  const [autoMana, setAutoMana] = useState(true)
  const buttons = prompt ? buttonsFor(prompt, game, store) : []
  const waiting = !prompt || prompt.method === 'GAME_UPDATE_AND_INFORM'
  const message = prompt ? tidy(prompt.data.message ?? prompt.data.choice?.message) : 'Waiting…'
  const second = prompt ? plain(text(prompt.data.options?.secondMessage)) : ''
  const canUndo = prompt?.method === 'GAME_PLAY_MANA' || prompt?.method === 'GAME_SELECT'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return
      const pass = PASSES.find((p) => p[2] === e.key)
      if (pass) {
        e.preventDefault()
        store.action(pass[0])
        return
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && canUndo) {
        store.action('UNDO')
        return
      }
      const button = buttons.find((b) => b.hotkey === e.key)
      if (button) {
        e.preventDefault()
        button.run()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className={`prompt-bar ${waiting ? 'waiting' : 'acting'}`} data-method={prompt?.method} data-message-id={prompt?.messageId}>
      <div className="prompt-text">
        <div className="prompt-message">
          <RichText html={message} />
        </div>
        {second && <div className="prompt-second">{second}</div>}
      </div>
      <div className="prompt-buttons">
        {buttons.map((b) => (
          <button key={b.label} className={b.primary ? 'btn primary big' : 'btn big'} disabled={store.answering} onClick={b.run}>
            {b.label}
          </button>
        ))}
      </div>
      <div className="prompt-tools">
        {canUndo && (
          <button className="btn ghost" onClick={() => store.action('UNDO')} title="Undo (Ctrl+Z)">
            Undo
          </button>
        )}
        <button className="btn ghost" onClick={() => setMenu((m) => !m)}>
          More ▾
        </button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            {PASSES.map(([action, label, key]) => (
              <button
                key={action}
                onClick={() => {
                  store.action(action)
                  setMenu(false)
                }}
              >
                {label} <kbd>{key}</kbd>
              </button>
            ))}
            <hr />
            <button
              onClick={() => {
                store.action(autoMana ? 'MANA_AUTO_PAYMENT_OFF' : 'MANA_AUTO_PAYMENT_ON')
                setAutoMana(!autoMana)
                setMenu(false)
              }}
            >
              Spend mana pool automatically <kbd>{autoMana ? 'on' : 'off'}</kbd>
            </button>
            {store.testMode && (
              <button
                onClick={() => {
                  setMenu(false)
                  store.request('cheat').catch((e: Error) => store.notify('Test mode', e.message))
                }}
              >
                Test mode: run commands
              </button>
            )}
            <button
              className="danger"
              onClick={() => {
                setMenu(false)
                if (window.confirm('Concede this game?')) store.action('CONCEDE')
              }}
            >
              Concede
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
