import { expect, test } from '@playwright/test'
import { cheat, finish, findPermanent, lands, me, opponent, snap, startGame, until } from '../../helpers'

// The gateway owns the JSON contract. These tests pin down that every piece of XMage's views
// arrives in the browser, including the ones no other scenario looks at.

test('every field of the game and player views reaches the browser', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  const s = await snap(a)
  const game = s.game
  for (const key of [
    'turn', 'phase', 'step', 'activePlayerId', 'activePlayerName', 'priorityPlayerName', 'special', 'rollbackTurnsAllowed', 'myPlayerId',
    'players', 'hand', 'stack', 'combat', 'exiles', 'revealed', 'companion', 'lookedAt', 'opponentHands', 'watchedHands', 'helperEmblems',
    'priorityTime', 'bufferTime', 'totalErrorsCount', 'totalEffectsCount', 'gameCycle',
  ]) {
    expect(game, `game.${key}`).toHaveProperty(key)
  }
  expect(game.phase).toBe('PRECOMBAT_MAIN')
  expect(game.activePlayerName).toBe(a.name)
  expect(game.priorityPlayerName).toBe(a.name)
  expect(game.myPlayerId).toBe(me(s).id)
  expect(game.totalErrorsCount).toBe(0)
  expect(game.gameCycle).toBeGreaterThan(0)

  const player = me(s)
  for (const key of [
    'id', 'name', 'controlled', 'human', 'life', 'counters', 'wins', 'winsNeeded', 'libraryCount', 'handCount', 'active', 'hasPriority',
    'timerActive', 'hasLeft', 'manaPool', 'graveyard', 'exile', 'sideboard', 'battlefield', 'topCard', 'commandZone', 'attachments', 'undoSteps',
    'priorityTimeLeftSecs', 'bufferTimeLeft', 'passedTurn', 'passedUntilEndOfTurn', 'passedUntilNextMain', 'passedUntilStackResolved',
    'passedAllTurns', 'passedUntilEndStepBeforeMyTurn', 'monarch', 'initiative', 'designations', 'flag', 'avatarId',
  ]) {
    expect(player, `player.${key}`).toHaveProperty(key)
  }
  expect(player).toMatchObject({ name: a.name, controlled: true, human: true, life: 40, libraryCount: 53, handCount: 7, active: true, hasPriority: true, hasLeft: false })
  expect(Object.keys(player.manaPool).sort()).toEqual(['B', 'C', 'G', 'R', 'U', 'W'])
  expect(opponent(s)).toMatchObject({ name: b.name, controlled: false, active: false, hasPriority: false })
  // only my own hand is sent; the opponent's is a number
  expect(game.hand).toHaveLength(7)
  expect(opponent(s).handCount).toBe(7)
  await finish(table)
})

test('every field of cards and permanents reaches the browser', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Plains: 1 }), `battlefield:${a.name}:Serra Angel:1`, `hand:${a.name}:Isamaru, Hound of Konda:1`])
  const s = await until(a, 'the angel', (x) => (findPermanent(x, 'Serra Angel') ? x : false))
  const angel = findPermanent(s, 'Serra Angel')
  for (const key of [
    'id', 'set', 'number', 'usesVariousArt', 'gameObject', 'choosable', 'selected', 'name', 'displayName', 'displayFullName', 'imageFileName', 'imageNumber',
    'token', 'faceDown', 'typeLine', 'types', 'subTypes', 'superTypes', 'manaCost', 'manaValue', 'colors', 'frameColors', 'frameStyle', 'artRect', 'rarity',
    'rules', 'hints', 'power', 'toughness', 'loyalty', 'defense', 'startingLoyalty', 'startingDefense', 'counters', 'zone', 'objectType', 'isAbility',
    'abilityType', 'paid', 'canTransform', 'transformed', 'split', 'flipCard', 'canAttack', 'canBlock', 'controlledByOwner', 'targets', 'parentId', 'pairedCard',
    'bandedCards', 'alternateName', 'extraDeckCard', 'rotate', 'icons', 'basePower', 'baseToughness', 'colorIdentity', 'originalIsCopy', 'playable', 'playableAmount',
    // permanents
    'permanent', 'tapped', 'damage', 'summoningSick', 'phasedIn', 'flipped', 'copy', 'controlled', 'ownerName', 'controllerName', 'attachedTo',
    'attachedToPermanent', 'attachments', 'morphed', 'disguised', 'manifested', 'cloaked', 'attachedControllerDiffers', 'mutated', 'original',
  ]) {
    expect(angel, `card.${key}`).toHaveProperty(key)
  }
  expect(angel).toMatchObject({
    name: 'Serra Angel',
    typeLine: 'Creature - Angel',
    types: ['CREATURE'],
    subTypes: ['Angel'],
    superTypes: [],
    manaCost: '{3}{W}{W}',
    manaValue: 5,
    colors: 'W',
    power: '4',
    toughness: '4',
    basePower: 4,
    baseToughness: 4,
    objectType: 'PERMANENT',
    permanent: true,
    tapped: false,
    token: false,
    faceDown: false,
    controlled: true,
    controlledByOwner: true,
    // only true while attackers are being declared
    canAttack: false,
    phasedIn: true,
    colorIdentity: '{W}',
  })
  expect(angel.set).toMatch(/^[A-Z0-9]{2,6}$/)
  expect(angel.number).toMatch(/\d/)
  expect(['COMMON', 'UNCOMMON', 'RARE', 'MYTHIC', 'SPECIAL', 'LAND', 'BONUS']).toContain(angel.rarity)
  expect(angel.rules.join(' ')).toMatch(/Flying/)

  const legend = s.game.hand.find((c: any) => c.name === 'Isamaru, Hound of Konda')
  expect(legend.superTypes).toEqual(['LEGENDARY'])
  expect(legend.playable).toBe(true)
  expect(legend.playableAmount).toBe(1)
  expect(legend.playableAbilities.length).toBe(1)
  await finish(table)
})

test('the table list and the lobby carry XMage\'s table information', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  // the table switches to "dueling" a moment after the game appears
  let mine: any
  await expect
    .poll(async () => {
      const tables = await a.page.evaluate(() => (window as any).mtgui.store.getState().request('tables'))
      mine = tables.find((t: any) => t.controllerName?.includes(a.name))
      return mine?.state
    })
    .toBe('DUELING')
  for (const key of ['id', 'name', 'controllerName', 'gameType', 'deckType', 'state', 'stateText', 'info', 'infoFull', 'seatsInfo', 'createTime', 'skillLevel', 'passworded', 'rated', 'limited', 'tournament', 'spectatorsAllowed', 'quitRatio', 'minimumRating', 'seats', 'games']) {
    expect(mine, `table.${key}`).toHaveProperty(key)
  }
  expect(mine).toMatchObject({ gameType: 'Commander Two Player Duel', deckType: 'Commander', state: 'DUELING', tournament: false, limited: false, rated: false, passworded: false, quitRatio: '100' })
  expect(mine.seats.map((seat: any) => seat.playerName).sort()).toEqual([table.a.name, table.b.name].sort())
  expect(mine.games).toHaveLength(1)
  for (const key of ['playerId', 'playerName', 'playerType', 'flag', 'history', 'generalRating', 'constructedRating', 'limitedRating']) expect(mine.seats[0], `seat.${key}`).toHaveProperty(key)
  await finish(table)
})
