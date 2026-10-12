import { Component, useEffect, useState, type ReactNode } from 'react'
import { GameScreen } from './screens/GameScreen'
import { Lobby } from './screens/Lobby'
import { Sideboard } from './screens/Sideboard'
import { useStore } from './store'

/**
 * A rendering error must never leave the player with a blank page in the middle of a game:
 * say what happened and offer to redraw (the game itself lives on the server).
 */
class Safety extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="center-screen">
        <div className="panel gate" data-crash>
          <h1>Display problem</h1>
          <p className="muted">The game is still running. Drawing the screen failed: {this.state.error.message}</p>
          <button className="btn primary big" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button className="btn" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        </div>
      </div>
    )
  }
}

function Gate() {
  const { screen, login, submitPassword, passwordError, notify } = useStore()
  const [value, setValue] = useState(() => (screen === 'login' ? (localStorage.getItem('mtgui.name') ?? '') : ''))
  const [busy, setBusy] = useState(false)
  const password = screen === 'password'

  useEffect(() => setValue(password ? '' : (localStorage.getItem('mtgui.name') ?? '')), [password])

  return (
    <div className="center-screen">
      <form
        className="panel gate"
        onSubmit={async (e) => {
          e.preventDefault()
          if (password) {
            submitPassword(value)
            return
          }
          setBusy(true)
          localStorage.setItem('mtgui.name', value)
          try {
            await login(value)
          } catch (err) {
            notify('Sign in', (err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <h1>MTG UI</h1>
        <p className="muted">{password ? 'This table is private. Enter the password your host gave you.' : 'Pick a name to play under.'}</p>
        <input
          autoFocus
          type={password ? 'password' : 'text'}
          placeholder={password ? 'Password' : 'Your name'}
          value={value}
          maxLength={password ? 100 : 14}
          onChange={(e) => setValue(e.target.value)}
        />
        {password && passwordError && <div className="deck-error">{passwordError}</div>}
        <button className="btn primary big" disabled={busy || !value.trim()}>
          {password ? 'Continue' : 'Enter'}
        </button>
      </form>
    </div>
  )
}

function Notices() {
  const { notices, dismissNotice, userRequest, dismissUserRequest, action } = useStore()
  return (
    <>
      <div className="notices">
        {notices.map((n) => (
          <div key={n.key} className="notice" onClick={() => dismissNotice(n.key)}>
            <b>{n.title}</b>
            <span>{n.message.replace(/<[^>]+>/g, ' ')}</span>
          </div>
        ))}
      </div>
      {userRequest && (
        <div className="modal-backdrop">
          <div className="modal">
            <header>
              <h3>{userRequest.title}</h3>
            </header>
            <p>{userRequest.message.replace(/<[^>]+>/g, ' ')}</p>
            <footer>
              {userRequest.buttons.map((b) => (
                <button
                  key={b.text}
                  className="btn"
                  onClick={() => {
                    if (b.action) action(b.action, userRequest.relatedUserId ?? undefined)
                    dismissUserRequest()
                  }}
                >
                  {b.text}
                </button>
              ))}
            </footer>
          </div>
        </div>
      )}
    </>
  )
}

export default function App() {
  const screen = useStore((s) => s.screen)
  const online = useStore((s) => s.online)
  return (
    <>
      {screen === 'connecting' && <div className="center-screen">Connecting…</div>}
      {(screen === 'login' || screen === 'password') && <Gate />}
      {screen === 'lobby' && <Lobby />}
      {screen === 'game' && (
        <Safety>
          <GameScreen />
        </Safety>
      )}
      {screen === 'sideboard' && <Sideboard />}
      {!online && screen !== 'connecting' && <div className="offline">Reconnecting…</div>}
      <Notices />
    </>
  )
}
