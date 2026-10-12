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
  me,
  opponent,
  openSettings,
  pass,
  passUntil,
  payMana,
  setSetting,
  settle,
  snap,
  startGame,
  until,
  waitPrompt,
} from '../../helpers'

test('pass priority after casting, unless holding priority', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Forest: 4 }), `hand:${a.name}:Grizzly Bears:2`])
  await setSetting(a, 'passPriorityCast', true)

  // with the setting, casting hands priority straight to the opponent
  await clickCard(a, 'Grizzly Bears', 'hand')
  await payMana(a)
  let sb = await waitPrompt(b, 'GAME_SELECT')
  expect(sb.game.stack).toHaveLength(1)
  expect((await snap(a)).prompt!.method).toBe('GAME_UPDATE_AND_INFORM')
  await pass(b)
  await until(a, 'the first bears', (x) => me(x).battlefield.filter((c: any) => c.name === 'Grizzly Bears').length === 1 && x.prompt?.method === 'GAME_SELECT')

  // holding priority keeps it with me, to respond to my own spell
  const hold = a.page.locator('[data-tool="hold"]')
  await hold.click()
  await expect(hold).toHaveText('Holding priority')
  await clickCard(a, 'Grizzly Bears', 'hand')
  await payMana(a)
  const sa = await waitPrompt(a, 'GAME_SELECT')
  expect(sa.game.stack).toHaveLength(1)
  expect((await snap(b)).prompt!.method).toBe('GAME_UPDATE_AND_INFORM')
  await hold.click()
  await expect(hold).toHaveText('Hold priority')
  await finish(table)
})

test('pass priority after activating an ability', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [`battlefield:${a.name}:Prodigal Pyromancer:1`])
  await setSetting(a, 'passPriorityActivation', true)
  await clickCard(a, 'Prodigal Pyromancer', 'mine')
  const s = await settle(a)
  if (s.prompt!.method === 'GAME_TARGET') await clickVisible(a, a.page.locator(`.life-orb[data-oid="${opponent(s).id}"]`))
  const sb = await waitPrompt(b, 'GAME_SELECT')
  expect(sb.game.stack).toHaveLength(1)
  expect((await snap(a)).prompt!.method).toBe('GAME_UPDATE_AND_INFORM')
  await pass(b)
  await until(b, 'the ping', (x) => me(x).life === 39)
  await finish(table)
})

test('trigger order can be remembered and forgotten', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Forest: 6 }), `battlefield:${a.name}:Soul Warden:1`, `battlefield:${a.name}:Impact Tremors:1`, `hand:${a.name}:Grizzly Bears:3`])
  const asked = (x: any) => x.prompt?.method === 'GAME_TARGET' && x.prompt.data.options.queryType === 'PICK_ABILITY'
  const resolved = (n: number) => (x: any) => me(x).life === 40 + n && opponent(x).life === 40 - n && x.game.stack.length === 0 && x.prompt?.method === 'GAME_SELECT'

  await cast(a, 'Grizzly Bears')
  await passUntil(table, a, 'the order question', asked)
  const first = a.page.locator('.trigger-order .trigger').first()
  await first.locator('[data-trigger-menu]').click()
  await first.locator('.menu button', { hasText: 'Always put this ability first' }).click()
  await passUntil(table, a, 'both triggers', resolved(1))

  // the second creature: the order is known, nothing is asked
  await cast(a, 'Grizzly Bears')
  let s = await passUntil(table, a, 'both triggers again', (x) => resolved(2)(x) || asked(x))
  expect(asked(s)).toBe(false)

  // forgotten in the settings: the question is back
  await openSettings(a, 'Playing')
  await a.page.locator('[data-reset="triggers"]').click()
  await closeSettings(a)
  await cast(a, 'Grizzly Bears')
  s = await passUntil(table, a, 'the order question again', (x) => resolved(3)(x) || asked(x))
  expect(asked(s)).toBe(true)
  await a.page.locator('.trigger-order .trigger .card').first().click()
  await passUntil(table, a, 'the last triggers', resolved(3))
  await finish(table)
})

test('a yes/no question can be answered once and for all, and that can be reset', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Forest: 6 }), `battlefield:${a.name}:Suture Priest:1`, `hand:${a.name}:Grizzly Bears:3`])
  const asked = (x: any) => x.prompt?.method === 'GAME_ASK'
  const done = (life: number) => (x: any) => me(x).life === life && x.game.stack.length === 0 && x.prompt?.method === 'GAME_SELECT'

  await cast(a, 'Grizzly Bears')
  let s = await passUntil(table, a, 'the question', asked)
  expect(String(s.prompt!.data.message)).toMatch(/gain 1 life/i)
  await a.page.locator('[data-tool="always"]').click()
  await a.page.locator('.prompt-tools .menu button', { hasText: 'Always yes for this ability' }).click()
  await passUntil(table, a, 'the first life', done(41))

  await cast(a, 'Grizzly Bears')
  s = await passUntil(table, a, 'the second life without a question', (x) => done(42)(x) || asked(x))
  expect(asked(s)).toBe(false)

  await openSettings(a, 'Playing')
  await a.page.locator('[data-reset="answers"]').click()
  await closeSettings(a)
  await cast(a, 'Grizzly Bears')
  s = await passUntil(table, a, 'the question again', (x) => done(43)(x) || asked(x))
  expect(asked(s)).toBe(true)
  await a.page.locator('.prompt-buttons button', { hasText: 'No' }).click()
  s = await passUntil(table, a, 'no life this time', (x) => x.game.stack.length === 0 && x.prompt?.method === 'GAME_SELECT' && me(x).battlefield.filter((c: any) => c.name === 'Grizzly Bears').length === 3)
  expect(me(s).life).toBe(42)
  await finish(table)
})

test('pass-until modes: started with a key, shown to both players, and stopped', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  // F4: pass until next turn
  await a.page.keyboard.press('F4')
  let s = await passUntil(table, b, 'my turn', (x) => x.game.turn === 2 && x.prompt?.method === 'GAME_SELECT' && x.game.step === 'PRECOMBAT_MAIN')
  expect(s.game.activePlayerId).toBe(me(s).id)

  // F9 on the opponent's turn: everything until my own next turn.
  // XMage reports the mode with the next board update, i.e. as soon as anything happens.
  await a.page.keyboard.press('F9')
  await pass(b)
  await until(a, 'the passing mode', (x) => me(x).passedAllTurns)
  await expect(a.page.locator('[data-passing-chip]')).toContainText('until my next turn')
  await expect(a.page.locator('.player-panel.mine [data-passing]')).toBeVisible()
  // the opponent sees that I am passing
  await until(b, 'the passing mode on my screen', (x) => opponent(x).passedAllTurns)
  await expect(b.page.locator('.player-panel.theirs [data-passing]')).toContainText('until my next turn')

  await a.page.locator('[data-passing-chip]').click()
  await pass(b)
  await until(a, 'passing stopped', (x) => !me(x).passedAllTurns)
  await expect(a.page.locator('[data-passing-chip]')).toHaveCount(0)

  // every mode is in the menu with its key
  await a.page.getByRole('button', { name: /More/ }).click()
  for (const key of ['F3', 'F4', 'F5', 'F6', 'F7', 'F9', 'F10', 'F11']) {
    await expect(a.page.locator('.prompt-tools .menu kbd', { hasText: new RegExp(`^${key}$`) })).toHaveCount(1)
  }
  await a.page.keyboard.press('Escape')
  await finish(table)
})

test('F2 confirms the current request and the phase bar opens the stop settings', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  const s = await waitPrompt(a, 'GAME_SELECT')
  await a.page.keyboard.press('F2')
  await until(a, 'the pass', (x) => x.prompt?.messageId !== s.prompt!.messageId)

  await a.page.locator('.phase-track .steps').click()
  await expect(a.page.locator('.tabs button.on')).toHaveText('Stops')
  await expect(a.page.locator('table.stops tbody tr')).toHaveCount(7)
  await closeSettings(a)
  await finish(table)
})

test('macro recording can be switched on and off', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  const s = await waitPrompt(a, 'GAME_SELECT')
  await a.page.getByRole('button', { name: /More/ }).click()
  await a.page.getByRole('button', { name: /Record or stop a macro/ }).click()
  await a.page.keyboard.press('F8')
  // the game carries on as before
  await cheat(a, [`hand:${a.name}:Forest:1`])
  await clickCard(a, 'Forest', 'hand')
  await until(a, 'the land', (x) => findPermanent(x, 'Forest'))
  expect(s.game.turn).toBe(1)
  await finish(table)
})
