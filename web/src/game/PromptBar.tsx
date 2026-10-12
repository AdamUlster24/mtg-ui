import { useEffect, useState } from 'react'
import type { GameView, Prompt } from '../protocol/types'
import { useStore } from '../store'
import { passingMode } from './PlayerPanel'
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

/** XMage's "pass until ..." modes with the Swing client's default keys */
export const PASSES: [string, string, string][] = [
  ['PASS_PRIORITY_UNTIL_NEXT_TURN', 'Pass until next turn', 'F4'],
  ['PASS_PRIORITY_UNTIL_TURN_END_STEP', 'Pass until end step', 'F5'],
  ['PASS_PRIORITY_UNTIL_NEXT_TURN_SKIP_STACK', 'Pass until next turn, also things on the stack', 'F6'],
  ['PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE', 'Pass until next main phase', 'F7'],
  ['PASS_PRIORITY_UNTIL_MY_NEXT_TURN', 'Pass until my next turn', 'F9'],
  ['PASS_PRIORITY_UNTIL_STACK_RESOLVED', 'Pass until the stack resolves', 'F10'],
  ['PASS_PRIORITY_UNTIL_END_STEP_BEFORE_MY_NEXT_TURN', 'Pass until the end step before my turn', 'F11'],
  ['PASS_PRIORITY_CANCEL_ALL_ACTIONS', 'Stop passing', 'F3'],
]

const ROLLBACKS: [number, string][] = [
  [0, 'to the start of this turn'],
  [1, 'to the start of the previous turn'],
  [2, 'this turn and the 2 before'],
  [3, 'this turn and the 3 before'],
]

interface Props {
  prompt: Prompt | null
  game: GameView
  onSettings: () => void
  onHints: () => void
}

export function PromptBar({ prompt, game, onSettings, onHints }: Props) {
  const store = useStore()
  const [menu, setMenu] = useState(false)
  const [answers, setAnswers] = useState(false)
  const buttons = prompt ? buttonsFor(prompt, game, store) : []
  const waiting = !prompt || prompt.method === 'GAME_UPDATE_AND_INFORM'
  const message = prompt ? tidy(prompt.data.message ?? prompt.data.choice?.message) : 'Waiting…'
  const second = prompt ? plain(text(prompt.data.options?.secondMessage)) : ''
  const hint = prompt ? plain(text(prompt.data.options?.hintText)) : ''
  // XMage only takes back mana you tapped while holding priority; a spell being paid for is cancelled instead
  const self = game.players.find((p) => p.id === game.myPlayerId)
  const opponent = game.players.find((p) => p.id !== game.myPlayerId)
  const canUndo = prompt?.method === 'GAME_SELECT' && game.stack.length === 0 && (self?.undoSteps ?? 0) > 0
  const passing = self ? passingMode(self) : null
  // yes/no questions that belong to an ability can be answered once and for all
  const originalId = text(prompt?.data.options?.originalId)
  const autoMessage = text(prompt?.data.options?.autoAnswerMessage) ?? prompt?.data.message ?? ''
  const isQuestion = prompt?.method === 'GAME_ASK' && !/mulligan/i.test(plain(prompt.data.message))

  const undo = () => {
    store.action('UNDO')
    // XMage restores the state but answers with a stale board; an id that matches nothing makes it
    // send the prompt again with the real one (the Swing client uses the same trick after reconnects)
    store.respond('uuid', crypto.randomUUID())
  }
  const always = (answer: boolean, byAbility: boolean) => {
    const yes = answer ? 'YES' : 'NO'
    if (byAbility && originalId) store.action(`REQUEST_AUTO_ANSWER_ID_${yes}`, `${originalId}#${autoMessage}`)
    else store.action(`REQUEST_AUTO_ANSWER_TEXT_${yes}`, autoMessage)
    store.respond('boolean', answer)
    setAnswers(false)
  }
  const item = (label: string, run: () => void, key?: string, className?: string) => (
    <button
      key={label}
      className={className}
      onClick={() => {
        run()
        setMenu(false)
      }}
    >
      {label} {key && <kbd>{key}</kbd>}
    </button>
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return
      // like the Swing client: holding Ctrl keeps priority after casting, to respond to your own spell
      if (e.key === 'Control' || e.key === 'Meta') {
        store.setHoldPriority(e.type === 'keydown')
        return
      }
      if (e.type !== 'keydown') return
      const pass = PASSES.find((p) => p[2] === e.key)
      if (pass) {
        e.preventDefault()
        store.action(pass[0])
        return
      }
      if (e.key === 'F12') {
        // to the chat (the Swing client's "switch chat" key); opens the log if it was hidden
        e.preventDefault()
        store.savePrefs({ showLog: true })
        window.setTimeout(() => document.querySelector<HTMLInputElement>('.log-panel input')?.focus(), 0)
        return
      }
      if (e.key === 'F8') {
        e.preventDefault()
        store.action('TOGGLE_RECORD_MACRO')
        return
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && canUndo) {
        undo()
        return
      }
      const button = e.key === 'F2' ? buttons.find((b) => b.primary) ?? buttons[0] : buttons.find((b) => b.hotkey === e.key)
      if (button && !store.answering) {
        e.preventDefault()
        button.run()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  })

  return (
    <div className={`prompt-bar ${waiting ? 'waiting' : 'acting'}`} data-method={prompt?.method} data-message-id={prompt?.messageId}>
      <div className="prompt-text">
        <div className="prompt-message">
          <RichText html={message} />
        </div>
        {second && <div className="prompt-second">{second}</div>}
        {hint && <div className="prompt-second">{hint}</div>}
        {passing && (
          <button className="passing-chip" data-passing-chip onClick={() => store.action('PASS_PRIORITY_CANCEL_ALL_ACTIONS')} title="Stop passing (F3)">
            Passing {passing} · stop
          </button>
        )}
      </div>
      <div className="prompt-buttons">
        {buttons.map((b) => (
          <button key={b.label} className={b.primary ? 'btn primary big' : 'btn big'} disabled={store.answering} onClick={b.run}>
            {b.label}
          </button>
        ))}
      </div>
      <div className="prompt-tools">
        {isQuestion && (
          <button className="btn ghost" data-tool="always" onClick={() => setAnswers((v) => !v)} title="Answer this question the same way from now on">
            Always… ▾
          </button>
        )}
        {answers && isQuestion && (
          <div className="menu" onMouseLeave={() => setAnswers(false)}>
            {originalId && item('Always yes for this ability', () => always(true, true))}
            {originalId && item('Always no for this ability', () => always(false, true))}
            {item('Always yes for this question', () => always(true, false))}
            {item('Always no for this question', () => always(false, false))}
          </div>
        )}
        <button
          className={`btn ghost ${store.holdPriority ? 'on' : ''}`}
          data-tool="hold"
          onClick={() => store.setHoldPriority(!store.holdPriority)}
          title="Keep priority after casting, to respond to your own spell (or hold Ctrl while casting)"
        >
          {store.holdPriority ? 'Holding priority' : 'Hold priority'}
        </button>
        {canUndo && (
          <button className="btn ghost" onClick={undo} title="Undo (Ctrl+Z)">
            Undo
          </button>
        )}
        <button className="btn ghost" onClick={() => setMenu((m) => !m)}>
          More ▾
        </button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            <div className="menu-title">Pass priority</div>
            {PASSES.map(([action, label, key]) => item(label, () => store.action(action), key))}
            <hr />
            <div className="menu-title">Ask to roll back</div>
            {ROLLBACKS.map(([turns, label]) => item(`Roll back ${label}`, () => store.action('ROLLBACK_TURNS', turns)))}
            <hr />
            {item('Settings and stops…', onSettings)}
            {item('Hints…', onHints)}
            {item('Look at my sideboard', () => self && store.action('VIEW_SIDEBOARD', self.id))}
            {opponent && item(`Ask to see ${opponent.name}'s hand`, () => store.action('REQUEST_PERMISSION_TO_SEE_HAND_CARDS', opponent.id))}
            {item('Stop showing my hand to others', () => store.action('REVOKE_PERMISSIONS_TO_SEE_HAND_CARDS'))}
            {item('Record or stop a macro', () => store.action('TOGGLE_RECORD_MACRO'), 'F8')}
            {store.testMode && item('Test mode: run commands', () => void store.request('cheat').catch((e: Error) => store.notify('Test mode', e.message)))}
            <hr />
            {item('Concede this game', () => window.confirm('Concede this game?') && store.action('CONCEDE'), undefined, 'danger')}
            {item('Concede the match', () => window.confirm('Concede the whole match?') && void store.request('quitMatch').catch(() => {}), undefined, 'danger')}
          </div>
        )}
      </div>
    </div>
  )
}
