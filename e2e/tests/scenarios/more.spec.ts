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

test("F7 and F5: stopping in the opponent's main phases and at my own end step", async ({ browser }) => {
  test.setTimeout(240_000)
  const table = await startGame(browser)
  const { a } = table
  const myMain = (turn: number) => passUntil(table, a, `my turn ${turn}`, (x) => x.game.turn === turn && x.prompt?.method === 'GAME_SELECT' && x.game.step === 'PRECOMBAT_MAIN', 60_000)
  const mains = (steps: string[] = []) => steps.filter((s) => /MAIN/.test(s))

  // F5 (until end step), default: stops at my own end step
  await a.page.keyboard.press('F5')
  let seen = await stopsSeen(table, a, 2)
  expect(seen[1] ?? []).toContain('END_TURN')
  // F7 (until next main phase), default: the opponent's main phase counts
  await myMain(3)
  await passUntil(table, a, 'my second main phase', (x) => x.game.step === 'POSTCOMBAT_MAIN' && x.prompt?.method === 'GAME_SELECT', 20_000)
  await a.page.keyboard.press('F7')
  seen = await stopsSeen(table, a, 5)
  expect(mains(seen[4]).length).toBeGreaterThan(0)

  // both switched off
  await myMain(5)
  await setSetting(a, 'stopOnAllEndPhases', false, 'Stops')
  await setSetting(a, 'stopOnAllMainPhases', false, 'Stops')
  await a.page.keyboard.press('F5')
  seen = await stopsSeen(table, a, 6)
  expect(seen[5] ?? []).not.toContain('END_TURN')
  await myMain(7)
  await passUntil(table, a, 'my second main phase', (x) => x.game.step === 'POSTCOMBAT_MAIN' && x.prompt?.method === 'GAME_SELECT', 20_000)
  await a.page.keyboard.press('F7')
  seen = await stopsSeen(table, a, 9)
  expect(mains(seen[8])).toEqual([])
  await finish(table)
})

test('F10: passing until the stack resolves stops for something new, or not', async ({ browser }) => {
  test.setTimeout(180_000)
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Forest: 4 }), ...lands(b, { Mountain: 2 }), `hand:${a.name}:Grizzly Bears:2`, `hand:${b.name}:Shock:2`])
  const round = async () => {
    await clickCard(a, 'Grizzly Bears', 'hand')
    await payMana(a)
    await waitPrompt(a, 'GAME_SELECT')
    // I pass until my spell has resolved; the opponent answers with a spell of their own
    await a.page.keyboard.press('F10')
    await waitPrompt(b, 'GAME_SELECT')
    await clickCard(b, 'Shock', 'hand')
    const s = await settle(b)
    if (s.prompt!.method === 'GAME_TARGET') await clickVisible(b, b.page.locator(`.life-orb[data-oid="${opponent(s).id}"]`))
    await payMana(b)
    // the opponent keeps passing; I either get to respond to their spell, or everything resolves
    const deadline = Date.now() + 25_000
    for (;;) {
      const mine = await snap(a)
      if ((mine.prompt?.method === 'GAME_SELECT' && mine.game.stack.length === 2) || mine.game.stack.length === 0) return mine
      const theirs = await snap(b)
      if (theirs.prompt?.method === 'GAME_SELECT' && !theirs.answering) await pass(b).catch(() => {})
      if (Date.now() > deadline) throw new Error('neither a chance to respond nor an empty stack')
      await a.page.waitForTimeout(100)
    }
  }
  // default: the new spell interrupts my passing
  let s = await round()
  expect(s.game.stack).toHaveLength(2)
  await passUntil(table, a, 'an empty stack', (x) => x.game.stack.length === 0 && x.prompt?.method === 'GAME_SELECT')

  await setSetting(a, 'stopOnStackNewObjects', false, 'Stops')
  s = await round()
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

test('mana that was already in the pool: spent by hand, or automatically', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Plains: 2, Forest: 2 }), `hand:${a.name}:Savannah Lions:2`])
  const float = async () => {
    for (const name of ['Plains', 'Forest']) {
      const s = await snap(a)
      const land = me(s).battlefield.findLast((c: any) => c.name === name && !c.tapped)
      await clickVisible(a, a.page.locator(`[data-oid="${land.id}"]`).first())
      const key = name === 'Plains' ? 'W' : 'G'
      const had = me(s).manaPool[key]
      await until(a, `mana from the ${name}`, (x) => me(x).manaPool[key] === had + 1)
    }
    const s = await snap(a)
    expect(me(s).manaPool.W).toBeGreaterThan(0)
    expect(me(s).manaPool.G).toBeGreaterThan(0)
  }
  // default: mana floated before casting is not touched until I click it
  await float()
  let s = await clickCard(a, 'Savannah Lions', 'hand')
  expect(s.prompt!.method).toBe('GAME_PLAY_MANA')
  await a.page.locator('.player-panel.mine .mana-pool button', { has: a.page.locator('img[alt="W"]') }).click()
  await passUntil(table, a, 'the first lions', (x) => me(x).battlefield.filter((c: any) => c.name === 'Savannah Lions').length === 1 && x.game.stack.length === 0)

  // switched off: the pool pays by itself
  await passUntil(table, a, 'priority', (x) => x.prompt?.method === 'GAME_SELECT' && x.game.stack.length === 0 && x.game.step === 'PRECOMBAT_MAIN').catch(() => {})
  await setSetting(a, 'manaPoolAutomaticRestricted', false)
  await float()
  s = await clickCard(a, 'Savannah Lions', 'hand')
  expect(s.prompt!.method).toBe('GAME_SELECT')
  expect(s.game.stack.map((c: any) => c.name)).toEqual(['Savannah Lions'])
  await finish(table)
})

test('replacement effects: a remembered choice, for one object or for every copy', async ({ browser }) => {
  test.setTimeout(180_000)
  const table = await startGame(browser)
  const { a } = table
  // two effects want to change the same counters: the player decides which applies first
  await cheat(a, [
    ...lands(a, { Forest: 9, Plains: 4 }),
    `battlefield:${a.name}:Hardened Scales:1`,
    `battlefield:${a.name}:Doubling Season:1`,
    `hand:${a.name}:Servant of the Scale:7`,
    `hand:${a.name}:Disenchant:2`,
  ])
  const asked = (x: any) => x.prompt?.method === 'GAME_CHOOSE_CHOICE'
  const servants = (n: number) => (x: any) => me(x).battlefield.filter((c: any) => c.name === 'Servant of the Scale').length === n && x.game.stack.length === 0 && x.prompt?.method === 'GAME_SELECT'
  let count = 0
  const play = async () => {
    count++
    await cast(a, 'Servant of the Scale')
    return passUntil(table, a, `servant ${count} or the question`, (x) => servants(count)(x) || asked(x))
  }
  const answer = async (remember: boolean) => {
    await expect(a.page.locator('[data-choice-special]')).toBeVisible()
    if (remember) await a.page.locator('[data-choice-special] input').check()
    await a.page.locator('.modal .option-list button').first().click()
    await passUntil(table, a, `servant ${count}`, servants(count))
  }
  /** a new copy of Hardened Scales takes the place of the old one */
  const swapScales = async () => {
    await clickCard(a, 'Disenchant', 'hand')
    const s = await settle(a)
    if (s.prompt!.method === 'GAME_TARGET') await clickCard(a, 'Hardened Scales', 'mine')
    await payMana(a)
    await passUntil(table, a, 'the old enchantment gone', (x) => !findPermanent(x, 'Hardened Scales') && x.game.stack.length === 0 && x.prompt?.method === 'GAME_SELECT')
    await cheat(a, [`battlefield:${a.name}:Hardened Scales:1`])
  }

  // asked; without "remember" it is asked again
  expect(asked(await play())).toBe(true)
  await answer(false)
  expect(asked(await play())).toBe(true)
  // remembered for these two objects only
  await answer(false)
  await setSetting(a, 'useSameSettingsForReplacementEffects', false)
  expect(asked(await play())).toBe(true)
  await answer(true)
  expect(asked(await play())).toBe(false)
  await swapScales()
  expect(asked(await play())).toBe(true)
  await answer(false)

  // forgotten, then remembered for every copy of the cards
  await openSettings(a, 'Playing')
  await a.page.locator('[data-reset="replacement"]').click()
  await a.page.locator('[data-setting="useSameSettingsForReplacementEffects"]').check()
  await a.page.waitForFunction(() => (window as any).mtgui.store.getState().settings.useSameSettingsForReplacementEffects === true)
  await closeSettings(a)
  expect(asked(await play())).toBe(true)
  await answer(true)
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
  const tile = a.page.locator('.command-object[data-command-kind="plane"]').first()
  await expect(tile).toBeVisible()
  await expect(b.page.locator('.command-object[data-command-kind="plane"]').first()).toBeVisible()
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
