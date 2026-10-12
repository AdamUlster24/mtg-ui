import { expect, test } from '@playwright/test'
import { cheat, clickCard, clickId, finish, findPermanent, lands, me, passUntil, payMana, press, snap, startGame, waitPrompt } from '../../helpers'

test('paying mana: only sources that can pay what is left are pointed out', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [
    ...lands(a, { Forest: 2, Mountain: 2, Island: 1 }),
    `battlefield:${a.name}:Llanowar Elves:1`,
    `battlefield:${a.name}:Command Tower:1`,
    `hand:${a.name}:Grizzly Bears:1`,
    `hand:${a.name}:Counterspell:1`,
  ])
  const lit = () => a.page.locator('.battlefield.mine .card.mark-playable').evaluateAll((els) => els.map((el) => el.getAttribute('data-name')).sort())

  // {1}{G}: generic mana is owed, anything that makes mana will do
  let s = await clickCard(a, 'Grizzly Bears', 'hand')
  expect(String(s.prompt!.data.message)).toMatch(/^Pay \{1\}\{G\}/)
  expect(await lit()).toEqual(['Command Tower', 'Forest', 'Forest', 'Island', 'Llanowar Elves', 'Mountain', 'Mountain'])

  // after a Mountain only {G} is left: green sources and "any color" ones, nothing else
  await clickId(a, me(s).battlefield.findLast((c: any) => c.name === 'Mountain').id)
  s = await waitPrompt(a, 'GAME_PLAY_MANA', /^Pay \{G\}/)
  expect(await lit()).toEqual(['Command Tower', 'Forest', 'Forest', 'Llanowar Elves'])
  // XMage itself would accept the other lands too (the mana would just sit in the pool)
  expect(me(s).battlefield.filter((c: any) => c.playable && !c.tapped).map((c: any) => c.name)).toContain('Island')
  await press(a, 'Cancel')
  await waitPrompt(a, 'GAME_SELECT')

  // {U}{U}: the Island and the Command Tower, not the Forests
  s = await clickCard(a, 'Counterspell', 'hand')
  if (s.prompt!.method === 'GAME_PLAY_MANA') {
    expect(await lit()).toEqual(['Command Tower', 'Island'])
    await press(a, 'Cancel')
  }
  await waitPrompt(a, 'GAME_SELECT')

  // and the payment itself works from what is lit
  await clickCard(a, 'Grizzly Bears', 'hand')
  await payMana(a)
  s = await passUntil(table, a, 'the bears', (x) => findPermanent(x, 'Grizzly Bears'))
  expect((await snap(a)).game.stack).toHaveLength(0)
  await finish(table)
})
