import { useEffect, useState } from 'react'
import type { TableInfo } from '../protocol/types'
import { useStore } from '../store'

const DECK_KEY = 'mtgui.deck'
const DECK_TYPE_KEY = 'mtgui.deckType'

interface DeckCheck {
  mainCount: number
  commanders: string[]
  errors: string[]
}

export function Lobby() {
  const { userName, deckTypes, table, setTable, request, notify } = useStore()
  const [deck, setDeck] = useState(() => localStorage.getItem(DECK_KEY) ?? '')
  const [deckType, setDeckType] = useState(() => localStorage.getItem(DECK_TYPE_KEY) ?? '')
  const [check, setCheck] = useState<DeckCheck | null>(null)
  const [tables, setTables] = useState<TableInfo[]>([])
  const [busy, setBusy] = useState(false)

  const commanderTypes = deckTypes.filter((t) => /commander/i.test(t))

  // validate the pasted list against the XMage card database while typing
  useEffect(() => {
    localStorage.setItem(DECK_KEY, deck)
    if (!deck.trim()) {
      setCheck(null)
      return
    }
    const timer = window.setTimeout(() => {
      request<DeckCheck>('checkDeck', { deck }).then(setCheck).catch(() => {})
    }, 500)
    return () => window.clearTimeout(timer)
  }, [deck, request])

  useEffect(() => {
    const load = () => {
      request<TableInfo[]>('tables')
        .then((list) => {
          setTables(list)
          const current = useStore.getState().table
          if (current) {
            const fresh = list.find((t) => t.id === current.id)
            if (fresh) setTable(fresh)
          }
        })
        .catch(() => {})
    }
    load()
    const timer = window.setInterval(load, 2000)
    return () => window.clearInterval(timer)
  }, [request, setTable])

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } catch (e) {
      notify('Table', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const deckReady = !!check && check.errors.length === 0 && check.mainCount > 0
  const seated = table?.seats?.filter((s) => s.playerName) ?? []
  const owner = table?.controllerName?.split(',')[0]?.trim() === userName
  const openTables = tables.filter((t) => t.id !== table?.id && t.state === 'WAITING')

  return (
    <div className="lobby">
      <header className="lobby-head">
        <h1>MTG UI</h1>
        <span className="muted">Signed in as {userName}</span>
      </header>

      <div className="lobby-grid">
        <section className="panel">
          <h2>Your deck</h2>
          <p className="muted">
            Paste a Commander decklist (Moxfield, Archidekt, MTGA or plain text). Put the commander under a
            “Commander” heading.
          </p>
          <textarea
            spellCheck={false}
            value={deck}
            onChange={(e) => setDeck(e.target.value)}
            placeholder={'Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring\n1 Command Tower\n…'}
          />
          {check && (
            <div className={`deck-status ${check.errors.length ? 'bad' : 'good'}`}>
              <div>
                {check.mainCount} cards
                {check.commanders.length > 0 ? ` · Commander: ${check.commanders.join(' & ')}` : ' · no commander found'}
              </div>
              {check.errors.slice(0, 8).map((e) => (
                <div key={e} className="deck-error">
                  {e}
                </div>
              ))}
              {check.errors.length > 8 && <div className="deck-error">…and {check.errors.length - 8} more</div>}
            </div>
          )}
        </section>

        <section className="panel">
          {table ? (
            <>
              <h2>{table.name ?? 'Your table'}</h2>
              <p className="muted">
                {table.gameType} · {table.deckType}
              </p>
              <div className="seats">
                {[0, 1].map((i) => (
                  <div key={i} className={`seat ${seated[i] ? 'taken' : ''}`}>
                    {seated[i]?.playerName ?? 'Waiting for opponent…'}
                  </div>
                ))}
              </div>
              <div className="row">
                {owner && (
                  <button
                    className="btn primary big"
                    disabled={busy || seated.length < 2}
                    onClick={() => run(() => request('startMatch', { tableId: table.id }))}
                  >
                    Start game
                  </button>
                )}
                {!owner && <span className="muted">Waiting for {table.controllerName} to start…</span>}
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await request('leaveTable', { tableId: table.id })
                      setTable(null)
                    })
                  }
                >
                  Leave table
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>Play</h2>
              <label className="field">
                <span>Deck rules</span>
                <select
                  value={deckType}
                  onChange={(e) => {
                    setDeckType(e.target.value)
                    localStorage.setItem(DECK_TYPE_KEY, e.target.value)
                  }}
                >
                  <option value="">Commander (banlist enforced)</option>
                  {commanderTypes
                    .filter((t) => t !== 'Variant Magic - Commander')
                    .map((t) => (
                      <option key={t} value={t}>
                        {t.replace('Variant Magic - ', '')}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="btn primary big"
                disabled={busy || !deckReady}
                onClick={() =>
                  run(async () => {
                    const gameType = /freeform/i.test(deckType) ? 'Freeform Commander Two Player Duel' : undefined
                    setTable(await request<TableInfo>('createTable', { deck, deckType, gameType }))
                  })
                }
              >
                Create table
              </button>

              <h3>Open tables</h3>
              {openTables.length === 0 && <p className="muted">None yet. Create one and have your friend join it.</p>}
              {openTables.map((t) => (
                <div key={t.id} className="table-row">
                  <div>
                    <b>{t.name}</b>
                    <div className="muted">
                      {t.gameType} · {t.deckType}
                    </div>
                  </div>
                  <button
                    className="btn primary"
                    disabled={busy || !deckReady}
                    onClick={() => run(async () => setTable(await request<TableInfo>('joinTable', { tableId: t.id, deck })))}
                  >
                    Join
                  </button>
                </div>
              ))}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
