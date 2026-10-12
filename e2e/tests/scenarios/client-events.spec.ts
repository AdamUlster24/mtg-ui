import { expect, test } from '@playwright/test'
import { finish, snap, startGame, until } from '../../helpers'

// Messages XMage sends only in rare situations (an exception in the game, an admin broadcast, a prompt
// type current XMage no longer uses). They can't be provoked from a normal game, so they are fed to the
// client directly; what is tested is that the client shows them and answers correctly.

const inject = (page: import('@playwright/test').Page, event: Record<string, unknown>) =>
  page.evaluate((e) => (window as any).mtgui.inject({ type: 'event', objectId: null, messageId: 9000, data: null, ...e }), event)

test('server messages, game errors and personal notes are shown', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  const gameId = await a.page.evaluate(() => (window as any).mtgui.store.getState().gameInfo.gameId)

  await inject(a.page, { method: 'GAME_ERROR', objectId: gameId, data: { message: 'Game error: something broke on the server' } })
  await expect(a.page.locator('.notice', { hasText: 'something broke on the server' })).toBeVisible()
  await inject(a.page, { method: 'SERVER_MESSAGE', data: { message: 'The server restarts in 5 minutes', username: null, time: null, turnInfo: null, messageType: 'STATUS' } })
  await expect(a.page.locator('.notice', { hasText: 'The server restarts in 5 minutes' })).toBeVisible()
  await inject(a.page, { method: 'GAME_INFORM_PERSONAL', objectId: gameId, data: { message: 'Only you can see this' } })
  await expect(a.page.locator('.notice', { hasText: 'Only you can see this' })).toBeVisible()
  await inject(a.page, { method: 'SHOW_USERMESSAGE', data: { title: 'Table', message: 'A message <b>with markup</b>' } })
  await expect(a.page.locator('.notice', { hasText: 'A message with markup' })).toBeVisible()
  // a notice goes away when clicked
  const notices = await a.page.locator('.notice').count()
  await a.page.locator('.notice').first().click()
  await expect(a.page.locator('.notice')).toHaveCount(notices - 1)
  // events for drafts, tournaments and replays are ignored without harm
  for (const method of ['START_DRAFT', 'DRAFT_PICK', 'TOURNAMENT_INIT', 'REPLAY_GAME', 'WATCHGAME', 'GAME_REDRAW_GUI', 'JOINED_TABLE']) {
    await inject(a.page, { method })
  }
  await expect(a.page.locator('.game')).toBeVisible()
  await finish(table)
})

test('the "pay X mana" prompt is answered with OK or Cancel', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  const s = await snap(a)
  const gameId = await a.page.evaluate(() => (window as any).mtgui.store.getState().gameInfo.gameId)
  const sent: any[] = []
  a.page.on('websocket', () => {})
  await a.page.evaluate(() => {
    const store = (window as any).mtgui.store
    ;(window as any).sent = []
    const original = store.getState().respond
    store.setState({ respond: (kind: string, value: unknown) => ((window as any).sent.push([kind, value]), original(kind, value)) })
  })
  await inject(a.page, { method: 'GAME_PLAY_XMANA', objectId: gameId, messageId: 9001, data: { game: s.game, message: 'Pay {X}: 2 so far', options: {} } })
  await expect(a.page.locator('.prompt-message')).toContainText('Pay')
  await expect(a.page.locator('.prompt-buttons button')).toHaveText(['OK', 'Cancel'])
  await a.page.locator('.prompt-buttons button', { hasText: 'Cancel' }).click()
  sent.push(...(await a.page.evaluate(() => (window as any).sent)))
  expect(sent).toContainEqual(['boolean', false])
  // the real game is still there: the server answers the stray reply with its current prompt
  await until(a, 'the real prompt again', (x) => x.prompt?.method === 'GAME_SELECT' && x.prompt.messageId !== 9001)
  await finish(table)
})

test('a lost connection to the game server sends the player back to the door', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await inject(a.page, { method: 'DISCONNECTED' })
  await expect(a.page.locator('.gate')).toBeVisible()
  await expect(a.page.locator('.notice', { hasText: 'closed the connection' })).toBeVisible()
  for (const seat of table.seats) await seat.context.close()
})
