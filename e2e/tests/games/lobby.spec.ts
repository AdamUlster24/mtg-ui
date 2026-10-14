import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { enterDeck, finish, openSeat, startGame, uniqueName } from '../../helpers'
import { PLAY_SERVER, ROOT } from '../../servers'

const deck = (name: string) => readFileSync(path.join(ROOT, 'e2e', 'decks', `${name}.txt`), 'utf8')
const goblins = deck('goblins')

test('the lobby explains what is wrong with a deck', async ({ browser }) => {
  const seat = await openSeat(browser, PLAY_SERVER, uniqueName('eve'))
  const { page } = seat
  const create = page.getByRole('button', { name: 'Create table' })

  // names XMage doesn't know are listed while typing, and the table can't be created
  await page.locator('.lobby textarea').fill('Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Lightning Bolt\n1 Definitely Not A Card\n30 Mountain')
  await expect(page.locator('.deck-status.bad')).toContainText('Unknown card: Definitely Not A Card')
  await expect(create).toBeDisabled()

  // a deck that parses but breaks the format rules is refused by the server, with its reason
  await page.locator('.lobby textarea').fill(goblins.replace('37 Mountain', '20 Mountain'))
  await expect(page.locator('.deck-status.good')).toContainText('82 cards')
  await create.click()
  await expect(page.locator('.notice', { hasText: 'Must contain 100 cards' })).toBeVisible()
  await expect(page.locator('.seats')).toHaveCount(0)

  // the legal list goes through
  await page.locator('.lobby textarea').fill(goblins)
  await expect(page.locator('.deck-status.good')).toContainText('99 cards · Commander: Krenko, Mob Boss')
  await create.click()
  await expect(page.locator('.seat.taken')).toHaveCount(1)
  await page.getByRole('button', { name: 'Leave table' }).click()
  await expect(create).toBeVisible()
  expect(seat.problems).toEqual([])
  await seat.context.close()
})

test('a list with reskinned card names and the commander set apart on the last line is understood', async ({ browser }) => {
  const seat = await openSeat(browser, PLAY_SERVER, uniqueName('eve'))
  const { page } = seat
  // an MTGO-style export: no headings, the commander after a blank line; four cards go by their Avatar names
  const list = ["1 Aang's Shelter", '1 Joo Dee, Public Servant', '1 Lifelong Friendship', '1 The Banyan Tree', '1 Sol Ring', '3 Forest', '2 Island', '', '1 Avatar Aang'].join('\n')
  await page.locator('.lobby textarea').fill(list)
  const status = page.locator('.deck-status')
  await expect(status).toContainText('10 cards · Commander: Avatar Aang', { timeout: 30_000 })
  await expect(status).toHaveClass(/good/)
  for (const note of ["Aang's Shelter is Teferi's Protection", 'Joo Dee, Public Servant is Sakashima of a Thousand Faces', "Lifelong Friendship is Eladamri's Call", 'The Banyan Tree is The Great Henge']) {
    await expect(status).toContainText(note)
  }
  // a real card XMage has no rules for is told apart from a name nobody knows
  await page.locator('.lobby textarea').fill(list + '\n1 Galactus, Devourer of Worlds\n1 Definitely Not A Card')
  await expect(status).toContainText('Not in XMage yet: Galactus, Devourer of Worlds')
  await expect(status).toContainText('Unknown card: Definitely Not A Card')
  expect(seat.problems).toEqual([])
  await seat.context.close()
})

test('a player who has conceded a match can still create and join tables', async ({ browser }) => {
  const table = await startGame(browser, { server: PLAY_SERVER, deckA: goblins, deckB: deck('elves') })
  const { a, b } = table
  // giving up the whole match counts as a quit on the server: one match, one quit, 100%
  await a.page.evaluate(() => (window as any).mtgui.store.getState().request('quitMatch'))
  for (const seat of [a, b]) {
    await seat.page.getByRole('button', { name: 'Back to lobby' }).click()
    await expect(seat.page.locator('.lobby textarea')).toBeVisible()
  }

  // the quitter's own table: wait until the server's record shows the quit
  await enterDeck(a, goblins)
  await a.page.getByRole('button', { name: 'Create table' }).click()
  await expect(a.page.locator('.seat.taken')).toHaveCount(1)
  await expect
    .poll(async () => {
      const tables = await a.page.evaluate(() => (window as any).mtgui.store.getState().request('tables'))
      return tables.find((t: any) => t.controllerName?.includes(a.name))?.seats?.[0]?.history ?? ''
    }, { timeout: 30_000 })
    .toContain('Q:1')
  await a.page.getByRole('button', { name: 'Leave table' }).click()

  // and now joins the other player's table, which XMage used to refuse ("Your quit ratio 100% …")
  await enterDeck(b, deck('elves'))
  await b.page.getByRole('button', { name: 'Create table' }).click()
  await expect(b.page.locator('.seats')).toBeVisible()
  await a.page.locator('.table-row', { hasText: b.name }).getByRole('button', { name: 'Join' }).click()
  await expect(b.page.locator('.seat.taken')).toHaveCount(2)
  await expect(a.page.locator('.notice', { hasText: 'quit ratio' })).toHaveCount(0)
  await b.page.getByRole('button', { name: 'Start game' }).click()
  await expect(a.page.locator('.game')).toBeVisible({ timeout: 30_000 })
  await expect(b.page.locator('.game')).toBeVisible({ timeout: 30_000 })
  await finish(table)
})
