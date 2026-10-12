import { expect, test } from '@playwright/test'
import {
  cast,
  cheat,
  clickCard,
  clickVisible,
  finish,
  findPermanent,
  hover,
  lands,
  me,
  opponent,
  passUntil,
  payMana,
  resolveUntil,
  settle,
  snap,
  startGame,
  until,
  waitPrompt,
} from '../../helpers'

test('revealed hand: an effect that reveals the opponent\'s hand opens it (Telepathy)', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Island: 1 }), `hand:${a.name}:Telepathy:1`, `hand:${b.name}:Grizzly Bears:1`])
  await cast(a, 'Telepathy')
  const s = await passUntil(table, a, 'the revealed hand', (x) => x.game.revealed.length === 1 && x.game.stack.length === 0)
  expect(s.game.revealed[0].cards.map((c: any) => c.name)).toContain('Grizzly Bears')
  // it opens by itself, shows the cards, and can be folded away and reopened
  const list = a.page.locator('.tray-list[data-tray="revealed"]')
  await expect(list).toHaveClass(/open/)
  await expect(list.locator('.tray-cards .card[data-name="Grizzly Bears"]')).toBeVisible()
  await expect(list.locator('.tray-cards .card')).toHaveCount(8)
  const preview = await hover(a, list.locator('.tray-cards .card[data-name="Grizzly Bears"]'))
  await expect(preview).toContainText('Grizzly Bears')
  await list.locator('.tray-head').click()
  await expect(list.locator('.tray-cards')).toHaveCount(0)
  await list.locator('.tray-head').click()
  await expect(list.locator('.tray-cards .card')).toHaveCount(8)
  // the player whose hand it is does not get a window for their own hand
  await expect(b.page.locator('.tray-list[data-tray="revealed"]')).toHaveCount(1)
  await finish(table)
})

test('looking at cards: Peek shows the opponent\'s hand only to me', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Island: 1 }), `hand:${a.name}:Peek:1`, `hand:${b.name}:Craw Wurm:1`])
  await clickCard(a, 'Peek', 'hand')
  let s = await settle(a)
  if (s.prompt!.method === 'GAME_TARGET') await clickVisible(a, a.page.locator(`.life-orb[data-oid="${opponent(s).id}"]`))
  await payMana(a)
  await passUntil(table, a, 'Peek to resolve', (x) => me(x).graveyard.some((c: any) => c.name === 'Peek') && x.game.stack.length === 0)
  // XMage reports the looked-at cards only for a moment; the list stays until I close it
  const list = a.page.locator('.tray-list[data-tray="lookedAt"]')
  await expect(list.locator('.tray-cards .card[data-name="Craw Wurm"]')).toBeVisible()
  await expect(list.locator('.tray-cards .card')).toHaveCount(8)
  await expect(b.page.locator('.tray-list')).toHaveCount(0)
  await list.locator('.tray-close').click()
  await expect(a.page.locator('.tray-list[data-tray="lookedAt"]')).toHaveCount(0)
  await finish(table)
})

test('exile piles made by a card are listed and can be opened (Journey to Nowhere)', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Plains: 2 }), `hand:${a.name}:Journey to Nowhere:1`, `battlefield:${b.name}:Grizzly Bears:1`])
  await cast(a, 'Journey to Nowhere')
  const s = await resolveUntil(table, a, 'the exile', (x) => !findPermanent(x, 'Grizzly Bears') && x.game.stack.length === 0 && x.prompt?.method === 'GAME_SELECT')
  const pile = s.game.exiles.find((l: any) => l.cards.some((c: any) => c.name === 'Grizzly Bears'))
  expect(pile).toBeTruthy()
  const list = a.page.locator('.tray-list[data-tray="exiled"]')
  // exile piles stay folded until asked for
  await expect(list.locator('.tray-cards')).toHaveCount(0)
  await list.locator('.tray-head').click()
  await expect(list.locator('.tray-cards .card[data-name="Grizzly Bears"]')).toBeVisible()
  await finish(table)
})

test('controlling the opponent\'s turn shows their hand (Mindslaver)', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Island: 4 }), `battlefield:${a.name}:Mindslaver:1`, `hand:${b.name}:Grizzly Bears:1`])
  await clickCard(a, 'Mindslaver', 'mine')
  let s = await settle(a)
  if (s.prompt!.method === 'GAME_TARGET') await clickVisible(a, a.page.locator(`.life-orb[data-oid="${opponent(s).id}"]`))
  await payMana(a)
  await passUntil(table, a, 'Mindslaver to resolve', (x) => !findPermanent(x, 'Mindslaver') && x.game.stack.length === 0)
  // on the opponent's turn their hand is mine to see (and to play from)
  s = await passUntil(table, a, 'the controlled turn', (x) => x.game.turn === 2 && x.game.opponentHands.length === 1, 40_000)
  expect(s.game.opponentHands[0].name).toBe(b.name)
  const list = a.page.locator('.tray-list[data-tray="hand"]')
  await expect(list).toHaveClass(/open/)
  await expect(list.locator('.tray-cards .card')).toHaveCount(s.game.opponentHands[0].cards.length)
  await finish(table)
})

test('my sideboard can be looked at during the game', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  // in Commander the commander is the sideboard until it is in play; here it is in the command zone
  await a.page.getByRole('button', { name: /More/ }).click()
  await a.page.getByRole('button', { name: 'Look at my sideboard' }).click()
  await expect(a.page.locator('.modal h3')).toContainText(`${a.name}'s sideboard`)
  await a.page.locator('.modal header button').click()
  await expect(a.page.locator('.modal')).toHaveCount(0)
  await finish(table)
})

test('hints: what XMage notes about cards is collected in one panel', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Plains: 3 }), `hand:${a.name}:Brutal Cathar:1`])
  await cast(a, 'Brutal Cathar')
  const s = await passUntil(table, a, 'the cathar', (x) => findPermanent(x, 'Brutal Cathar') && x.game.stack.length === 0)
  expect(findPermanent(s, 'Brutal Cathar').hints.join(' ')).toMatch(/It's currently day/)
  // the rules text itself does not carry the hint, the preview shows it separately
  expect(findPermanent(s, 'Brutal Cathar').rules.join(' ')).not.toMatch(/It's currently day/)
  const preview = await hover(a, a.page.locator('.battlefield.mine .card[data-name="Brutal Cathar"]'))
  await expect(preview.locator('[data-preview-hints]').first()).toContainText("It's currently day")

  await a.page.mouse.move(4, 4)
  await a.page.getByRole('button', { name: /More/ }).click()
  await a.page.getByRole('button', { name: 'Hints…' }).click()
  const panel = a.page.locator('[data-hints]')
  await expect(panel.locator('[data-hint-card="Brutal Cathar"]')).toContainText("It's currently day")
  await panel.locator('input').fill('nothing matches this')
  await expect(panel.locator('[data-hint-card]')).toHaveCount(0)
  await panel.locator('header button').click()
  await expect(a.page.locator('.log-panel')).toBeVisible()
  await finish(table)
})

test('a chess clock runs for the player who has to act', async ({ browser }) => {
  const table = await startGame(browser, { tableOptions: { timeLimit: 'MIN___5' } })
  const { a, b } = table
  const s = await snap(a)
  expect(s.game.priorityTime).toBe(300)
  const mine = a.page.locator('.player-panel.mine .clock')
  await expect(mine).toHaveClass(/running/)
  await expect(a.page.locator('.player-panel.theirs .clock')).not.toHaveClass(/running/)
  const read = async () => {
    const [m, sec] = ((await mine.textContent()) ?? '0:0').split(':').map(Number)
    return m * 60 + sec
  }
  const first = await read()
  expect(first).toBeLessThanOrEqual(300)
  await a.page.waitForTimeout(2500)
  expect(await read()).toBeLessThan(first)
  // the opponent sees the same clock on my side
  await expect(b.page.locator('.player-panel.theirs .clock')).toHaveClass(/running/)
  await finish(table)
})
