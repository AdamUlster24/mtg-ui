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
  ServerEvent,
  TableInfo,
} from './protocol/types'

const TOKEN_KEY = 'mtgui.token'
const PASSWORD_KEY = 'mtgui.password'
const MAX_LOG = 500

export type Screen = 'connecting' | 'password' | 'login' | 'lobby' | 'game'

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
      gameTypes: resume.gameTypes ?? [],
      deckTypes: resume.deckTypes ?? [],
      table: resume.table ?? null,
      gameInfo: resume.game ?? null,
      // the gateway replays the game log and the latest game state right after this
      log: resume.game ? [] : s.log,
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
      case 'START_GAME':
        set({
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
    preview: null,
    passwordError: null,

    submitPassword: (password) => {
      storage.setItem(PASSWORD_KEY, password)
      void hello()
    },

    login: async (username) => {
      applyResume(await connection.send<Resume>('login', { username }))
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
  }
})
