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
  press,
  setSetting,
  setStops,
  settle,
  snap,
  startGame,
  stopsSeen,
  until,
  waitPrompt,
} from '../../helpers'

const STEP_OF: Record<string, string> = {
  upkeep: 'UPKEEP',
  draw: 'DRAW',
  main1: 'PRECOMBAT_MAIN',
  beforeCombat: 'BEGIN_COMBAT',
  endOfCombat: 'END_COMBAT',
  main2: 'POSTCOMBAT_MAIN',
  endOfTurn: 'END_TURN',
}
const all = (turn: 'yourTurn' | 'opponentTurn', value: boolean) => Object.fromEntries(Object.keys(STEP_OF).map((step) => [`${turn}.${step}`, value]))

test('stop steps: every step can be switched on and off for my turn and for the opponent\'s', async ({ browser }) => {
  test.setTimeout(240_000)
  const table = await startGame(browser)
  const { a, b } = table
  // an attacker on each side, so that combat has all its steps
  await cheat(a, [`battlefield:${a.name}:Grizzly Bears:1`, `battlefield:${b.name}:Grizzly Bears:1`])

  // everything on: I am asked in every step of the opponent's turn 2 and of my turn 3
  await setStops(a, { ...all('yourTurn', true), ...all('opponentTurn', true) })
  let seen = await stopsSeen(table, a, 4)
  for (const [name, step] of Object.entries(STEP_OF)) {
    expect(seen[2] ?? [], `opponentTurn.${name} on`).toContain(step)
    expect(seen[3] ?? [], `yourTurn.${name} on`).toContain(step)
  }

  // everything off: turns 4 and 5 go by without a single stop for me (declaring attackers aside)
  await until(a, 'a prompt in turn 4', (x) => x.prompt?.method === 'GAME_SELECT' || x.game.turn > 4, 20_000).catch(() => {})
  await setStops(a, { ...all('yourTurn', false), ...all('opponentTurn', false) })
  seen = await stopsSeen(table, a, 8)
  for (const [name, step] of Object.entries(STEP_OF)) {
    expect(seen[6] ?? [], `opponentTurn.${name} off`).not.toContain(step)
    expect(seen[7] ?? [], `yourTurn.${name} off`).not.toContain(step)
  }
  await finish(table)
})

test('stop to declare attackers while passing, or not', async ({ browser }) => {
  test.setTimeout(180_000)
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [`battlefield:${a.name}:Grizzly Bears:1`])

  // default: F4 (pass until next turn) still stops when I could attack
  await a.page.keyboard.press('F4')
  await until(a, 'the pass mode to start', (x) => x.game.step !== 'PRECOMBAT_MAIN' || /attackers/i.test(String(x.prompt?.data.message)))
  let seen = await stopsSeen(table, a, 2)
  expect(seen[1]).toContain('DECLARE_ATTACKERS')

  await stopsSeen(table, a, 3)
  await waitPrompt(a, 'GAME_SELECT')
  await setSetting(a, 'stopOnDeclareAttackers', false, 'Stops')
  await a.page.keyboard.press('F4')
  seen = await stopsSeen(table, a, 4)
  expect(seen[3] ?? []).not.toContain('DECLARE_ATTACKERS')
  await finish(table)
})

test('while passing: stop when attacked, with possible blockers and even without any', async ({ browser }) => {
  test.setTimeout(300_000)
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [`battlefield:${b.name}:Grizzly Bears:1`])
  // I pass "until my next turn" every time; the opponent attacks on each of their turns
  const myTurn = async (turn: number) => {
    await until(a, `my turn ${turn}`, (x) => x.game.turn === turn && x.prompt?.method === 'GAME_SELECT' && x.game.step === 'PRECOMBAT_MAIN', 30_000)
  }
  const attackedIn = async (turn: number) => {
    await a.page.keyboard.press('F9')
    const seen = await stopsSeen(table, a, turn + 1, 90_000, b)
    await myTurn(turn + 1)
    return seen[turn] ?? []
  }

  // default, no creatures of my own: the attack goes by without a stop
  expect(await attackedIn(2)).toEqual([])

  // "even when I have none": I get to act when the attack is declared
  await setSetting(a, 'stopOnDeclareBlockersWithZeroPermanents', true, 'Stops')
  expect(await attackedIn(4)).toContain('DECLARE_ATTACKERS')

  // with a possible blocker and the default: asked to block although I am passing
  await setSetting(a, 'stopOnDeclareBlockersWithZeroPermanents', false, 'Stops')
  await cheat(a, [`battlefield:${a.name}:Craw Wurm:1`])
  expect(await attackedIn(6)).toContain('DECLARE_BLOCKERS')

  // switched off: no question, the attack goes through
  await setSetting(a, 'stopOnDeclareBlockersWithAnyPermanents', false, 'Stops')
  const last = await attackedIn(8)
  expect(last).not.toContain('DECLARE_BLOCKERS')
  expect(last).not.toContain('DECLARE_ATTACKERS')
  await finish(table)
})

test('ask before passing with mana in the pool', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Forest: 2 })])
  const float = async () => {
    const s = await snap(a)
    await a.page.locator(`[data-oid="${me(s).battlefield.findLast((c: any) => !c.tapped).id}"]`).first().click()
    await until(a, 'mana in the pool', (x) => me(x).manaPool.G > 0)
  }
  // default: passing with floating mana asks first
  await float()
  await a.page.locator('.prompt-buttons .primary').click()
  let s = await until(a, 'the question', (x) => (x.prompt?.method === 'GAME_ASK' ? x : false))
  expect(String(s.prompt!.data.message)).toMatch(/mana/i)
  await a.page.locator('.prompt-buttons button', { hasText: 'No' }).click()
  await waitPrompt(a, 'GAME_SELECT')

  await setSetting(a, 'confirmEmptyManaPool', false)
  s = await snap(a)
  const step = s.game.step
  await a.page.locator('.prompt-buttons .primary').click()
  s = await until(a, 'the pass without a question', (x) => (x.game.step !== step || x.prompt?.method !== 'GAME_SELECT' ? x : false))
  expect(s.prompt?.method).not.toBe('GAME_ASK')
  await finish(table)
})

test('automatic targeting level', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Swamp: 2 }), `hand:${a.name}:Raise Dead:2`, `graveyard:${a.name}:Grizzly Bears:1`])
  // default (level 1): the only legal target is taken without asking
  let s = await clickCard(a, 'Raise Dead', 'hand')
  expect(s.prompt!.method).toBe('GAME_PLAY_MANA')
  await press(a, 'Cancel')
  await waitPrompt(a, 'GAME_SELECT')

  await openSettings(a, 'Playing')
  await a.page.locator('[data-setting="autoTargetLevel"]').selectOption('0')
  await a.page.waitForFunction(() => (window as any).mtgui.store.getState().settings.autoTargetLevel === 0)
  await closeSettings(a)
  s = await clickCard(a, 'Raise Dead', 'hand')
  expect(s.prompt!.method).toBe('GAME_TARGET')
  await expect(a.page.locator('.modal .card-grid .card')).toHaveCount(1)
  await finish(table)
})

test('tapping a land with several mana abilities: asks, or uses the first', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [`battlefield:${a.name}:Karplusan Forest:2`])
  let s = await snap(a)
  const [first, second] = me(s).battlefield.filter((c: any) => c.name === 'Karplusan Forest')
  // default: a land with several mana abilities asks which one
  // (the two lands are piled up: click where each one shows)
  await clickVisible(a, a.page.locator(`[data-oid="${first.id}"]`).first())
  await waitPrompt(a, 'GAME_CHOOSE_ABILITY')
  await a.page.locator('.modal .option-list button').first().click()
  await until(a, 'colorless mana', (x) => me(x).manaPool.C === 1)

  await setSetting(a, 'useFirstManaAbility', true)
  await clickVisible(a, a.page.locator(`[data-oid="${second.id}"]`).first())
  s = await until(a, 'more colorless mana, without a question', (x) => (me(x).manaPool.C === 2 || x.prompt?.method === 'GAME_CHOOSE_ABILITY' ? x : false))
  expect(s.prompt!.method).toBe('GAME_SELECT')
  await finish(table)
})

test('graveyard order: asked when several cards go there at once, if wanted', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Island: 2 }), `hand:${a.name}:Thought Scour:2`])
  const milled = (n: number) => (x: any) => me(x).graveyard.filter((c: any) => c.name === 'Wastes').length === n && x.game.stack.length === 0 && x.prompt?.method === 'GAME_SELECT'
  const castOnMe = async () => {
    await clickCard(a, 'Thought Scour', 'hand')
    const s = await settle(a)
    if (s.prompt!.method === 'GAME_TARGET') await clickVisible(a, a.page.locator(`.life-orb[data-oid="${me(s).id}"]`))
    await payMana(a)
  }

  // default: two cards are milled, no question
  await castOnMe()
  const asked = (x: any) => x.prompt?.method === 'GAME_ASK' && /order/i.test(String(x.prompt.data.message))
  let s = await passUntil(table, a, 'the first mill', (x) => milled(2)(x) || asked(x))
  expect(asked(s)).toBe(false)

  // with the setting: which card goes on top
  await setSetting(a, 'askMoveToGraveOrder', true)
  await castOnMe()
  s = await passUntil(table, a, 'the order question', (x) => milled(4)(x) || asked(x))
  expect(asked(s)).toBe(true)
  expect(String(s.prompt!.data.message)).toMatch(/order in which the cards go to the graveyard/i)
  await finish(table)
})

test('settings are kept in the browser, reach the server and can be reset', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await setSetting(a, 'autoOrderTrigger', false)
  await setSetting(a, 'manaPoolAutomaticRestricted', false)
  await setSetting(a, 'useSameSettingsForReplacementEffects', false)
  const saved = await a.page.evaluate(() => JSON.parse(localStorage.getItem('mtgui.settings')!))
  expect(saved).toMatchObject({ autoOrderTrigger: false, manaPoolAutomaticRestricted: false, useSameSettingsForReplacementEffects: false })

  // after a reload the gateway still knows them, and so does the page
  await a.page.reload()
  await expect(a.page.locator('.game')).toBeVisible()
  const state = await a.page.evaluate(() => (window as any).mtgui.store.getState().settings)
  expect(state).toMatchObject({ autoOrderTrigger: false, manaPoolAutomaticRestricted: false, useSameSettingsForReplacementEffects: false })
  // values XMage needs but this client does not edit travel along unchanged
  expect(typeof state.flagName).toBe('string')
  expect(state.avatarId).toBe(0)

  await openSettings(a, 'Playing')
  await expect(a.page.locator('[data-setting="autoOrderTrigger"]')).not.toBeChecked()
  await a.page.locator('[data-reset="defaults"]').click()
  await expect(a.page.locator('[data-setting="autoOrderTrigger"]')).toBeChecked()
  await a.page.waitForFunction(() => (window as any).mtgui.store.getState().settings.autoOrderTrigger === true)
  await closeSettings(a)
  await finish(table)
})

test('this screen: card size, animations and the log', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Forest: 3 }), `hand:${a.name}:Grizzly Bears:1`])
  const height = () => a.page.locator('.battlefield.mine .card').first().evaluate((el) => el.getBoundingClientRect().height)
  const full = await height()

  await openSettings(a, 'This screen')
  // a slider: set its value the way dragging does
  await a.page.locator('[data-pref="cardScale"]').evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '0.6')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await a.page.locator('[data-pref="animations"]').selectOption('off')
  await a.page.locator('[data-setting="showLog"]').setChecked(false)
  await closeSettings(a)
  await expect.poll(height).toBeLessThan(full * 0.7)
  await expect(a.page.locator('.log-panel')).toHaveCount(0)
  await expect(a.page.locator('body')).toHaveAttribute('data-animations', 'off')

  // with animations off a card is simply there: nothing is in motion after casting
  await clickCard(a, 'Grizzly Bears', 'hand')
  await payMana(a)
  const running = await a.page.evaluate(() => document.getAnimations().filter((x) => x.playState === 'running').length)
  expect(running).toBe(0)

  // kept across a reload
  await a.page.reload()
  await expect(a.page.locator('.game')).toBeVisible()
  await expect(a.page.locator('body')).toHaveAttribute('data-animations', 'off')
  await expect(a.page.locator('.log-panel')).toHaveCount(0)
  await a.page.locator('.side-toggle').click()
  await expect(a.page.locator('.log-panel')).toBeVisible()
  expect(findPermanent(await snap(a), 'Forest')).toBeTruthy()
  await finish(table)
})
