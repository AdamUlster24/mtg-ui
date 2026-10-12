import { expect, test } from '@playwright/test'
import {
  cast,
  cheat,
  clickCard,
  clickId,
  finish,
  findPermanent,
  lands,
  logText,
  me,
  opponent,
  pass,
  passUntil,
  payMana,
  pickDone,
  press,
  setAmount,
  snap,
  startGame,
  until,
  waitPrompt,
} from '../../helpers'

test('responding on the stack: Counterspell', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Forest: 2 }), ...lands(b, { Island: 2 }), `hand:${a.name}:Grizzly Bears:1`, `hand:${b.name}:Counterspell:1`])

  await cast(a, 'Grizzly Bears')
  await pass(a)
  await waitPrompt(b, 'GAME_SELECT')
  await expect(b.page.locator('.hand .card[data-name="Counterspell"]')).toHaveClass(/mark-playable/)
  let s = await clickCard(b, 'Counterspell', 'hand')
  if (s.prompt!.method === 'GAME_TARGET') {
    // the target is the spell on the stack
    await clickCard(b, 'Grizzly Bears', 'stack')
  }
  await payMana(b)
  s = await until(a, 'two spells on the stack', (x) => (x.game.stack.length === 2 ? x : false))
  expect(s.game.stack[0].name).toBe('Counterspell')
  expect(s.game.stack[0].targets).toEqual([s.game.stack[1].id])
  await expect(a.page.locator('.stack-zone .card')).toHaveCount(2)
  await expect(a.page.locator('svg.arrows path.arrow.target')).toHaveCount(1)

  s = await passUntil(table, a, 'the stack to empty', (x) => x.game.stack.length === 0)
  expect(findPermanent(s, 'Grizzly Bears')).toBeUndefined()
  expect(me(s).graveyard.map((c: any) => c.name)).toEqual(['Grizzly Bears'])
  expect(opponent(s).graveyard.map((c: any) => c.name)).toEqual(['Counterspell'])
  await finish(table)
})

test('two triggers at once: the player orders them', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Forest: 2 }), `battlefield:${a.name}:Soul Warden:1`, `battlefield:${a.name}:Impact Tremors:1`, `hand:${a.name}:Grizzly Bears:1`])

  await cast(a, 'Grizzly Bears')
  let s = await passUntil(table, a, 'the trigger order question or both triggers done', (x) =>
    (x.prompt?.method === 'GAME_TARGET' && x.prompt.data.cards1?.length === 2) || (me(x).life === 41 && opponent(x).life === 39),
  )
  if (s.prompt?.method === 'GAME_TARGET') {
    expect(s.prompt.data.cards1.every((c: any) => c.isAbility)).toBe(true)
    expect(s.prompt.data.cards1.map((c: any) => c.sourceCard.name).sort()).toEqual(['Impact Tremors', 'Soul Warden'])
    // each trigger is shown with its source's art and its text, never "Ability deals..."
    expect(JSON.stringify(s.prompt.data.cards1.map((c: any) => c.rules))).not.toContain('Ability deals')
    await expect(a.page.locator('.modal .trigger-order .trigger .ability-strip')).toHaveCount(2)
    await expect(a.page.locator('.modal .trigger-order .trigger')).toHaveCount(2)
    await a.page.locator('.modal .trigger-order .trigger .card').first().click()
    s = await passUntil(table, a, 'both triggers to resolve', (x) => me(x).life === 41 && opponent(x).life === 39)
  }
  expect(me(s).life).toBe(41)
  expect(opponent(s).life).toBe(39)
  await finish(table)
})

test('commander: cast from the command zone, dies, returns to the command zone', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Plains: 1, Mountain: 1 }), `hand:${a.name}:Shock:1`])

  await expect(a.page.locator('.player-panel.mine .command-zone .card')).toHaveClass(/mark-playable/)
  await cast(a, 'Isamaru, Hound of Konda', 'command')
  let s = await passUntil(table, a, 'the commander on the battlefield', (x) => findPermanent(x, 'Isamaru, Hound of Konda'))
  expect(me(s).commandZone).toHaveLength(0)
  await expect(b.page.locator('.battlefield.theirs .card[data-name="Isamaru, Hound of Konda"]')).toBeVisible()

  await clickCard(a, 'Shock', 'hand')
  await waitPrompt(a, 'GAME_TARGET')
  await clickCard(a, 'Isamaru, Hound of Konda', 'mine')
  await payMana(a)
  s = await passUntil(table, a, 'the command zone question', (x) => x.prompt?.method === 'GAME_ASK')
  expect(String(s.prompt!.data.message)).toMatch(/command zone/i)
  await a.page.locator('.prompt-buttons .primary').click()
  s = await passUntil(table, a, 'the commander back in the command zone', (x) => me(x).commandZone.length === 1 && x.prompt?.method === 'GAME_SELECT')
  expect(findPermanent(s, 'Isamaru, Hound of Konda')).toBeUndefined()
  expect(me(s).graveyard.map((c: any) => c.name)).toEqual(['Shock'])
  await finish(table)
})

test('taking things back: cancel while paying, undo tapped mana', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Forest: 2 }), `hand:${a.name}:Grizzly Bears:1`])
  const untouched = (x: any) =>
    x.prompt?.method === 'GAME_SELECT' &&
    x.game.hand.some((c: any) => c.name === 'Grizzly Bears') &&
    x.game.stack.length === 0 &&
    me(x).battlefield.every((c: any) => !c.tapped)
  const undo = a.page.locator('.prompt-tools button', { hasText: 'Undo' })

  // a half paid spell is cancelled, not undone
  let s = await clickCard(a, 'Grizzly Bears', 'hand')
  expect(s.prompt!.method).toBe('GAME_PLAY_MANA')
  await expect(undo).toHaveCount(0)
  await clickId(a, me(s).battlefield.findLast((c: any) => !c.tapped).id)
  await until(a, 'one land tapped', (x) => me(x).battlefield.filter((c: any) => c.tapped).length === 1)
  await press(a, 'Cancel')
  s = await until(a, 'the spell back in hand after cancel', (x) => (untouched(x) ? x : false))
  await expect(undo).toHaveCount(0)

  // mana tapped while holding priority can be undone
  await clickId(a, me(s).battlefield.findLast((c: any) => !c.tapped).id)
  await until(a, 'mana in the pool', (x) => me(x).manaPool.G === 1)
  await undo.click()
  s = await until(a, 'the land untapped again', (x) => (untouched(x) && me(x).manaPool.G === 0 ? x : false))
  await expect(undo).toHaveCount(0)
  await finish(table)
})

test('scry: Opt looks at the top card', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Island: 1 }), `hand:${a.name}:Opt:1`])
  const hand = (await snap(a)).game.hand.length

  await cast(a, 'Opt')
  let s = await passUntil(table, a, 'the scry choice or the draw', (x) =>
    (x.prompt?.method === 'GAME_TARGET' && x.prompt.data.cards1?.length === 1) || x.game.hand.length === hand,
  )
  if (s.prompt?.method === 'GAME_TARGET') {
    await expect(a.page.locator('.modal .card-grid .card')).toHaveCount(1)
    await pickDone(a)
    s = await passUntil(table, a, 'the draw', (x) => x.game.hand.length === hand)
  }
  // Opt left the hand, one card was drawn
  expect(s.game.hand.length).toBe(hand)
  expect(logText(s)).toMatch(/scr(y|ies)/i)
  await finish(table)
})

test('chat reaches the other player', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await a.page.locator('.log-panel input').fill('good luck, have fun')
  await a.page.keyboard.press('Enter')
  await expect(b.page.locator('.log-line', { hasText: 'good luck, have fun' })).toBeVisible()
  await expect(b.page.locator('.log-line', { hasText: 'good luck, have fun' })).toContainText(a.name)
  await finish(table)
})

test('asking the opponent to restart the turn', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [`hand:${a.name}:Forest:1`])
  await clickCard(a, 'Forest', 'hand')
  await until(a, 'the land', (x) => findPermanent(x, 'Forest'))

  await a.page.getByRole('button', { name: /More/ }).click()
  await a.page.getByRole('button', { name: 'Roll back to the start of this turn' }).click()
  // the opponent decides
  await expect(b.page.locator('.modal', { hasText: /roll ?back/i })).toBeVisible()
  await b.page.locator('.modal footer button').first().click()
  await expect(b.page.locator('.modal')).toHaveCount(0)
  const s = await until(a, 'the turn rolled back', (x) => (!findPermanent(x, 'Forest') && x.prompt?.method === 'GAME_SELECT' ? x : false))
  expect(logText(s)).toMatch(/roll/i)
  await finish(table)
})

test('a page reload brings back an open dialog', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Mountain: 3 }), `hand:${a.name}:Blaze:1`])
  await clickCard(a, 'Blaze', 'hand')
  await expect(a.page.locator('.modal .amount')).toBeVisible()
  const logLines = await a.page.locator('.log-line').count()

  await a.page.reload()
  await expect(a.page.locator('.modal .amount')).toBeVisible()
  await expect(a.page.locator('.battlefield.mine .card[data-name="Mountain"]')).toHaveCount(3)
  expect(await a.page.locator('.log-line').count()).toBe(logLines)

  await setAmount(a, 2)
  await waitPrompt(a, 'GAME_TARGET')
  const s = await snap(a)
  await clickId(a, opponent(s).id)
  await payMana(a)
  await passUntil(table, b, 'the damage', (x) => me(x).life === 38)
  await finish(table)
})

test('winning by combat damage: all attack, result screens, back to the lobby', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [`battlefield:${a.name}:Craw Wurm:7`])

  await passUntil(table, a, 'the attack declaration', (x) => x.prompt?.method === 'GAME_SELECT' && /attackers/i.test(x.prompt.data.message))
  await press(a, 'All attack')
  await expect(a.page.locator('.battlefield.mine .card.attacking')).toHaveCount(7)
  await press(a, 'Attack')

  // 42 damage: the game ends, both players get their result
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && !(await snap(b)).gameEnd) {
    for (const seat of table.seats) {
      const s = await snap(seat)
      if (s.prompt?.method === 'GAME_SELECT' && !s.answering && !s.gameEnd) {
        await seat.page.locator('.prompt-buttons .primary').click().catch(() => {})
        await until(seat, 'the next prompt', (x) => x.prompt?.messageId !== s.prompt!.messageId || !!x.gameEnd, 5000).catch(() => {})
      }
    }
  }
  await expect(a.page.locator('.modal h3')).toHaveText('Victory')
  await expect(b.page.locator('.modal h3')).toHaveText('Defeat')
  await expect(b.page.locator('.player-panel.mine .life')).toHaveText('-2')

  for (const seat of table.seats) {
    await seat.page.getByRole('button', { name: 'Back to lobby' }).click()
    await expect(seat.page.locator('.lobby')).toBeVisible()
    // the deck is still there for the next game
    await expect(seat.page.locator('.deck-status.good')).toBeVisible()
  }
  await finish(table)
})
