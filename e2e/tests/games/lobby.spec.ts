import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { openSeat, uniqueName } from '../../helpers'
import { PLAY_SERVER, ROOT } from '../../servers'

const goblins = readFileSync(path.join(ROOT, 'e2e', 'decks', 'goblins.txt'), 'utf8')

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
