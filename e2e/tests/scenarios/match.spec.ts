import { expect, test } from '@playwright/test'
import {
  cheat,
  choose,
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
  preGame,
  press,
  setSetting,
  settle,
  snap,
  startGame,
  until,
  waitPrompt,
  type Table,
} from '../../helpers'

/** Player A wins the running game on the spot: seven 6/4 attackers */
async function winNow(table: Table, expectResult = true) {
  const { a, b } = table
  await cheat(a, [`battlefield:${a.name}:Craw Wurm:7`])
  await passUntil(table, a, 'the attack declaration', (x) => x.prompt?.method === 'GAME_SELECT' && /attackers/i.test(x.prompt.data.message))
  await press(a, 'All attack')
  await press(a, 'Attack')
  const deadline = Date.now() + 30_000
  const over = async () => {
    const s = await snap(b)
    return !!s.gameEnd || s.screen !== 'game' || (s.game && s.game.turn === 1 && s.game.players.every((p: any) => p.battlefield.length === 0))
  }
  while (Date.now() < deadline && !(await over())) {
    for (const seat of table.seats) {
      const s = await snap(seat)
      if (s.prompt?.method === 'GAME_SELECT' && !s.answering && !s.gameEnd) {
        await seat.page.locator('.prompt-buttons .primary').click({ timeout: 2000 }).catch(() => {})
        await until(seat, 'the next prompt', (x) => x.prompt?.messageId !== s.prompt!.messageId || !!x.gameEnd, 5000).catch(() => {})
      }
    }
  }
  // when the match goes on, the next game or sideboarding takes over the screen right away
  if (!expectResult) return
  await expect(a.page.locator('.modal h3')).toHaveText('Victory')
  await expect(b.page.locator('.modal h3')).toHaveText('Defeat')
}

const DUEL_DECK = ['Deck', '24 Forest', '36 Grizzly Bears', '', 'Sideboard', '3 Giant Growth'].join('\n')

test('best of three in Commander: the next game follows directly, the match ends at two wins', async ({ browser }) => {
  test.setTimeout(240_000)
  const table = await startGame(browser, { tableOptions: { bestOf: 3 } })
  const { a } = table
  let s = await snap(a)
  expect(me(s).winsNeeded).toBe(2)
  await expect(a.page.locator('.player-panel.mine .match-score')).toContainText('0/2 wins')

  // XMage has no sideboarding in Commander: game two starts right after the first
  await winNow(table, false)
  s = await until(a, 'game two', (x) => (x.game && x.game.turn === 1 && me(x).wins === 1 && !x.gameEnd ? x : false), 40_000)
  await preGame(table)
  await expect(a.page.locator('.player-panel.mine .match-score')).toContainText('1/2 wins')
  await winNow(table)
  await expect(a.page.locator('[data-match-score]')).toContainText('first to 2')
  for (const seat of table.seats) {
    await seat.page.getByRole('button', { name: 'Back to lobby' }).click()
    await expect(seat.page.locator('.lobby')).toBeVisible()
  }
  // no third game
  await a.page.waitForTimeout(3000)
  await expect(a.page.locator('.lobby')).toBeVisible()
  await finish(table)
})

test('best of three in a regular duel: sideboarding between the games', async ({ browser }) => {
  test.setTimeout(240_000)
  const table = await startGame(browser, { deckA: DUEL_DECK, deckB: DUEL_DECK, tableOptions: { bestOf: 3, deckType: 'Constructed - Freeform' } })
  const { a, b } = table
  let s = await snap(a)
  expect(me(s).life).toBe(20)
  expect(me(s).sideboard.map((c: any) => c.name)).toEqual(['Giant Growth', 'Giant Growth', 'Giant Growth'])

  await winNow(table, false)
  // both players get their deck to rearrange, with the result of the game they just played
  for (const seat of table.seats) {
    await expect(seat.page.locator('.sideboard-screen')).toBeVisible({ timeout: 30_000 })
    await expect(seat.page.locator('[data-last-result]')).toContainText(seat === a ? 'You won' : 'You lost')
    await expect(seat.page.locator('[data-zone="main"] h2')).toContainText('60')
    await expect(seat.page.locator('[data-zone="sideboard"] .card')).toHaveCount(3)
  }
  // a card moves out, another comes in
  await a.page.locator('[data-zone="main"] .sb-cards .card[data-name="Grizzly Bears"]').first().click()
  await expect(a.page.locator('[data-zone="main"] h2')).toContainText('59')
  await expect(a.page.locator('[data-zone="sideboard"] .card')).toHaveCount(4)
  await a.page.locator('[data-zone="sideboard"] .sb-cards .card[data-name="Giant Growth"]').first().click()
  await expect(a.page.locator('[data-zone="main"] h2')).toContainText('60')
  // a reload in the middle of sideboarding comes back to it
  await b.page.reload()
  await expect(b.page.locator('.sideboard-screen')).toBeVisible()
  await expect(b.page.locator('[data-zone="main"] h2')).toContainText('60')

  await a.page.getByRole('button', { name: 'Submit deck' }).click()
  await expect(a.page.getByRole('button', { name: /Waiting for the opponent/ })).toBeVisible()
  await b.page.getByRole('button', { name: 'Submit deck' }).click()

  // game two is played with the changed deck
  for (const seat of table.seats) {
    await expect(seat.page.locator('.game')).toBeVisible({ timeout: 40_000 })
  }
  await preGame(table)
  s = await snap(a)
  expect(me(s).wins).toBe(1)
  expect(me(s).sideboard.map((c: any) => c.name).sort()).toEqual(['Giant Growth', 'Giant Growth', 'Grizzly Bears'])
  await winNow(table)
  await finish(table)
})

test('table options: starting life, free mulligans and no rollbacks', async ({ browser }) => {
  const table = await startGame(browser, { tableOptions: { startLife: 25, freeMulligans: 1, mulliganType: 'LONDON', rollbackTurnsAllowed: false } })
  const { a } = table
  const s = await snap(a)
  expect(s.game.players.map((p: any) => p.life)).toEqual([25, 25])
  await expect(a.page.locator('.player-panel.mine .life')).toHaveText('25')
  expect(logText(s)).toMatch(/Mulligan type: London/)
  expect(logText(s)).toMatch(/Free mulligans: 1/)
  expect(s.game.rollbackTurnsAllowed).toBe(false)
  await finish(table)
})

test('conceding the match ends it for both players', async ({ browser }) => {
  const table = await startGame(browser, { tableOptions: { bestOf: 3 } })
  const { a, b } = table
  a.page.on('dialog', (d) => d.accept())
  await a.page.getByRole('button', { name: /More/ }).click()
  await a.page.getByRole('button', { name: 'Concede the match' }).click()
  await expect(b.page.locator('.modal h3')).toHaveText('Victory', { timeout: 20_000 })
  await expect(a.page.locator('.modal h3')).toHaveText('Defeat')
  // the match is over: no sideboarding follows
  await b.page.waitForTimeout(3000)
  await expect(b.page.locator('.sideboard-screen')).toHaveCount(0)
  await finish(table)
})

test('rolling back to the previous turn when the opponent agrees', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [`hand:${a.name}:Forest:1`])
  // get to turn 2, then ask to go back to the start of turn 1
  await passUntil(table, b, 'turn 2', (x) => x.game.turn === 2 && x.prompt?.method === 'GAME_SELECT' && x.game.step === 'PRECOMBAT_MAIN')
  await b.page.getByRole('button', { name: /More/ }).click()
  await b.page.getByRole('button', { name: 'Roll back to the start of the previous turn' }).click()
  await expect(a.page.locator('.modal', { hasText: /roll ?back/i })).toBeVisible()
  await a.page.locator('.modal footer button').first().click()
  const s = await until(a, 'turn 1 again', (x) => (x.game.turn === 1 ? x : false), 20_000)
  expect(logText(s)).toMatch(/roll/i)
  await finish(table)
})

test('asking to see the opponent\'s hand: refused by default, shown when they allow it', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  const ask = async () => {
    await a.page.getByRole('button', { name: /More/ }).click()
    await a.page.getByRole('button', { name: `Ask to see ${b.name}'s hand` }).click()
  }
  // the default: the other player does not take such requests
  await ask()
  await expect(a.page.locator('.notice').first()).toBeVisible()
  await expect(b.page.locator('.modal')).toHaveCount(0)
  await a.page.locator('.notice').first().click()

  await setSetting(b, 'allowRequestShowHandCards', true)
  await ask()
  await expect(b.page.locator('.modal', { hasText: /hand/i })).toBeVisible()
  await b.page.locator('.modal footer button').first().click()
  // from now on the hand is one of my lists
  await pass(a)
  const s = await passUntil(table, a, 'the shared hand', (x) => x.game.revealed.length + x.game.opponentHands.length + x.game.watchedHands.length + x.game.lookedAt.length > 0, 20_000)
  expect(s.game.turn).toBeGreaterThan(0)
  await expect(a.page.locator('.tray-list .tray-cards .card').first()).toBeVisible()
  await finish(table)
})

test('the special button: paying with convoke (Siege Wurm)', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Forest: 3 }), `battlefield:${a.name}:Grizzly Bears:4`, `hand:${a.name}:Siege Wurm:1`])
  let s = await clickCard(a, 'Siege Wurm', 'hand')
  s = await settle(a)
  expect(s.prompt!.method).toBe('GAME_PLAY_MANA')
  expect(s.game.special).toBe(true)
  // lands first: XMage takes no more mana abilities once a special payment has been made
  for (let i = 0; i < 3; i++) {
    s = await snap(a)
    await clickId(a, me(s).battlefield.findLast((c: any) => c.name === 'Forest' && !c.tapped).id)
  }
  s = await waitPrompt(a, 'GAME_PLAY_MANA')
  expect(String(s.prompt!.data.message)).toMatch(/^Pay \{4\}/)
  // the rest is paid behind the Special button: convoke taps creatures instead
  for (let i = 0; i < 4; i++) {
    await press(a, 'Special')
    await waitPrompt(a, 'GAME_CHOOSE_ABILITY')
    await choose(a, /Convoke/)
    s = await settle(a)
    if (s.prompt!.method === 'GAME_TARGET') {
      const bear = me(s).battlefield.find((c: any) => c.name === 'Grizzly Bears' && !c.tapped)
      await clickId(a, bear.id)
    }
  }
  s = await passUntil(table, a, 'the wurm', (x) => findPermanent(x, 'Siege Wurm'))
  expect(me(s).battlefield.filter((c: any) => c.name === 'Grizzly Bears' && c.tapped)).toHaveLength(4)
  expect(opponent(s).life).toBe(40)
  await finish(table)
})
