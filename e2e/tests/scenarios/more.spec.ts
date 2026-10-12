import { expect, test } from '@playwright/test'
import {
  cast,
  cheat,
  clickCard,
  clickVisible,
  closeSettings,
  finish,
  findPermanent,
  lands,
  logText,
  me,
  opponent,
  openSettings,
  pass,
  passUntil,
  payMana,
  resolveUntil,
  setSetting,
  settle,
  snap,
  startGame,
  stopsSeen,
  until,
  waitPrompt,
} from '../../helpers'

test('every pass-until key and menu entry sends XMage\'s action', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  // watch what the client sends instead of letting the game run away
  await a.page.evaluate(() => {
    const store = (window as any).mtgui.store
    ;(window as any).sent = []
    store.setState({ action: (action: string, data?: unknown) => void (window as any).sent.push(data === undefined ? action : [action, data]) })
  })
  const KEYS: Record<string, string> = {
    F3: 'PASS_PRIORITY_CANCEL_ALL_ACTIONS',
    F4: 'PASS_PRIORITY_UNTIL_NEXT_TURN',
    F5: 'PASS_PRIORITY_UNTIL_TURN_END_STEP',
    F6: 'PASS_PRIORITY_UNTIL_NEXT_TURN_SKIP_STACK',
    F7: 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE',
    F9: 'PASS_PRIORITY_UNTIL_MY_NEXT_TURN',
    F10: 'PASS_PRIORITY_UNTIL_STACK_RESOLVED',
    F11: 'PASS_PRIORITY_UNTIL_END_STEP_BEFORE_MY_NEXT_TURN',
  }
  for (const key of Object.keys(KEYS)) await a.page.keyboard.press(key)
  expect(await a.page.evaluate(() => (window as any).sent)).toEqual(Object.values(KEYS))

  // the same eight from the menu, each labelled with its key
  await a.page.evaluate(() => ((window as any).sent = []))
  for (const key of Object.keys(KEYS)) {
    await a.page.getByRole('button', { name: /More/ }).click()
    await a.page.locator('.prompt-tools .menu button', { has: a.page.locator('kbd', { hasText: new RegExp(`^${key}$`) }) }).click()
  }
  expect(await a.page.evaluate(() => (window as any).sent)).toEqual(Object.values(KEYS))

  // rollbacks: one entry per number of turns
  await a.page.evaluate(() => ((window as any).sent = []))
  for (const label of ['to the start of this turn', 'to the start of the previous turn', 'this turn and the 2 before', 'this turn and the 3 before']) {
    await a.page.getByRole('button', { name: /More/ }).click()
    await a.page.getByRole('button', { name: `Roll back ${label}` }).click()
  }
  expect(await a.page.evaluate(() => (window as any).sent)).toEqual([0, 1, 2, 3].map((n) => ['ROLLBACK_TURNS', n]))
  for (const seat of table.seats) await seat.context.close()
})

test('conceding the game gives the opponent the win', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  let asked = ''
  a.page.on('dialog', (d) => {
    asked = d.message()
    void d.accept()
  })
  await a.page.getByRole('button', { name: /More/ }).click()
  await a.page.getByRole('button', { name: 'Concede this game' }).click()
  await expect(b.page.locator('.modal h3')).toHaveText('Victory', { timeout: 20_000 })
  await expect(a.page.locator('.modal h3')).toHaveText('Defeat')
  expect(asked).toMatch(/Concede/)
  expect(logText(await snap(b))).toMatch(/conceded|has lost/i)
  for (const seat of table.seats) await seat.context.close()
})

test('a rollback request can be refused', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [`hand:${a.name}:Forest:1`])
  await clickCard(a, 'Forest', 'hand')
  await until(a, 'the land', (x) => findPermanent(x, 'Forest'))
  await a.page.getByRole('button', { name: /More/ }).click()
  await a.page.getByRole('button', { name: 'Roll back to the start of this turn' }).click()
  const dialog = b.page.locator('.modal', { hasText: /roll ?back/i })
  await expect(dialog).toBeVisible()
  expect(await dialog.locator('footer button').count()).toBeGreaterThan(1)
  await dialog.locator('footer button', { hasText: /deny|no|refuse/i }).first().click()
  await expect(b.page.locator('.modal')).toHaveCount(0)
  // nothing is rolled back
  await a.page.waitForTimeout(1500)
  expect(findPermanent(await snap(a), 'Forest')).toBeTruthy()
  await finish(table)
})

test('F9 and F11 stop at every main phase and end step, or only before my turn', async ({ browser }) => {
  test.setTimeout(240_000)
  const table = await startGame(browser)
  const { a } = table
  const myMain = (turn: number) => until(a, `my turn ${turn}`, (x) => x.game.turn === turn && x.prompt?.method === 'GAME_SELECT' && x.game.step === 'PRECOMBAT_MAIN', 40_000)

  // defaults: F9 (until my next turn) still stops at main phases on the way, F11 at end steps
  await a.page.keyboard.press('F9')
  let seen = await stopsSeen(table, a, 3)
  expect([...(seen[1] ?? []), ...(seen[2] ?? [])].filter((s) => /MAIN/.test(s)).length).toBeGreaterThan(0)
  await myMain(3)
  await a.page.keyboard.press('F11')
  seen = await stopsSeen(table, a, 5)
  expect([...(seen[3] ?? []), ...(seen[4] ?? [])]).toContain('END_TURN')

  // switched off: straight through to my own turn
  await myMain(5)
  await setSetting(a, 'stopOnAllMainPhases', false, 'Stops')
  await setSetting(a, 'stopOnAllEndPhases', false, 'Stops')
  await a.page.keyboard.press('F9')
  seen = await stopsSeen(table, a, 7)
  expect([...(seen[5] ?? []), ...(seen[6] ?? [])].filter((s) => /MAIN/.test(s))).toEqual([])
  await myMain(7)
  await a.page.keyboard.press('F11')
  seen = await stopsSeen(table, a, 9)
  expect(seen[7] ?? []).not.toContain('END_TURN')
  await finish(table)
})

test('while passing: stop when something new goes on the stack, or not', async ({ browser }) => {
  test.setTimeout(180_000)
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(b, { Forest: 4 }), `hand:${b.name}:Grizzly Bears:2`])
  const bCasts = async (turn: number) => {
    await passUntil(table, b, `turn ${turn}`, (x) => x.game.turn === turn && x.prompt?.method === 'GAME_SELECT' && x.game.step === 'PRECOMBAT_MAIN', 60_000)
    await a.page.keyboard.press('F9')
    await clickCard(b, 'Grizzly Bears', 'hand')
    await payMana(b)
    await pass(b)
    // either I get to respond, or the spell just resolves
    const wanted = turn === 2 ? 1 : 2
    return until(a, "my chance to respond, or the bears", (x) => ((x.prompt?.method === "GAME_SELECT" && x.game.stack.length === 1) || opponent(x).battlefield.filter((c: any) => c.name === "Grizzly Bears").length === wanted ? x : false), 20_000)
  }
  // default: passing is interrupted by a new spell
  let s = await bCasts(2)
  expect(s.game.stack).toHaveLength(1)
  await pass(a)

  await passUntil(table, a, 'my turn 3', (x) => x.game.turn === 3 && x.prompt?.method === 'GAME_SELECT' && x.game.step === 'PRECOMBAT_MAIN', 60_000)
  await setSetting(a, 'stopOnStackNewObjects', false, 'Stops')
  s = await bCasts(4)
  expect(s.game.stack).toHaveLength(0)
  await finish(table)
})

test('identical triggers: ordered automatically, or asked', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Forest: 4 }), `battlefield:${a.name}:Soul Warden:2`, `hand:${a.name}:Grizzly Bears:2`])
  const asked = (x: any) => x.prompt?.method === 'GAME_TARGET' && x.prompt.data.options.queryType === 'PICK_ABILITY'
  const gained = (life: number) => (x: any) => me(x).life === life && x.game.stack.length === 0 && x.prompt?.method === 'GAME_SELECT'

  // default: two triggers that do the same are put on the stack without a question
  await cast(a, 'Grizzly Bears')
  let s = await passUntil(table, a, 'two life', (x) => gained(42)(x) || asked(x))
  expect(asked(s)).toBe(false)

  await setSetting(a, 'autoOrderTrigger', false)
  await cast(a, 'Grizzly Bears')
  s = await passUntil(table, a, 'the order question', (x) => gained(44)(x) || asked(x))
  expect(asked(s)).toBe(true)
  await finish(table)
})

test('restricted mana is spent automatically, or only by hand', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  // Ancient Ziggurat: mana that can only be spent on creature spells
  await cheat(a, [`battlefield:${a.name}:Ancient Ziggurat:2`, `hand:${a.name}:Savannah Lions:2`])
  const float = async () => {
    const s = await snap(a)
    const land = me(s).battlefield.find((c: any) => c.name === 'Ancient Ziggurat' && !c.tapped)
    await clickVisible(a, a.page.locator(`[data-oid="${land.id}"]`).first())
    let next = await until(a, 'the color question or the mana', (x) => (x.prompt?.method === 'GAME_CHOOSE_CHOICE' || Object.values(me(x).manaPool).some((n: any) => n > 0) ? x : false))
    if (next.prompt?.method === 'GAME_CHOOSE_CHOICE') {
      await a.page.locator('.modal .option-list button', { hasText: /White/ }).click()
      next = await until(a, 'the mana', (x) => (me(x).manaPool.W > 0 ? x : false))
    }
  }
  // default ("never spend restricted mana automatically"): the pool is not touched until I click it
  await float()
  let s = await clickCard(a, 'Savannah Lions', 'hand')
  expect(s.prompt!.method).toBe('GAME_PLAY_MANA')
  expect(me(s).manaPool.W).toBe(1)
  await a.page.locator('.player-panel.mine .mana-pool button').click()
  await passUntil(table, a, 'the first lions', (x) => me(x).battlefield.filter((c: any) => c.name === 'Savannah Lions').length === 1 && x.prompt?.method === 'GAME_SELECT')

  // switched off: restricted mana in the pool pays by itself
  await setSetting(a, 'manaPoolAutomaticRestricted', false)
  await float()
  s = await clickCard(a, 'Savannah Lions', 'hand')
  expect(s.prompt!.method).toBe('GAME_SELECT')
  expect(s.game.stack.map((c: any) => c.name)).toEqual(['Savannah Lions'])
  await finish(table)
})

test('replacement effects: the choice is remembered, or asked every time', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  // two effects want to change the same counters: the player decides which applies first
  await cheat(a, [...lands(a, { Forest: 6 }), `battlefield:${a.name}:Hardened Scales:1`, `battlefield:${a.name}:Doubling Season:1`, `hand:${a.name}:Servant of the Scale:3`])
  const asked = (x: any) => x.prompt?.method === 'GAME_CHOOSE_CHOICE'
  const servants = (n: number) => (x: any) => me(x).battlefield.filter((c: any) => c.name === 'Servant of the Scale').length === n && x.game.stack.length === 0 && x.prompt?.method === 'GAME_SELECT'
  const play = async (n: number) => {
    await cast(a, 'Servant of the Scale')
    return passUntil(table, a, `servant ${n} or the question`, (x) => servants(n)(x) || asked(x))
  }
  const answer = async (n: number) => {
    await a.page.locator('.modal .option-list button').first().click()
    await passUntil(table, a, `servant ${n}`, servants(n))
  }

  // default: asked once, the same pair of effects is then applied the same way
  let s = await play(1)
  expect(asked(s)).toBe(true)
  await answer(1)
  s = await play(2)
  expect(asked(s)).toBe(false)

  // "forget replacement choices" brings the question back
  await openSettings(a, 'Playing')
  await a.page.locator('[data-reset="replacement"]').click()
  await closeSettings(a)
  s = await play(3)
  expect(asked(s)).toBe(true)
  await answer(3)
  await finish(table)
})

test('Planechase: the plane is in the command zone and the planar die can be rolled', async ({ browser }) => {
  const table = await startGame(browser, { tableOptions: { planeChase: true } })
  const { a, b } = table
  const s = await until(a, 'the plane', (x) => (x.game.players.some((p: any) => p.commandZone.some((c: any) => c.commandKind === 'plane')) ? x : false))
  const owner = s.game.players.find((p: any) => p.commandZone.some((c: any) => c.commandKind === 'plane'))
  const plane = owner.commandZone.find((c: any) => c.commandKind === 'plane')
  expect(plane.name).toBeTruthy()
  expect(plane.rules.length).toBeGreaterThan(0)
  const tile = a.page.locator('.command-object[data-command-kind="plane"]')
  await expect(tile).toBeVisible()
  await expect(b.page.locator('.command-object[data-command-kind="plane"]')).toBeVisible()
  await tile.hover()
  await expect(a.page.locator('.preview')).toContainText(plane.name.replace(/^Plane - /, ''))

  // the active player may roll the planar die: it is one of the things they can do
  await tile.click()
  const rolled = await resolveUntil(table, a, 'the planar die', (x) => /Roll a planar die/.test(logText(x)), 30_000)
  expect(logText(rolled)).toMatch(/rolled/)
  await finish(table)
})

test('the graveyard pile tells how many card types it holds', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  const pile = a.page.locator('.player-panel.mine .zone-piles [data-pile^="graveyard"]')
  await expect(pile).toHaveAttribute('data-card-types', '0')
  await cheat(a, [`graveyard:${a.name}:Grizzly Bears:2`, `graveyard:${a.name}:Forest:1`, `graveyard:${a.name}:Shock:1`])
  await expect(pile).toHaveAttribute('data-card-types', '3')
  await expect(pile).toHaveAttribute('title', 'Graveyard · 3 card types')
  await finish(table)
})

test('F12 moves to the chat', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await a.page.locator('.side-toggle').click()
  await expect(a.page.locator('.log-panel')).toHaveCount(0)
  await a.page.keyboard.press('F12')
  await expect(a.page.locator('.log-panel input')).toBeFocused()
  await a.page.keyboard.type('hello from the keyboard')
  await a.page.keyboard.press('Enter')
  await expect(b.page.locator('.log-line', { hasText: 'hello from the keyboard' })).toBeVisible()
  // typing in the chat does not trigger game keys
  await a.page.locator('.log-panel input').fill('F')
  expect((await snap(a)).prompt!.method).toBe('GAME_SELECT')
  await finish(table)
})
