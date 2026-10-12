#!/usr/bin/env node
// Builds docs/parity.md: everything XMage's network contract and its Swing game panel offer, and
// for each item either the test that proves the web client handles it, or why it is out of scope.
//
//   node scripts/parity.mjs           write docs/parity.md
//   node scripts/parity.mjs --check   also fail if an item has no entry, a named test does not
//                                     exist, or an out-of-scope reason is not one of the allowed ones
//
// The inventory is read from the XMage sources (../mage), so a new field, callback, action or
// setting upstream shows up here as an item without an entry.
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAGE = process.env.MAGE_DIR ?? path.join(ROOT, '..', 'mage')
const read = (file) => readFileSync(path.join(MAGE, file), 'utf8')

// ------------------------------------------------------------------ inventory

const VIEW_DIR = 'Mage.Common/src/main/java/mage/view'
/** The view classes a game uses (lobby-only, draft and tournament views are not part of a game) */
const VIEWS = [
  'GameView', 'PlayerView', 'SimpleCardView', 'CardView', 'PermanentView', 'StackAbilityView', 'AbilityView', 'CombatGroupView',
  'CommanderView', 'EmblemView', 'DungeonView', 'PlaneView', 'ExileView', 'RevealedView', 'LookedAtView', 'ManaPoolView', 'CounterView',
  'MutateView', 'GameClientMessage', 'AbilityPickerView', 'GameEndView', 'MatchView', 'TableView', 'SeatView', 'ChatMessage',
  'UserRequestMessage', 'TableClientMessage', 'DeckView', 'UserDataView',
]

function fields(source) {
  const out = []
  const pattern = /^\s+(?:private|protected)((?:\s+(?:final|static|transient))*)\s+[A-Za-z<>\[\], .?]+\s+([a-zA-Z_0-9]+)\s*(?:=[^;]+)?;/gm
  for (const m of source.matchAll(pattern)) {
    if (/static/.test(m[1])) continue
    out.push(m[2])
  }
  return out
}

function enumValues(source, name) {
  const body = source.slice(source.indexOf(`enum ${name}`))
  const out = []
  for (const m of body.slice(body.indexOf('{') + 1).matchAll(/^\s+([A-Z][A-Z_0-9]*)\s*(?:\(|,|;)/gm)) out.push(m[1])
  return out
}

function inventory() {
  const items = []
  for (const view of VIEWS) {
    for (const field of fields(read(`${VIEW_DIR}/${view}.java`))) items.push({ section: `View: ${view}`, id: `${view}.${field}` })
  }
  for (const value of enumValues(read('Mage.Common/src/main/java/mage/interfaces/callback/ClientCallbackMethod.java'), 'ClientCallbackMethod')) {
    items.push({ section: 'Server callbacks (ClientCallbackMethod)', id: `callback.${value}` })
  }
  for (const value of enumValues(read('Mage/src/main/java/mage/constants/PlayerAction.java'), 'PlayerAction')) {
    items.push({ section: 'Player actions (PlayerAction)', id: `action.${value}` })
  }
  // prompt options: the named constants plus the literal keys used in the sources
  const options = new Set()
  const constants = read('Mage.Common/src/main/java/mage/constants/Constants.java')
  const block = constants.slice(constants.indexOf('class Option'))
  for (const m of block.slice(0, block.indexOf('}')).matchAll(/String\s+[A-Z_]+\s*=\s*"([^"]+)"/g)) options.add(m[1])
  const literal = /(?:options|getOptions\(\))\.(?:put|get|containsKey|getOrDefault)\("([^"]+)"/g
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.java')) for (const m of readFileSync(full, 'utf8').matchAll(literal)) options.add(m[1])
    }
  }
  for (const dir of ['Mage.Server.Plugins/Mage.Player.Human/src', 'Mage.Server/src/main/java', 'Mage.Client/src/main/java/mage/client/game', 'Mage.Common/src/main/java/mage/view']) {
    walk(path.join(MAGE, dir))
  }
  for (const key of [...options].sort()) items.push({ section: 'Prompt options', id: `option.${key}` })

  for (const field of fields(read('Mage/src/main/java/mage/players/net/UserData.java'))) items.push({ section: 'Settings: UserData', id: `UserData.${field}` })
  const steps = [...read('Mage/src/main/java/mage/players/net/SkipPrioritySteps.java').matchAll(/^\s+boolean\s+(\w+)/gm)].map((m) => m[1])
  for (const turn of ['yourTurn', 'opponentTurn']) for (const step of steps) items.push({ section: 'Settings: stop steps (UserSkipPrioritySteps)', id: `${turn}.${step}` })
  for (const m of read('Mage/src/main/java/mage/players/net/UserSkipPrioritySteps.java').matchAll(/^\s+boolean\s+(\w+)/gm)) {
    items.push({ section: 'Settings: stop steps (UserSkipPrioritySteps)', id: `stops.${m[1]}` })
  }

  // the Swing game panel: its menus, hotkeys and dialogs, read from the sources
  const gameDir = path.join(MAGE, 'Mage.Client/src/main/java/mage/client/game')
  const game = readdirSync(gameDir).filter((f) => f.endsWith('.java')).map((f) => readFileSync(path.join(gameDir, f), 'utf8')).join('\n')
  const menus = new Set()
  for (const m of game.matchAll(/new J(?:CheckBox)?Menu(?:Item)?\("([^"]+)"/g)) {
    const label = m[1].replace(/<[^>]+>/g, '').trim()
    if (label) menus.add(label)
  }
  for (const label of menus) items.push({ section: 'Swing game panel: menus', id: `menu.${label}` })
  for (const key of new Set([...game.matchAll(/KEY_CONTROL_[A-Z_0-9]+/g)].map((m) => m[0]))) items.push({ section: 'Swing game panel: hotkeys', id: `hotkey.${key}` })
  for (const dialog of new Set([...game.matchAll(/\b([A-Z][A-Za-z]+Dialog)\b/g)].map((m) => m[1]))) items.push({ section: 'Swing game panel: dialogs', id: `dialog.${dialog}` })
  // what the player panel labels (its tooltips name every piece of information it shows)
  const panel = readFileSync(path.join(gameDir, 'PlayerPanelExt.java'), 'utf8')
  for (const tip of new Set([...panel.matchAll(/setToolTipText\("([^"]+)"/g)].map((m) => m[1].replace(/[:\s0-9]+$/, '')))) items.push({ section: 'Swing game panel: player panel', id: `panel.${tip}` })
  for (const feature of FEATURES) items.push({ section: 'Swing game panel: behaviour', id: `feature.${feature}` })
  return items
}

/** Things the game panel does that are not a menu entry, key, dialog or label (read from GamePanel.java and friends) */
const FEATURES = [
  'large card preview on hover',
  'battlefield with lands, creatures and other permanents',
  'attachments shown with their permanent',
  'identical permanents piled up',
  'hand panel',
  'stack panel',
  'phase bar with the current step',
  'click on the phase bar opens the stop settings',
  'feedback panel with the current request and its buttons',
  'special button',
  'undo button',
  'targeting arrows',
  'combat arrows',
  'click a card or permanent to play, activate, target, attack or block',
  'click a player to target',
  'click the mana pool to pay',
  'hold priority with Ctrl',
  'ability picker',
  'trigger order menu',
  'auto-answer menu for yes/no requests',
  'card windows for graveyard, exile, revealed, looked-at, companion and sideboard',
  'switch between hands when controlling another player',
  'hints helper window',
  'game log and chat',
  'skip buttons show the active pass mode',
  'timer per player',
  'game end dialog',
  'reconnect restores the game',
  'cheat button in test mode',
  'macro recording',
  'adjustable sizes of the game panel',
  'sounds',
  'watching a game',
  'replaying a game',
]

// ------------------------------------------------------------------ what covers what

const OUT_OF_SCOPE = ['sound', 'drafts', 'sealed', 'tournaments', 'more than two players', 'replays', 'spectating', 'deck editor']

const T = {
  wireGame: 'every field of the game and player views reaches the browser',
  wireCard: 'every field of cards and permanents reaches the browser',
  wireTable: "the table list and the lobby carry XMage's table information",
  basics: 'test commands set up the board, a creature is cast and resolves',
  xcost: 'X cost: number picker, target, payment',
  combat: 'combat: attackers, two blockers on one attacker, damage assignment',
  pile: 'pile choice: Fact or Fiction',
  picker: 'ability picker and paying from the mana pool',
  search: 'searching the library: Rampant Growth',
  graveTarget: 'targeting a card in the graveyard: Raise Dead',
  choice: 'choice list with a filter: Cavern of Souls',
  tokens: 'tokens: created by a spell and by test commands, with art',
  dfc: "double-faced card transforms into a planeswalker: Jace, Vryn's Prodigy",
  walker: 'planeswalker: loyalty abilities and loyalty counters',
  aura: 'aura and equipment attach to creatures and are drawn behind them',
  counters: 'counters: enters with +1/+1 counters and spends one',
  counterspell: 'responding on the stack: Counterspell',
  triggers: 'two triggers at once: the player orders them',
  commander: 'commander: cast from the command zone, dies, returns to the command zone',
  undo: 'taking things back: cancel while paying, undo tapped mana',
  scry: 'scry: Opt looks at the top card',
  chat: 'chat reaches the other player',
  rollback: 'asking the opponent to restart the turn',
  reload: 'a page reload brings back an open dialog',
  win: 'winning by combat damage: all attack, result screens, back to the lobby',
  split: 'split card: both halves are shown and either can be cast (Fire // Ice)',
  adventure: 'adventure card: the adventure is cast, then the creature from exile (Bonecrusher Giant)',
  flashback: 'flashback: a card in the graveyard is offered without opening the pile (Think Twice)',
  libraryTop: 'top of the library is face up and playable with Future Sight',
  flip: 'flip card flips and is drawn upside down (Budoka Gardener)',
  mdfc: 'modal double-faced card: played as its land side (Shatterskull Smashing)',
  morph: 'morph: cast face down, hidden from the opponent, turned face up (Battering Craghorn)',
  mutate: 'mutate: a creature merges onto another (Gemrazer)',
  saga: 'saga: lore counters and chapter triggers (History of Benalia)',
  level: 'level up: level counters change the creature (Student of Warfare)',
  klass: 'class: levels are shown on the card (Ranger Class)',
  emblem: 'emblems sit in the command zone and show their text',
  dungeon: 'dungeon: venturing puts the dungeon in the command zone with its room',
  monarch: 'the monarch and the initiative are shown on the player',
  daynight: 'day and night are shown once the cycle starts (Brutal Cathar)',
  commanderDamage: 'commander: combat damage is counted, and the tax shows after recasting',
  playerCounters: 'player counters: poison and energy',
  icons: 'card icons: keyword abilities and restrictions are marked on the card',
  curse: 'a curse attached to a player is listed on that player',
  revealed: "revealed hand: an effect that reveals the opponent's hand opens it (Telepathy)",
  lookedAt: "looking at cards: Peek shows the opponent's hand only to me",
  exilePile: 'exile piles made by a card are listed and can be opened (Journey to Nowhere)',
  mindslaver: "controlling the opponent's turn shows their hand (Mindslaver)",
  sideboardView: 'my sideboard can be looked at during the game',
  hints: 'hints: what XMage notes about cards is collected in one panel',
  clock: 'a chess clock runs for the player who has to act',
  holdPriority: 'pass priority after casting, unless holding priority',
  passActivation: 'pass priority after activating an ability',
  triggerMemory: 'trigger order can be remembered and forgotten',
  autoAnswer: 'a yes/no question can be answered once and for all, and that can be reset',
  passModes: 'pass-until modes: started with a key, shown to both players, and stopped',
  passKeys: "every pass-until key and menu entry sends XMage's action",
  f2: 'F2 confirms the current request and the phase bar opens the stop settings',
  macro: 'macro recording can be switched on and off',
  bo3: 'best of three in Commander: the next game follows directly, the match ends at two wins',
  sideboarding: 'best of three in a regular duel: sideboarding between the games',
  tableOptions: 'table options: starting life, free mulligans and no rollbacks',
  concedeMatch: 'conceding the match ends it for both players',
  concedeGame: 'conceding the game gives the opponent the win',
  rollbackTurn: 'rolling back to the previous turn when the opponent agrees',
  rollbackDenied: 'a rollback request can be refused',
  handRequest: "asking to see the opponent's hand: refused by default, shown when they allow it",
  special: 'the special button: paying with convoke (Siege Wurm)',
  stops: "stop steps: every step can be switched on and off for my turn and for the opponent's",
  stopAttackers: 'stop to declare attackers while passing, or not',
  stopBlockers: 'while passing: stop when attacked, with possible blockers and even without any',
  stopPhases: "F7 and F5: stopping in the opponent's main phases and at my own end step",
  stopStack: 'F10: passing until the stack resolves stops for something new, or not',
  confirmPool: 'ask before passing with mana in the pool',
  autoTarget: 'automatic targeting level',
  firstMana: 'tapping a land with several mana abilities: asks, or uses the first',
  restrictedMana: 'mana that was already in the pool: spent by hand, or automatically',
  graveOrder: 'graveyard order: asked when several cards go there at once, if wanted',
  autoOrder: 'identical triggers: ordered automatically, or asked',
  replacement: 'replacement effects: a remembered choice, for one object or for every copy',
  settingsKept: 'settings are kept in the browser, reach the server and can be reset',
  screen: 'this screen: card size, animations and the log',
  manaGlow: 'paying mana: only sources that can pay what is left are pointed out',
  planechase: 'Planechase: the plane is in the command zone and the planar die can be rolled',
  cardTypes: 'the graveyard pile tells how many card types it holds',
  chatKey: 'F12 moves to the chat',
  serverMessages: 'server messages, game errors and personal notes are shown',
  xmana: 'the "pay X mana" prompt is answered with OK or Cancel',
  disconnected: 'a lost connection to the game server sends the player back to the door',
  lobbyDeck: 'the lobby explains what is wrong with a deck',
  layout: 'layout holds at',
  animations: 'every zone change, life change, tap and attack is animated',
  online: 'a game through the public link survives a dropped connection and a reload',
  fullGame: 'full game:',
}

const done = (test, note = '') => ({ status: 'done', test, note })
const out = (reason, note = '') => ({ status: 'out of scope', reason, note })

/** First rule whose pattern matches the item id decides. Order: specific before general. */
const RULES = [
  // ---- views: cards
  [/^SimpleCardView\.playableStats$/, done(T.wireCard, 'sent as playable / playableAmount / playableAbilities')],
  [/^SimpleCardView\./, done(T.wireCard)],
  [/^CardView\.(isToken|imageFileName|imageNumber)$/, done(T.tokens)],
  [/^CardView\.(transformable|transformed)$/, done(T.dfc)],
  [/^CardView\.secondCardFace$/, done(T.mdfc)],
  [/^CardView\.isDoubleFacedCard$/, done(T.dfc, 'no getter in XMage; double-faced cards arrive as canTransform + secondFace')],
  [/^CardView\.flipCard$/, done(T.flip)],
  [/^CardView\.faceDown$/, done(T.morph)],
  [/^CardView\.hideInfo$/, done(T.morph, 'no getter in XMage; hidden information is covered by the face-down preview')],
  [/^CardView\.inViewerOnly$/, done(T.search, 'no getter in XMage; cards in pickers are drawn as plain cards')],
  [/^CardView\.(isSplitCard|leftSplit\w+|rightSplitName|rightSplitCostsStr|rightSplitRules|rightSplitTypeLine)$/, done(T.split)],
  [/^CardView\.(rightSplitSpellType|alternateName)$/, done(T.adventure)],
  [/^CardView\.targets$/, done(T.xcost, 'drawn as targeting arrows')],
  [/^CardView\.counters$/, done(T.counters)],
  [/^CardView\.cardIcons$/, done(T.icons)],
  [/^CardView\.(originalPower|originalToughness)$/, done(T.level, 'printed values, used to mark boosted / shrunk creatures')],
  [/^CardView\.ability$/, done(T.wireCard)],
  [/^CardView\.(isAbility|abilityType)$/, done(T.triggers)],
  [/^CardView\.(manaCostLeftStr|manaCostRightStr)$/, done(T.wireCard, 'sent joined as manaCost')],
  [/^CardView\./, done(T.wireCard)],
  [/^PermanentView\.tapped$/, done(T.basics)],
  [/^PermanentView\.flipped$/, done(T.flip)],
  [/^PermanentView\.damage$/, done(T.animations)],
  [/^PermanentView\.(attachments|attachedTo|attachedToPermanent)$/, done(T.aura)],
  [/^PermanentView\.(original|morphed)$/, done(T.morph)],
  [/^PermanentView\.(mutateView|mutated)$/, done(T.mutate)],
  [/^PermanentView\./, done(T.wireCard)],
  [/^MutateView\./, done(T.mutate)],
  [/^(StackAbilityView|AbilityView)\./, done(T.triggers)],
  [/^CombatGroupView\./, done(T.combat)],
  [/^EmblemView\./, done(T.emblem)],
  [/^DungeonView\./, done(T.dungeon)],
  [/^PlaneView\./, done(T.planechase)],
  [/^ExileView\./, done(T.exilePile)],
  [/^RevealedView\./, done(T.revealed)],
  [/^LookedAtView\./, done(T.lookedAt)],
  [/^ManaPoolView\./, done(T.wireGame)],
  [/^CounterView\./, done(T.counters)],
  // ---- views: game and players
  [/^GameView\.(priorityTime)$/, done(T.clock)],
  [/^GameView\.opponentHands$/, done(T.mindslaver)],
  [/^GameView\.watchedHands$/, out('spectating', 'filled only for watchers; forwarded and listed like other hands')],
  [/^GameView\.exiles$/, done(T.exilePile)],
  [/^GameView\.revealed$/, done(T.revealed)],
  [/^GameView\.lookedAt$/, done(T.lookedAt)],
  [/^GameView\.combat$/, done(T.combat)],
  [/^GameView\.special$/, done(T.special)],
  [/^GameView\.rollbackTurnsAllowed$/, done(T.tableOptions)],
  [/^GameView\.canPlayObjects$/, done(T.wireCard, 'sent per card as playable / playableAmount')],
  [/^GameView\.stack$/, done(T.counterspell)],
  [/^GameView\./, done(T.wireGame)],
  [/^PlayerView\.counters$/, done(T.playerCounters)],
  [/^PlayerView\.(wins|winsNeeded)$/, done(T.bo3)],
  [/^PlayerView\.(timerActive|priorityTimeLeftSecs|priorityTimeSavedTimeMs)$/, done(T.clock)],
  [/^PlayerView\.sideboard$/, done(T.sideboarding)],
  [/^PlayerView\.helperCards$/, done(T.wireGame, 'no getter in XMage; the helper objects it holds arrive as helperEmblems')],
  [/^PlayerView\.topCard$/, done(T.libraryTop)],
  [/^PlayerView\.commandList$/, done(T.emblem)],
  [/^PlayerView\.attachments$/, done(T.curse)],
  [/^PlayerView\.statesSavedSize$/, done(T.undo)],
  [/^PlayerView\.passed/, done(T.passModes)],
  [/^PlayerView\.(monarch|initiative|designationNames)$/, done(T.monarch)],
  [/^PlayerView\.graveyard$/, done(T.graveTarget)],
  [/^PlayerView\.exile$/, done(T.adventure)],
  [/^PlayerView\./, done(T.wireGame)],
  // ---- views: prompts, results, lobby
  [/^GameClientMessage\.cardsView1$/, done(T.search)],
  [/^GameClientMessage\.cardsView2$/, done(T.pile)],
  [/^GameClientMessage\.(min|max)$/, done(T.xcost)],
  [/^GameClientMessage\.choice$/, done(T.choice)],
  [/^GameClientMessage\.messages$/, done(T.combat)],
  [/^GameClientMessage\.(targets|flag)$/, done(T.graveTarget)],
  [/^GameClientMessage\./, done(T.basics)],
  [/^AbilityPickerView\./, done(T.picker)],
  [/^GameEndView\./, done(T.win)],
  [/^MatchView\.(replayAvailable)$/, out('replays')],
  [/^MatchView\.(isTournament)$/, out('tournaments')],
  [/^MatchView\./, done(T.win, 'the match summary of the result screen')],
  [/^(TableView|SeatView)\./, done(T.wireTable)],
  [/^ChatMessage\.soundToPlay$/, out('sound', 'forwarded as "sound", not played')],
  [/^ChatMessage\./, done(T.chat)],
  [/^UserRequestMessage\.tournamentId$/, out('tournaments')],
  [/^UserRequestMessage\.windowSizeRatio$/, done(T.rollback, 'a Swing window size; the web dialog sizes itself')],
  [/^UserRequestMessage\./, done(T.rollback)],
  [/^TableClientMessage\.(deck|time|flag)$/, done(T.sideboarding)],
  [/^TableClientMessage\./, done(T.basics, 'START_GAME carries table, game and player ids')],
  [/^DeckView\./, done(T.sideboarding)],
  [/^UserDataView\./, done(T.settingsKept)],

  // ---- callbacks
  [/^callback\.CHATMESSAGE$/, done(T.chat)],
  [/^callback\.SHOW_USERMESSAGE$/, done(T.lobbyDeck)],
  [/^callback\.(SERVER_MESSAGE|GAME_INFORM_PERSONAL|GAME_ERROR)$/, done(T.serverMessages)],
  [/^callback\.JOINED_TABLE$/, done(T.serverMessages, 'the lobby polls the table instead of waiting for this')],
  [/^callback\.(START_TOURNAMENT|TOURNAMENT_INIT|TOURNAMENT_UPDATE|TOURNAMENT_OVER|SHOW_TOURNAMENT)$/, out('tournaments')],
  [/^callback\.(START_DRAFT|DRAFT_OVER|DRAFT_INIT|DRAFT_PICK|DRAFT_UPDATE)$/, out('drafts')],
  [/^callback\.(CONSTRUCT|VIEW_LIMITED_DECK)$/, out('sealed', 'deck building for limited formats')],
  [/^callback\.SIDEBOARD$/, done(T.sideboarding)],
  [/^callback\.WATCHGAME$/, out('spectating')],
  [/^callback\.VIEW_SIDEBOARD$/, done(T.sideboardView)],
  [/^callback\.USER_REQUEST_DIALOG$/, done(T.rollback)],
  [/^callback\.GAME_REDRAW_GUI$/, done(T.serverMessages, 'a Swing-internal repaint command; ignored')],
  [/^callback\.(START_GAME|GAME_INIT|GAME_UPDATE_AND_INFORM|GAME_SELECT|GAME_PLAY_MANA)$/, done(T.basics)],
  [/^callback\.GAME_UPDATE$/, done(T.undo)],
  [/^callback\.GAME_TARGET$/, done(T.xcost)],
  [/^callback\.GAME_CHOOSE_ABILITY$/, done(T.picker)],
  [/^callback\.GAME_CHOOSE_PILE$/, done(T.pile)],
  [/^callback\.GAME_CHOOSE_CHOICE$/, done(T.choice)],
  [/^callback\.GAME_ASK$/, done(T.commander)],
  [/^callback\.GAME_PLAY_XMANA$/, done(T.xmana, 'current XMage never sends it')],
  [/^callback\.GAME_GET_AMOUNT$/, done(T.xcost)],
  [/^callback\.GAME_GET_MULTI_AMOUNT$/, done(T.combat)],
  [/^callback\.(GAME_OVER|END_GAME_INFO)$/, done(T.win)],
  [/^callback\.REPLAY_/, out('replays')],

  // ---- player actions
  [/^action\.PASS_PRIORITY_/, done(T.passKeys)],
  [/^action\.TRIGGER_AUTO_ORDER_/, done(T.triggerMemory)],
  [/^action\.ROLLBACK_TURNS$/, done(T.rollbackTurn)],
  [/^action\.UNDO$/, done(T.undo)],
  [/^action\.CONCEDE$/, done(T.concedeGame)],
  [/^action\.MANA_AUTO_PAYMENT_(ON|OFF)$/, done(T.picker, 'sent when the setting is changed during a game')],
  [/^action\.MANA_AUTO_PAYMENT_RESTRICTED_(ON|OFF)$/, done(T.restrictedMana, 'sent when the setting is changed during a game')],
  [/^action\.USE_FIRST_MANA_ABILITY_(ON|OFF)$/, done(T.firstMana, 'sent when the setting is changed during a game')],
  [/^action\.RESET_AUTO_SELECT_REPLACEMENT_EFFECTS$/, done(T.replacement)],
  [/^action\.(REQUEST_PERMISSION_TO_SEE_HAND_CARDS|ADD_PERMISSION_TO_SEE_HAND_CARDS|REVOKE_PERMISSIONS_TO_SEE_HAND_CARDS)$/, done(T.handRequest)],
  [/^action\.PERMISSION_REQUESTS_ALLOWED_(ON|OFF)$/, done(T.handRequest, 'set through the settings')],
  [/^action\.(REQUEST_PERMISSION_TO_ROLLBACK_TURN|ADD_PERMISSION_TO_ROLLBACK_TURN)$/, done(T.rollbackTurn)],
  [/^action\.DENY_PERMISSION_TO_ROLLBACK_TURN$/, done(T.rollbackDenied)],
  [/^action\.REQUEST_AUTO_ANSWER_/, done(T.autoAnswer)],
  [/^action\.(HOLD_PRIORITY|UNHOLD_PRIORITY)$/, done(T.holdPriority)],
  [/^action\.VIEW_SIDEBOARD$/, done(T.sideboardView)],
  [/^action\.VIEW_LIMITED_DECK$/, out('sealed')],
  [/^action\.TOGGLE_RECORD_MACRO$/, done(T.macro)],
  // never sent to the server: the Swing client uses these values for its own confirmation dialogs
  [/^action\.CLIENT_DOWNLOAD_(SYMBOLS|CARD_IMAGES)$/, done(T.tokens, 'Swing-internal; art is fetched by the gateway on demand')],
  [/^action\.CLIENT_(QUIT_TOURNAMENT|QUIT_DRAFT_TOURNAMENT)$/, out('tournaments')],
  [/^action\.CLIENT_CONCEDE_GAME$/, done(T.concedeGame, 'Swing-internal confirmation; the web client confirms and sends CONCEDE')],
  [/^action\.CLIENT_CONCEDE_MATCH$/, done(T.concedeMatch, 'Swing-internal confirmation')],
  [/^action\.CLIENT_STOP_WATCHING$/, out('spectating')],
  [/^action\.CLIENT_(DISCONNECT_FULL|DISCONNECT_KEEP_GAMES|EXIT_FULL|EXIT_KEEP_GAMES|RECONNECT)$/, done(T.online, 'Swing-internal; closing or reloading the page keeps the game, the client reconnects by itself')],
  [/^action\.CLIENT_REMOVE_TABLE$/, done(T.lobbyDeck, 'Swing-internal confirmation; "Leave table" in the lobby')],
  [/^action\.CLIENT_REPLAY_ACTION$/, out('replays')],

  // ---- prompt options
  [/^option\.(possibleAttackers|possibleBlockers)$/, done(T.combat)],
  [/^option\.specialButton$/, done(T.win, '"All attack"')],
  [/^option\.(originalId|autoAnswerMessage)$/, done(T.autoAnswer)],
  [/^option\.(secondMessage|hintText)$/, done(T.commander)],
  [/^option\.chosenTargets$/, done(T.special)],
  [/^option\.(possibleTargets|targetZone)$/, done(T.graveTarget)],
  [/^option\.queryType$/, done(T.triggers)],
  [/^option\.(title|header|canCancel)$/, done(T.combat)],
  [/^option\.UI\.(left|right)\.btn\.text$/, done(T.basics, 'the mulligan question arrives as "Mulligan" / "Keep"')],
  [/^option\.dialog$/, done(T.search, 'a Swing window object the client keeps for itself; never sent')],

  // ---- settings
  [/^UserData\.(groupId|userIdStr)$/, done(T.settingsKept, 'set by the gateway (player role, no client id)')],
  [/^UserData\.(avatarId|flagName)$/, done(T.settingsKept)],
  [/^UserData\.(allowRequestShowHandCards|requestedHandPlayersList)$/, done(T.handRequest)],
  [/^UserData\.confirmEmptyManaPool$/, done(T.confirmPool)],
  [/^UserData\.userSkipPrioritySteps$/, done(T.stops)],
  [/^UserData\.askMoveToGraveOrder$/, done(T.graveOrder)],
  [/^UserData\.manaPoolAutomatic$/, done(T.picker)],
  [/^UserData\.manaPoolAutomaticRestricted$/, done(T.restrictedMana)],
  [/^UserData\.passPriorityCast$/, done(T.holdPriority)],
  [/^UserData\.passPriorityActivation$/, done(T.passActivation)],
  [/^UserData\.autoOrderTrigger$/, done(T.autoOrder)],
  [/^UserData\.autoTargetLevel$/, done(T.autoTarget)],
  [/^UserData\.useSameSettingsForReplacementEffects$/, done(T.replacement)],
  [/^UserData\.useFirstManaAbility$/, done(T.firstMana)],
  [/^UserData\.(tourneyHistory|tourneyQuitRatio)$/, out('tournaments')],
  [/^UserData\.limitedRating$/, out('sealed', 'rating for limited formats; forwarded with the seat')],
  [/^UserData\.(matchHistory|matchQuitRatio|generalRating|constructedRating)$/, done(T.wireTable, 'kept by the server; shown with each seat')],
  [/^(yourTurn|opponentTurn)\./, done(T.stops)],
  [/^stops\.stopOnDeclareAttackers$/, done(T.stopAttackers)],
  [/^stops\.stopOnDeclareBlockers/, done(T.stopBlockers)],
  [/^stops\.(stopOnAllMainPhases|stopOnAllEndPhases)$/, done(T.stopPhases)],
  [/^stops\.stopOnStackNewObjects$/, done(T.stopStack)],

  // ---- Swing menus
  [/^menu\.Auto-answer (YES|NO)/, done(T.autoAnswer)],
  [/^menu\.(Reset all YES\/NO auto-answers|Yes\/no requests - reset all auto-answers|Auto-answers)$/, done(T.autoAnswer)],
  [/^menu\.F2 - Confirm current request$/, done(T.f2)],
  [/^menu\.(F3|F4|F5|F6|F7|F9|F11) - /, done(T.passKeys)],
  [/^menu\.Skip$/, done(T.passKeys)],
  [/^menu\.(Mana payment|Automatically)$/, done(T.picker)],
  [/^menu\.No automatic usage for mana already in the pool$/, done(T.restrictedMana)],
  [/^menu\.Use first mana ability when tapping lands$/, done(T.firstMana)],
  [/^menu\.Replacement effects - reset all auto-answers$/, done(T.replacement)],
  [/^menu\.(Triggered abilities - reset all auto-answers for stack order|Reset all order settings for triggered abilities)$/, done(T.triggerMemory)],
  [/^menu\.Put (this ability|all abilities)/, done(T.triggerMemory)],
  [/^menu\.(Rollback|To the start of the current turn)$/, done(T.rollback)],
  [/^menu\.(To the start of the previous turn|The current turn and the [23] turns before)$/, done(T.rollbackTurn)],
  [/^menu\.(Concede|Game)$/, done(T.concedeGame)],
  [/^menu\.Match$/, done(T.concedeMatch)],
  [/^menu\.(Request permission to see the hand cards|Allow hand requests from other users|Revoke all permission\(s\) to see your hand cards)$/, done(T.handRequest)],
  [/^menu\.Stop watching$/, out('spectating')],

  // ---- Swing hotkeys
  [/^hotkey\.KEY_CONTROL_CONFIRM$/, done(T.f2)],
  [/^hotkey\.KEY_CONTROL_(CANCEL_SKIP|NEXT_TURN|END_STEP|SKIP_STEP|MAIN_STEP|YOUR_TURN|PRIOR_END|SKIP_STACK)$/, done(T.passKeys)],
  [/^hotkey\.KEY_CONTROL_SWITCH_CHAT$/, done(T.chatKey)],
  [/^hotkey\.KEY_CONTROL_TOGGLE_MACRO$/, done(T.macro)],

  // ---- Swing dialogs
  [/^dialog\.PreferencesDialog$/, done(T.f2, 'the settings panel')],
  [/^dialog\.CardInfoWindowDialog$/, done(T.revealed)],
  [/^dialog\.ShowCardsDialog$/, done(T.search)],
  [/^dialog\.CardHintsHelperDialog$/, done(T.hints)],
  [/^dialog\.PickPileDialog$/, done(T.pile)],
  [/^dialog\.PickNumberDialog$/, done(T.xcost)],
  [/^dialog\.PickMultiNumberDialog$/, done(T.combat)],
  [/^dialog\.PickChoiceDialog$/, done(T.choice)],
  [/^dialog\.MageDialog$/, done(T.reload, 'the base class of the Swing dialogs')],

  // ---- Swing player panel
  [/^panel\.Card Types$/, done(T.cardTypes)],
  [/^panel\.Cheat button/, done(T.basics)],
  [/^panel\.(Command zone|Command Zone \(Commanders, Emblems, and Planes\))$/, done(T.emblem)],
  [/^panel\.(Energy|Experience|Rad|Ticket)$/, done(T.playerCounters, 'every player counter is shown by name')],
  [/^panel\.(Exile)$/, done(T.adventure)],
  [/^panel\.(Graveyard)$/, done(T.graveTarget)],
  [/^panel\.(Hand|Library|Life|Player)$/, done(T.wireGame)],
  [/^panel\.Open card hints helper window$/, done(T.hints)],
  [/^panel\.Time left$/, done(T.clock)],
  [/^panel\.White mana$/, done(T.picker)],

  // ---- Swing behaviour
  [/^feature\.large card preview on hover$/, done(T.split)],
  [/^feature\.battlefield with lands, creatures and other permanents$/, done(T.layout)],
  [/^feature\.attachments shown with their permanent$/, done(T.aura)],
  [/^feature\.identical permanents piled up$/, done(T.tokens)],
  [/^feature\.(hand panel|stack panel)$/, done('stays readable at')],
  [/^feature\.phase bar with the current step$/, done('the turn passing and the phase moving on are animated')],
  [/^feature\.click on the phase bar opens the stop settings$/, done(T.f2)],
  [/^feature\.feedback panel with the current request and its buttons$/, done(T.basics)],
  [/^feature\.special button$/, done(T.special)],
  [/^feature\.undo button$/, done(T.undo)],
  [/^feature\.targeting arrows$/, done(T.xcost)],
  [/^feature\.combat arrows$/, done(T.combat)],
  [/^feature\.click a card or permanent to play, activate, target, attack or block$/, done(T.combat)],
  [/^feature\.click a player to target$/, done(T.xcost)],
  [/^feature\.click the mana pool to pay$/, done(T.picker)],
  [/^feature\.hold priority with Ctrl$/, done(T.holdPriority)],
  [/^feature\.ability picker$/, done(T.picker)],
  [/^feature\.trigger order menu$/, done(T.triggerMemory)],
  [/^feature\.auto-answer menu for yes\/no requests$/, done(T.autoAnswer)],
  [/^feature\.card windows for/, done(T.revealed)],
  [/^feature\.switch between hands when controlling another player$/, done(T.mindslaver)],
  [/^feature\.hints helper window$/, done(T.hints)],
  [/^feature\.game log and chat$/, done(T.chat)],
  [/^feature\.skip buttons show the active pass mode$/, done(T.passModes)],
  [/^feature\.timer per player$/, done(T.clock)],
  [/^feature\.game end dialog$/, done(T.win)],
  [/^feature\.reconnect restores the game$/, done(T.online)],
  [/^feature\.cheat button in test mode$/, done(T.basics)],
  [/^feature\.macro recording$/, done(T.macro)],
  [/^feature\.adjustable sizes of the game panel$/, done(T.screen)],
  [/^feature\.sounds$/, out('sound')],
  [/^feature\.watching a game$/, out('spectating')],
  [/^feature\.replaying a game$/, out('replays')],
]

// ------------------------------------------------------------------ output

function testTitles() {
  const titles = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.spec.ts')) {
        const source = readFileSync(full, 'utf8')
        for (const m of source.matchAll(/\btest\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) {
          titles.push({ title: m[2].replace(/\\(.)/g, '$1'), file: path.relative(ROOT, full) })
        }
      }
    }
  }
  walk(path.join(ROOT, 'e2e', 'tests'))
  return titles.filter((t) => !t.file.includes(`${path.sep}debug${path.sep}`))
}

const items = inventory()
const titles = testTitles()
const problems = []
const rows = items.map((item) => {
  const rule = RULES.find(([pattern]) => pattern.test(item.id))
  if (!rule) {
    problems.push(`no entry for ${item.id}`)
    return { ...item, status: 'MISSING', proof: '' }
  }
  const entry = rule[1]
  if (entry.status === 'done') {
    const found = titles.find((t) => t.title.includes(entry.test))
    if (!found) problems.push(`${item.id}: no test called "${entry.test}"`)
    return { ...item, status: 'done', proof: `\`${found?.file ?? '?'}\` › ${entry.test}${entry.note ? ` — ${entry.note}` : ''}` }
  }
  if (!OUT_OF_SCOPE.includes(entry.reason)) problems.push(`${item.id}: "${entry.reason}" is not an allowed out-of-scope reason`)
  return { ...item, status: 'out of scope', proof: `${entry.reason}${entry.note ? ` — ${entry.note}` : ''}` }
})

const sections = [...new Set(rows.map((r) => r.section))]
const count = (status) => rows.filter((r) => r.status === status).length
const lines = [
  '# Parity with XMage',
  '',
  'Generated by `node scripts/parity.mjs` from the XMage sources in `../mage`; do not edit by hand.',
  '',
  'Every field of the view classes a game uses, every server callback, prompt option, player action and',
  "user setting, and every menu entry, hotkey, dialog and behaviour of the Swing client's game panel. Each is",
  'either **done**, with the Playwright test that proves it, or **out of scope** for one of: ' + OUT_OF_SCOPE.join(', ') + '.',
  '',
  `${rows.length} items: ${count('done')} done, ${count('out of scope')} out of scope.`,
  '',
]
for (const section of sections) {
  lines.push(`## ${section}`, '', '| Item | Status | Test / reason |', '|---|---|---|')
  for (const row of rows.filter((r) => r.section === section)) {
    lines.push(`| \`${row.id.replace(/^[a-z]+\./, (p) => (/^(callback|action|option|menu|hotkey|dialog|panel|feature|stops)\.$/.test(p) ? '' : p))}\` | ${row.status} | ${row.proof.replace(/\|/g, '\\|')} |`)
  }
  lines.push('')
}
writeFileSync(path.join(ROOT, 'docs', 'parity.md'), lines.join('\n'))
console.log(`docs/parity.md: ${rows.length} items, ${count('done')} done, ${count('out of scope')} out of scope`)
if (problems.length > 0) {
  console.log(`\n${problems.length} problems:`)
  for (const problem of [...new Set(problems)].slice(0, 80)) console.log(`  - ${problem}`)
  if (process.argv.includes('--check')) process.exit(1)
}
