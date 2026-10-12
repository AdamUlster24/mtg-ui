// JSON contract of the gateway. Keep in sync with gateway/.../ViewMapper.java

export interface Counter {
  name: string
  count: number
}

export interface Card {
  id: string
  set?: string
  number?: string
  choosable?: boolean
  selected?: boolean
  name: string
  displayName?: string
  imageFileName?: string
  imageNumber?: number
  token?: boolean
  faceDown?: boolean
  typeLine?: string
  types: string[]
  manaCost?: string
  manaValue?: number
  colors?: string
  frameColors?: string
  rarity?: string
  rules: string[]
  /** XMage's own notes about the card: commander info, day/night, counts, restrictions */
  hints?: string[]
  power?: string
  toughness?: string
  loyalty?: string
  defense?: string
  counters: Counter[]
  zone?: string
  objectType?: string
  isAbility?: boolean
  abilityType?: string
  paid?: boolean
  canTransform?: boolean
  transformed?: boolean
  split?: boolean
  flipCard?: boolean
  canAttack?: boolean
  canBlock?: boolean
  targets: string[]
  parentId?: string
  playable?: boolean
  playableAmount?: number
  playableAbilities?: string[]
  secondFace?: Card
  sourceCard?: Card
  /** what a face-down, copied or transformed permanent really is, when this player may know */
  original?: Card
  ability?: Card
  displayFullName?: string
  alternateName?: string
  startingLoyalty?: string
  startingDefense?: string
  subTypes?: string[]
  superTypes?: string[]
  frameStyle?: string
  artRect?: string
  extraDeckCard?: boolean
  rotate?: boolean
  usesVariousArt?: boolean
  gameObject?: boolean
  bandedCards?: string[]
  pairedCard?: string
  leftHalf?: CardHalf
  rightHalf?: CardHalf
  icons?: CardIcon[]
  basePower?: number
  baseToughness?: number
  colorIdentity?: string
  originalIsCopy?: boolean
  controlledByOwner?: boolean
  // permanents only
  permanent?: boolean
  tapped?: boolean
  damage?: number
  summoningSick?: boolean
  phasedIn?: boolean
  flipped?: boolean
  copy?: boolean
  controlled?: boolean
  ownerName?: string
  controllerName?: string
  attachedTo?: string
  attachedToPermanent?: boolean
  attachments?: string[]
  morphed?: boolean
  manifested?: boolean
  disguised?: boolean
  cloaked?: boolean
  attachedControllerDiffers?: boolean
  mutated?: boolean
  mutateView?: { id: string; name: string }
  // command zone only
  commandKind?: 'commander' | 'emblem' | 'dungeon' | 'plane' | 'other'
}

export interface CardHalf {
  name: string
  manaCost: string
  typeLine: string
  rules: string[]
  /** "Adventure", "Omen", ... when the half is a spell of the same card */
  spellType?: string
}

export interface CardIcon {
  type: string
  text: string
  hint: string
}

export type ManaSymbol = 'W' | 'U' | 'B' | 'R' | 'G' | 'C'

export interface Player {
  id: string
  name: string
  controlled: boolean
  life: number
  libraryCount: number
  handCount: number
  active: boolean
  hasPriority: boolean
  hasLeft: boolean
  human?: boolean
  timerActive?: boolean
  priorityTimeLeftSecs?: number
  bufferTimeLeft?: number
  passedTurn?: boolean
  passedUntilEndOfTurn?: boolean
  passedUntilNextMain?: boolean
  passedUntilStackResolved?: boolean
  passedAllTurns?: boolean
  passedUntilEndStepBeforeMyTurn?: boolean
  attachments?: string[]
  sideboard?: Card[]
  wins?: number
  winsNeeded?: number
  undoSteps: number
  monarch: boolean
  initiative: boolean
  designations: string[]
  counters: Counter[]
  manaPool: Record<ManaSymbol, number>
  graveyard: Card[]
  exile: Card[]
  topCard: Card | null
  battlefield: Card[]
  commandZone: Card[]
}

export interface CombatGroup {
  defenderId: string | null
  defenderName: string
  blocked: boolean
  attackers: string[]
  blockers: string[]
}

export interface NamedCards {
  id: string
  name: string
  cards: Card[]
}

export interface GameView {
  turn: number
  phase: string | null
  step: string | null
  activePlayerId: string | null
  activePlayerName: string
  priorityPlayerName: string
  special: boolean
  myPlayerId: string | null
  players: Player[]
  hand: Card[]
  stack: Card[]
  combat: CombatGroup[]
  exiles: NamedCards[]
  revealed: NamedCards[]
  companion: NamedCards[]
  lookedAt: NamedCards[]
  /** hands of players I control at the moment */
  opponentHands: NamedCards[]
  watchedHands: NamedCards[]
  helperEmblems: Card[]
  /** chess clock of the table in seconds, 0 = none */
  priorityTime: number
  bufferTime: number
  rollbackTurnsAllowed?: boolean
}

export interface Choice {
  message: string
  subMessage?: string
  required: boolean
  keyChoice: boolean
  searchEnabled: boolean
  items: { key: string; text: string }[]
}

export interface PromptData {
  game: GameView
  message?: string
  required?: boolean
  min?: number
  max?: number
  targets?: string[]
  cards1?: Card[]
  cards2?: Card[]
  options?: Record<string, unknown>
  choice?: Choice
  multiAmount?: { message: string; min: number; max: number; defaultValue: number }[]
  abilities?: { id: string; text: string }[]
}

export type PromptMethod =
  | 'GAME_UPDATE_AND_INFORM'
  | 'GAME_ASK'
  | 'GAME_TARGET'
  | 'GAME_SELECT'
  | 'GAME_CHOOSE_ABILITY'
  | 'GAME_CHOOSE_PILE'
  | 'GAME_CHOOSE_CHOICE'
  | 'GAME_PLAY_MANA'
  | 'GAME_PLAY_XMANA'
  | 'GAME_GET_AMOUNT'
  | 'GAME_GET_MULTI_AMOUNT'
  | 'GAME_OVER'

export interface Prompt {
  method: PromptMethod
  messageId: number
  data: PromptData
}

export interface TableInfo {
  id: string
  name?: string
  controllerName?: string
  gameType?: string
  deckType?: string
  state?: string
  stateText?: string
  passworded?: boolean
  info?: string
  infoFull?: string
  seats?: { playerId: string | null; playerName: string; playerType: string }[]
}

export interface GameInfo {
  gameId: string
  playerId: string | null
  tableId: string | null
  chatId?: string
}

export interface Resume {
  token: string
  connected: boolean
  userName?: string
  testMode?: boolean
  settings?: ServerSettings
  defaultSettings?: ServerSettings
  tableOptions?: TableOptions
  gameTypes?: string[]
  deckTypes?: string[]
  table?: TableInfo | null
  game?: GameInfo | null
}

export interface ChatLine {
  key: number
  username: string | null
  time: number | null
  turnInfo: string | null
  message: string
  messageType: string | null
  color?: string | null
}

export interface GameEnd {
  won: boolean
  gameInfo: string
  matchInfo: string
  additionalInfo: string
  wins: number
  loses: number
  winsNeeded: number
  /** false: another game of the match follows (after sideboarding) */
  matchOver: boolean
  players: { name: string; life: number; wins: number; hasLeft: boolean }[]
  match?: { name: string; gameType: string; deckType: string; players: string; result: string; games: number }
}

/** XMage's per-player preferences (mage.players.net.UserData) */
export interface StepStops {
  upkeep: boolean
  draw: boolean
  main1: boolean
  beforeCombat: boolean
  endOfCombat: boolean
  main2: boolean
  endOfTurn: boolean
}

export interface ServerSettings {
  yourTurn: StepStops
  opponentTurn: StepStops
  stopOnDeclareAttackers: boolean
  stopOnDeclareBlockersWithZeroPermanents: boolean
  stopOnDeclareBlockersWithAnyPermanents: boolean
  stopOnAllMainPhases: boolean
  stopOnAllEndPhases: boolean
  stopOnStackNewObjects: boolean
  confirmEmptyManaPool: boolean
  askMoveToGraveOrder: boolean
  manaPoolAutomatic: boolean
  manaPoolAutomaticRestricted: boolean
  passPriorityCast: boolean
  passPriorityActivation: boolean
  autoOrderTrigger: boolean
  autoTargetLevel: number
  useSameSettingsForReplacementEffects: boolean
  useFirstManaAbility: boolean
  allowRequestShowHandCards: boolean
  flagName: string
  avatarId: number
}

export interface Option {
  key: string
  text: string
}

export interface TableOptions {
  mulliganTypes: Option[]
  timeLimits: Option[]
  bufferTimes: Option[]
}

/** Sideboarding between the games of a match */
export interface Sideboarding {
  tableId: string
  /** seconds the server allows */
  time: number
  deck: { name: string; main: Card[]; sideboard: Card[] }
}

export interface ServerEvent {
  type: 'event'
  method: string
  objectId: string | null
  messageId: number
  data: any
}

export type ResponseKind = 'uuid' | 'boolean' | 'string' | 'integer' | 'manaType'
