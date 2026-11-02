import { expect, test } from '@playwright/test'
import {
  card, cheat, choose, clickCard, finish, findPermanent, hover, lands, me,
  passUntil, payMana, press, settle, snap, startGame, waitPrompt,
} from '../../helpers'

for (const castBack of [false, true]) {
  test(`Peter Parker commander damage: ${castBack ? 'cast Amazing Spider-Man' : 'transform into Amazing Spider-Man'}`, async ({ browser }) => {
    const table = await startGame(browser, {
      deckA: 'Commander\n1 Peter Parker\n\nDeck\n60 Wastes',
      viewport: castBack ? { width: 1600, height: 900 } : { width: 1280, height: 720 },
    })
    const { a, b } = table
    const preview = await hover(a, card(a, 'Peter Parker', 'command'))
    await expect(preview.locator('.pv-other')).toContainText('Amazing Spider-Man')
    await expect(preview.locator('.preview-card')).toHaveCount(2)
    await expect(preview.locator('.pv-other .preview-card img')).toHaveAttribute('src', /[?&]back=1/)
    const bounds = await preview.boundingBox()
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(a.page.viewportSize()!.height)
    await cheat(a, lands(a, { Plains: 3, Forest: 2, Island: 2 }))
    await clickCard(a, 'Peter Parker', 'command')
    await waitPrompt(a, 'GAME_CHOOSE_ABILITY')
    await choose(a, castBack ? /Amazing Spider-Man/ : /Peter Parker/)
    await payMana(a)
    if (!castBack) {
      await passUntil(table, a, 'Peter and his token', x => findPermanent(x, 'Peter Parker') && x.game.stack.length === 0 && x.prompt?.method === 'GAME_SELECT')
      await clickCard(a, 'Peter Parker', 'mine')
      await settle(a, [/Transform/])
      await payMana(a)
    }
    const s = await passUntil(table, a, 'Amazing Spider-Man', x => findPermanent(x, 'Amazing Spider-Man') && x.game.stack.length === 0)
    expect(findPermanent(s, 'Amazing Spider-Man').backFace).toBe(true)
    const transformedPreview = await hover(a, card(a, 'Amazing Spider-Man', 'mine'))
    await expect(transformedPreview.locator('.pv-other')).toContainText('Peter Parker')
    await expect(transformedPreview.locator('.pv-other .preview-card img')).not.toHaveAttribute('src', /[?&]back=1/)

    // Both casting routes must accumulate the same commander's combat damage, once per player.
    for (const [turn, damage] of [[3, 4], [5, 8]]) {
      await passUntil(table, a, 'my next attack', x => x.game.turn === turn && x.prompt?.method === 'GAME_SELECT' && /attackers/i.test(x.prompt.data.message), 60_000)
      await clickCard(a, 'Amazing Spider-Man', 'mine')
      await press(a, 'Attack')
      await passUntil(table, b, 'combat damage', x => me(x).life === 40 - damage, 30_000)
      for (const seat of table.seats) {
        await expect(seat.page.locator('.commander-damage')).toHaveCount(1)
        await expect(seat.page.locator(`[data-commander-damage="${damage}"]`)).toContainText(`${damage}/21`)
      }
    }
    await finish(table)
  })
}

test('a transforming card in hand previews its other printed face', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [`hand:${a.name}:Delver of Secrets:1`])
  const delver = (await snap(a)).game.hand.find((c: any) => c.name === 'Delver of Secrets')
  expect(delver.secondFace.name).toBe('Insectile Aberration')
  expect(delver.secondFace.backFace).toBe(true)
  const preview = await hover(a, card(a, 'Delver of Secrets', 'hand'))
  await expect(preview.locator('.preview-card')).toHaveCount(2)
  await expect(preview.locator('.pv-other')).toContainText('Flying')
  await expect(preview.locator('.pv-other .preview-card img')).toHaveAttribute('src', /[?&]back=1/)
  await finish(table)
})
