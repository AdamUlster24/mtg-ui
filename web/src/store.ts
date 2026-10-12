import { create } from 'zustand'
import { Connection } from './protocol/connection'
import type {
  Card,
  ChatLine,
  GameEnd,
  GameInfo,
  GameView,
  Prompt,
  PromptMethod,
  ResponseKind,
  Resume,
  ServerSettings,
  Sideboarding,
  TableOptions,
  ServerEvent,
  TableInfo,
} from './protocol/types'

const TOKEN_KEY = 'mtgui.token'
const PASSWORD_KEY = 'mtgui.password'
const SETTINGS_KEY = 'mtgui.settings'
const PREFS_KEY = 'mtgui.prefs'
const MAX_LOG = 500

export type Screen = 'connecting' | 'password' | 'login' | 'lobby' | 'game' | 'sideboard'

/** Preferences that only concern this browser */
export interface ClientPrefs {
  /** battlefield card size, 1 = as large as fits */
  cardScale: number
  animations: 'normal' | 'fast' | 'off'
  showLog: boolean
}

const DEFAULT_PREFS: ClientPrefs = { cardScale: 1, animations: 'normal', showLog: true }

function stored<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export interface Notice {
  key: number
  title: string
  message: string
}

export interface UserRequest {
  title: string
  message: string
  gameId: string | null
  relatedUserId: string | null
  buttons: { text: string; action: string | null }[]
}

interface State {
  screen: Screen
  online: boolean
  userName: string | null
  /** XMage test mode: cheat commands are available */
  testMode: boolean
  gameTypes: string[]
  deckTypes: string[]
  table: TableInfo | null
  gameInfo: GameInfo | null
  game: GameView | null
  prompt: Prompt | null
  // set while an answer is on its way, so a double click can't answer the next prompt too
  answering: boolean
  log: ChatLine[]
  notices: Notice[]
  gameEnd: GameEnd | null
  gameOverMessage: string | null
  userRequest: UserRequest | null
  /** XMage preferences of this player (stop steps, auto-payment, ...) and their defaults */
  settings: ServerSettings | null
  defaultSettings: ServerSettings | null
  tableOptions: TableOptions | null
  prefs: ClientPrefs
  sideboarding: Sideboarding | null
  /** the server asked to show a zone (e.g. "view sideboard") */
  showSideboardOf: string | null
  /** cast the next spell without passing priority afterwards (Ctrl in the Swing client) */
  holdPriority: boolean
  preview: Card | null
  passwordError: string | null

  submitPassword: (password: string) => void
  login: (username: string) => Promise<void>
  request: <T = any>(cmd: string, args?: Record<string, unknown>) => Promise<T>
  setTable: (table: TableInfo | null) => void
  respond: (kind: ResponseKind, value: unknown, extra?: Record<string, unknown>) => void
  action: (action: string, data?: unknown) => void
  sendChat: (message: string) => void
  leaveGame: () => void
  setPreview: (card: Card | null) => void
  notify: (title: string, message: string) => void
  dismissNotice: (key: number) => void
  dismissUserRequest: () => void
  saveSettings: (settings: ServerSettings) => Promise<void>
  savePrefs: (prefs: Partial<ClientPrefs>) => void
  setHoldPriority: (hold: boolean) => void
  clearShowSideboard: () => void
}

const connection = new Connection()
let counter = 1

// sessionStorage: one identity per browser tab, so two tabs can play each other while testing
const storage = window.sessionStorage

export const useStore = create<State>((set, get) => {
  const applyResume = (resume: Resume) => {
    storage.setItem(TOKEN_KEY, resume.token)
    if (!resume.connected) {
      set({ screen: 'login', userName: null, table: null, gameInfo: null, game: null, prompt: null })
      return
    }
    set((s) => ({
      userName: resume.userName ?? null,
      testMode: !!resume.testMode,
      settings: resume.settings ?? s.settings,
      defaultSettings: resume.defaultSettings ?? s.defaultSettings,
      tableOptions: resume.tableOptions ?? s.tableOptions,
      gameTypes: resume.gameTypes ?? [],
      deckTypes: resume.deckTypes ?? [],
      table: resume.table ?? null,
      gameInfo: resume.game ?? null,
      // the gateway replays the game log and the latest game state right after this
      log: resume.game ? [] : s.log,
      // a pending sideboarding request is replayed by the gateway and switches the screen itself
      screen: resume.game ? 'game' : 'lobby',
    }))
  }

  const hello = async () => {
    try {
      const resume = await connection.send<Resume>('hello', {
        token: storage.getItem(TOKEN_KEY),
        password: storage.getItem(PASSWORD_KEY),
      })
      set({ passwordError: null })
      applyResume(resume)
    } catch (e) {
      const message = (e as Error).message
      if (message === 'Wrong password') {
        set({ screen: 'password', passwordError: storage.getItem(PASSWORD_KEY) ? message : null })
      } else {
        get().notify('Connection', message)
      }
    }
  }

  const gamePrompt = (method: PromptMethod, event: ServerEvent) => {
    if (event.objectId !== get().gameInfo?.gameId) {
      return
    }
    set({
      game: event.data.game,
      prompt: { method, messageId: event.messageId, data: event.data },
      answering: false,
    })
  }

  const onEvent = (event: ServerEvent) => {
    const { data } = event
    switch (event.method) {
      case 'SIDEBOARD':
      case 'CONSTRUCT':
        // the result of the game just played stays, the sideboarding screen shows it
        set({ sideboarding: { tableId: data.tableId, time: data.time, deck: data.deck }, screen: 'sideboard' })
        break
      case 'VIEW_SIDEBOARD':
        set({ showSideboardOf: data.playerId })
        break
      case 'START_GAME':
        set({
          sideboarding: null,
          holdPriority: false,
          gameInfo: data,
          game: null,
          prompt: null,
          log: [],
          gameEnd: null,
          gameOverMessage: null,
          answering: false,
          screen: 'game',
        })
        break
      case 'GAME_INIT':
      case 'GAME_UPDATE':
        if (event.objectId === get().gameInfo?.gameId) {
          set({ game: data.game })
        }
        break
      case 'GAME_UPDATE_AND_INFORM':
      case 'GAME_ASK':
      case 'GAME_TARGET':
      case 'GAME_SELECT':
      case 'GAME_CHOOSE_ABILITY':
      case 'GAME_CHOOSE_PILE':
      case 'GAME_CHOOSE_CHOICE':
      case 'GAME_PLAY_MANA':
      case 'GAME_PLAY_XMANA':
      case 'GAME_GET_AMOUNT':
      case 'GAME_GET_MULTI_AMOUNT':
        gamePrompt(event.method, event)
        break
      case 'GAME_OVER':
        gamePrompt('GAME_OVER', event)
        set({ gameOverMessage: data.message ?? 'Game over' })
        break
      case 'END_GAME_INFO':
        set({ gameEnd: data })
        break
      case 'CHATMESSAGE':
        if (event.objectId === get().gameInfo?.chatId) {
          set((s) => ({ log: [...s.log, { key: counter++, ...data }].slice(-MAX_LOG) }))
        }
        break
      case 'SHOW_USERMESSAGE':
        get().notify(data.title, data.message)
        break
      case 'GAME_ERROR':
        get().notify('Game error', data.message)
        break
      case 'GAME_INFORM_PERSONAL':
        get().notify('Game', data.message)
        break
      case 'SERVER_MESSAGE':
        get().notify('Server', data.message)
        break
      case 'USER_REQUEST_DIALOG':
        set({ userRequest: data })
        break
      case 'DISCONNECTED':
        set({ screen: 'login', table: null, gameInfo: null, game: null, prompt: null })
        get().notify('Disconnected', 'The game server closed the connection.')
        break
    }
  }

  connection.onEvent = onEvent
  connection.onOpen = () => {
    set({ online: true })
    void hello()
  }
  connection.onClose = () => set({ online: false })
  connection.connect()

  return {
    screen: 'connecting',
    online: false,
    userName: null,
    testMode: false,
    gameTypes: [],
    deckTypes: [],
    table: null,
    gameInfo: null,
    game: null,
    prompt: null,
    answering: false,
    log: [],
    notices: [],
    gameEnd: null,
    gameOverMessage: null,
    userRequest: null,
    settings: stored<ServerSettings>(SETTINGS_KEY),
    defaultSettings: null,
    tableOptions: null,
    prefs: { ...DEFAULT_PREFS, ...(stored<Partial<ClientPrefs>>(PREFS_KEY) ?? {}) },
    sideboarding: null,
    showSideboardOf: null,
    holdPriority: false,
    preview: null,
    passwordError: null,

    submitPassword: (password) => {
      storage.setItem(PASSWORD_KEY, password)
      void hello()
    },

    login: async (username) => {
      // the preferences saved in this browser go along, XMage applies them from the first turn
      applyResume(await connection.send<Resume>('login', { username, settings: stored<ServerSettings>(SETTINGS_KEY) }))
    },

    request: (cmd, args) => connection.send(cmd, args),

    setTable: (table) => set({ table }),

    respond: (kind, value, extra) => {
      const { gameInfo, answering } = get()
      if (!gameInfo || answering) return
      set({ answering: true })
      connection
        .send('respond', { gameId: gameInfo.gameId, kind, value, ...extra })
        .catch((e: Error) => get().notify('Error', e.message))
      // the server answers every response with a new prompt or update; don't stay locked if it doesn't
      window.setTimeout(() => set({ answering: false }), 1500)
    },

    action: (action, data) => {
      const { gameInfo } = get()
      if (!gameInfo) return
      connection
        .send('action', { gameId: gameInfo.gameId, action, data })
        .catch((e: Error) => get().notify('Error', e.message))
    },

    sendChat: (message) => {
      const chatId = get().gameInfo?.chatId
      if (chatId && message.trim()) {
        connection.send('chat', { chatId, message }).catch(() => {})
      }
    },

    leaveGame: () => {
      connection.send('leaveGame').catch(() => {})
      set({
        screen: 'lobby',
        table: null,
        gameInfo: null,
        game: null,
        prompt: null,
        gameEnd: null,
        gameOverMessage: null,
        log: [],
      })
    },

    setPreview: (card) => set({ preview: card }),

    notify: (title, message) =>
      set((s) => ({ notices: [...s.notices, { key: counter++, title, message }].slice(-4) })),

    dismissNotice: (key) => set((s) => ({ notices: s.notices.filter((n) => n.key !== key) })),

    dismissUserRequest: () => set({ userRequest: null }),

    saveSettings: async (settings) => {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
      set({ settings })
      const applied = await connection.send<ServerSettings>('settings', { settings })
      set({ settings: applied })
    },

    savePrefs: (change) => {
      const prefs = { ...get().prefs, ...change }
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
      set({ prefs })
    },

    setHoldPriority: (hold) => {
      if (get().holdPriority === hold) return
      set({ holdPriority: hold })
      get().action(hold ? 'HOLD_PRIORITY' : 'UNHOLD_PRIORITY')
    },

    clearShowSideboard: () => set({ showSideboardOf: null }),
  }
})

// handle for the e2e tests and for poking at the state from the browser console
;(window as unknown as { mtgui: unknown }).mtgui = {
  store: useStore,
  /** feeds an event to the client as if the gateway had sent it (used to test rare server messages) */
  inject: (event: ServerEvent) => connection.onEvent(event),
}
