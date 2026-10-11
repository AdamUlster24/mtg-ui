import { expect, test } from '@playwright/test'
import { cast, cheat, finish, findPermanent, lands, me, passUntil, startGame, until, waitPrompt } from '../../helpers'

test('test commands set up the board, a creature is cast and resolves', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table

  // the group picker is XMage's generic choice list
  await cheat(a, [...lands(a, { Forest: 3 }), `hand:${a.name}:Grizzly Bears:1`])
  await expect(a.page.locator('.battlefield.mine .card[data-name="Forest"]')).toHaveCount(3)
  await expect(b.page.locator('.battlefield.theirs .card[data-name="Forest"]')).toHaveCount(3)

  await cast(a, 'Grizzly Bears')
  // the spell waits on the stack until the opponent passes
  await until(b, 'the spell on the stack', (s) => s.game.stack.some((c: any) => c.name === 'Grizzly Bears'))
  await expect(b.page.locator('.stack-zone .card[data-name="Grizzly Bears"]')).toBeVisible()
  const s = await passUntil(table, a, 'the creature on the battlefield', (x) => findPermanent(x, 'Grizzly Bears'))
  expect(findPermanent(s, 'Grizzly Bears').power).toBe('2')
  expect(me(s).battlefield.filter((c: any) => c.tapped)).toHaveLength(2)
  await expect(a.page.locator('.battlefield.mine .card[data-name="Grizzly Bears"] .badge.pt')).toHaveText('2/2')
  await waitPrompt(a, 'GAME_SELECT')
  await finish(table)
})
