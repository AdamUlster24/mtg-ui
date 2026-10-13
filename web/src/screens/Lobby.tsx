import { useEffect, useState } from 'react'
import type { TableInfo } from '../protocol/types'
import { useStore } from '../store'
import { SettingsPanel } from './SettingsPanel'

const DECK_KEY = 'mtgui.deck'
const DECK_TYPE_KEY = 'mtgui.deckType'
const TABLE_KEY = 'mtgui.tableOptions'

/** What the host can set for a new table; saved for the next time */
interface TableChoices {
  bestOf: 1 | 3
  startLife: number
  startHandSize: number
  mulliganType: string
  freeMulligans: number
  timeLimit: string
  bufferTime: string
  rollbackTurnsAllowed: boolean
  planeChase: boolean
}

const DEFAULT_TABLE: TableChoices = {
  bestOf: 1,
  startLife: 40,
  startHandSize: 7,
  mulliganType: 'GAME_DEFAULT',
  freeMulligans: 0,
  timeLimit: 'NONE',
  bufferTime: 'NONE',
  rollbackTurnsAllowed: true,
  planeChase: false,
}

function loadTable(): TableChoices {
  try {
    return {
      ...DEFAULT_TABLE,
      ...JSON.parse(localStorage.getItem(TABLE_KEY) ?? '{}'),
    }
  } catch {
    return DEFAULT_TABLE
  }
}

interface DeckCheck {
  mainCount: number
  commanders: string[]
  errors: string[]
  notes?: string[]
}

export function Lobby() {
  const { userName, deckTypes, table, setTable, request, notify, tableOptions, testMode } = useStore()
  const [showSettings, setShowSettings] = useState(false)
  // players always get a standard Commander game; the table options exist for testing only
  const [stored, setChoices] = useState<TableChoices>(loadTable)
  const choices = testMode ? stored : DEFAULT_TABLE
  const choose = (change: Partial<TableChoices>) => {
    const next = { ...choices, ...change }
    setChoices(next)
    localStorage.setItem(TABLE_KEY, JSON.stringify(next))
  }
  const [deck, setDeck] = useState(() => localStorage.getItem(DECK_KEY) ?? '')
  const [storedDeckType, setDeckType] = useState(() => localStorage.getItem(DECK_TYPE_KEY) ?? '')
  const deckType = testMode ? storedDeckType : ''
  const [check, setCheck] = useState<DeckCheck | null>(null)
  const [tables, setTables] = useState<TableInfo[]>([])
  const [busy, setBusy] = useState(false)

  const commanderTypes = deckTypes.filter((t) => /commander/i.test(t))
  // a regular 60-card duel is there for matches with sideboarding, which XMage does not do in Commander
  const DUEL = 'Constructed - Freeform'
  const format = deckType === DUEL ? 'duel' : 'commander'
  const formatOf = (t: TableInfo) => (/commander/i.test(t.gameType ?? '') ? 'commander' : 'duel')

  // validate the pasted list against the XMage card database while typing
  useEffect(() => {
    localStorage.setItem(DECK_KEY, deck)
    if (!deck.trim()) {
      setCheck(null)
      return
    }
    const timer = window.setTimeout(() => {
      request<DeckCheck>('checkDeck', { deck, format })
        .then(setCheck)
        .catch(() => {})
    }, 500)
    return () => window.clearTimeout(timer)
  }, [deck, request, format])

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
        <button className="btn" onClick={() => setShowSettings(true)}>
          Settings
        </button>
      </header>
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      <div className="lobby-grid">
        <section className="panel">
          <h2>Your deck</h2>
          <p className="muted">Paste a Commander decklist (Moxfield, Archidekt, MTGA or plain text). Put the commander under a “Commander” heading.</p>
          <textarea spellCheck={false} value={deck} onChange={(e) => setDeck(e.target.value)} placeholder={"Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring\n1 Command Tower\n…"} />
          {check && (
            <div className={`deck-status ${check.errors.length ? 'bad' : 'good'}`}>
              <div>
                {check.mainCount} cards
                {format === 'duel' ? ` · sideboard: ${check.commanders.length}` : check.commanders.length > 0 ? ` · Commander: ${check.commanders.join(' & ')}` : ' · no commander found'}
              </div>
              {(check.notes ?? []).map((n) => (
                <div key={n} className="deck-note">
                  {n}
                </div>
              ))}
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
                  <button className="btn primary big" disabled={busy || seated.length < 2} onClick={() => run(() => request('startMatch', { tableId: table.id }))}>
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
              {testMode && (
                <>
                  <label className="field">
                    <span>Deck rules</span>
                    <select
                      data-option="deckType"
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
                      {deckTypes.includes(DUEL) && <option value={DUEL}>Regular duel, any cards (60+ cards, with a sideboard)</option>}
                    </select>
                  </label>
                  <details className="table-options">
                    <summary>Table options</summary>
                    <label className="field">
                      <span>Match</span>
                      <select data-option="bestOf" value={choices.bestOf} onChange={(e) => choose({ bestOf: Number(e.target.value) as 1 | 3 })}>
                        <option value={1}>Single game</option>
                        <option value={3}>Best of three (with sideboarding)</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Starting life</span>
                      <input
                        data-option="startLife"
                        type="number"
                        min={1}
                        max={999}
                        value={choices.startLife}
                        onChange={(e) =>
                          choose({
                            startLife: Math.max(1, Math.min(999, e.target.valueAsNumber || 40)),
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Starting hand size</span>
                      <input
                        data-option="startHandSize"
                        type="number"
                        min={1}
                        max={20}
                        value={choices.startHandSize}
                        onChange={(e) =>
                          choose({
                            startHandSize: Math.max(1, Math.min(20, e.target.valueAsNumber || 7)),
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Mulligan rule</span>
                      <select data-option="mulliganType" value={choices.mulliganType} onChange={(e) => choose({ mulliganType: e.target.value })}>
                        {(tableOptions?.mulliganTypes ?? []).map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.text}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Free mulligans</span>
                      <input
                        data-option="freeMulligans"
                        type="number"
                        min={0}
                        max={5}
                        value={choices.freeMulligans}
                        onChange={(e) =>
                          choose({
                            freeMulligans: Math.max(0, Math.min(5, e.target.valueAsNumber || 0)),
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Time limit per player</span>
                      <select data-option="timeLimit" value={choices.timeLimit} onChange={(e) => choose({ timeLimit: e.target.value })}>
                        {(tableOptions?.timeLimits ?? []).map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.text}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Free seconds per priority (before the clock runs)</span>
                      <select data-option="bufferTime" value={choices.bufferTime} onChange={(e) => choose({ bufferTime: e.target.value })}>
                        {(tableOptions?.bufferTimes ?? []).map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.text}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="setting">
                      <input data-option="rollbackTurnsAllowed" type="checkbox" checked={choices.rollbackTurnsAllowed} onChange={(e) => choose({ rollbackTurnsAllowed: e.target.checked })} />
                      <span>Players may ask to roll back turns</span>
                    </label>
                    <label className="setting">
                      <input data-option="planeChase" type="checkbox" checked={choices.planeChase} onChange={(e) => choose({ planeChase: e.target.checked })} />
                      <span>
                        Planechase
                        <small>a shared plane card and a planar die</small>
                      </span>
                    </label>
                  </details>
                </>
              )}
              <button
                className="btn primary big"
                disabled={busy || !deckReady}
                onClick={() =>
                  run(async () => {
                    const gameType = deckType === DUEL ? 'Two Player Duel' : /freeform/i.test(deckType) ? 'Freeform Commander Two Player Duel' : undefined
                    setTable(
                      await request<TableInfo>('createTable', {
                        deck,
                        format,
                        deckType,
                        gameType,
                        winsNeeded: choices.bestOf === 3 ? 2 : 1,
                        // 40 is the format's own starting life: only send a number when it was changed
                        startLife: choices.startLife === 40 ? 0 : choices.startLife,
                        startHandSize: choices.startHandSize === 7 ? 0 : choices.startHandSize,
                        mulliganType: choices.mulliganType,
                        freeMulligans: choices.freeMulligans,
                        timeLimit: choices.timeLimit,
                        bufferTime: choices.bufferTime,
                        rollbackTurnsAllowed: choices.rollbackTurnsAllowed,
                        planeChase: choices.planeChase,
                      }),
                    )
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
                    onClick={() =>
                      run(async () =>
                        setTable(
                          await request<TableInfo>('joinTable', {
                            tableId: t.id,
                            deck,
                            format: formatOf(t),
                          }),
                        ),
                      )
                    }
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
