import { expect, test } from '@playwright/test'
import {
  cast,
  cheat,
  choose,
  clickCard,
  clickId,
  clickPlayer,
  finish,
  findPermanent,
  lands,
  logText,
  me,
  opponent,
  passUntil,
  payMana,
  pickCard,
  pickDone,
  press,
  setAmount,
  setAmounts,
  startGame,
  until,
  waitPrompt,
} from '../../helpers'

test('X cost: number picker, target, payment', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Mountain: 4 }), `hand:${a.name}:Blaze:1`])

  await clickCard(a, 'Blaze', 'hand')
  await expect(a.page.locator('.modal .amount')).toBeVisible()
  await setAmount(a, 3)
  await waitPrompt(a, 'GAME_TARGET')
  await clickPlayer(a, b.name)
  await payMana(a)
  // the spell points at its target while it is on the stack
  await until(b, 'Blaze on the stack with a target', (s) => s.game.stack.some((c: any) => c.name === 'Blaze' && c.targets.length === 1))
  await expect(b.page.locator('svg.arrows path.arrow.target')).toHaveCount(1)

  const s = await passUntil(table, b, 'the damage', (x) => me(x).life === 37)
  expect(me(s).life).toBe(37)
  await expect(b.page.locator('.player-panel.mine .life')).toHaveText('37')
  await finish(table)
})

test('combat: attackers, two blockers on one attacker, damage assignment', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [`battlefield:${a.name}:Craw Wurm:1`, `battlefield:${b.name}:Grizzly Bears:2`])

  let s = await passUntil(table, a, 'the attack declaration', (x) => x.prompt?.method === 'GAME_SELECT' && /attackers/i.test(x.prompt.data.message))
  expect(s.prompt!.data.options.possibleAttackers).toHaveLength(1)
  await expect(a.page.locator('.battlefield.mine .card[data-name="Craw Wurm"]')).toHaveClass(/mark-playable/)
  await clickCard(a, 'Craw Wurm', 'mine')
  await expect(a.page.locator('.battlefield.mine .card.attacking')).toHaveCount(1)
  await expect(a.page.locator('svg.arrows path.arrow.attack')).toHaveCount(1)
  await press(a, 'Attack')

  s = await passUntil(table, b, 'the block declaration', (x) => x.prompt?.method === 'GAME_SELECT' && /blockers/i.test(x.prompt.data.message))
  const bears = me(s).battlefield.filter((c: any) => c.name === 'Grizzly Bears')
  expect(bears).toHaveLength(2)
  for (const bear of bears) {
    let next = await clickId(b, bear.id)
    if (next.prompt!.method === 'GAME_TARGET') {
      // "which attacker does it block"
      next = await clickCard(b, 'Craw Wurm', 'theirs')
    }
  }
  await expect(b.page.locator('.battlefield.mine .card.blocking')).toHaveCount(2)
  await expect(b.page.locator('svg.arrows path.arrow.block')).toHaveCount(2)
  await press(b, 'Block')

  // the attacker's controller splits 6 damage between the two blockers
  await passUntil(table, a, 'the damage assignment', (x) => x.prompt?.method === 'GAME_GET_MULTI_AMOUNT')
  await expect(a.page.locator('.modal .multi-amount input')).toHaveCount(2)
  await setAmounts(a, [3, 3])

  s = await passUntil(table, a, 'combat to finish', (x) => x.game.players.every((p: any) => p.battlefield.length === 0))
  expect(me(s).graveyard.map((c: any) => c.name)).toEqual(['Craw Wurm'])
  expect(opponent(s).graveyard.map((c: any) => c.name)).toEqual(['Grizzly Bears', 'Grizzly Bears'])
  await finish(table)
})

test('pile choice: Fact or Fiction', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Island: 4 }), `hand:${a.name}:Fact or Fiction:1`, `library:${a.name}:Grizzly Bears:1`])
  const handBefore = (await until(a, 'state', (s) => s)).game.hand.length

  await cast(a, 'Fact or Fiction')
  // the opponent separates the five revealed cards into two piles
  await passUntil(table, b, 'the pile split', (x) => x.prompt?.method === 'GAME_TARGET' && x.prompt.data.cards1?.length === 5)
  await expect(b.page.locator('.modal .card-grid .card')).toHaveCount(5)
  await b.page.locator('.modal .card-grid .card').first().click()
  await until(b, 'the first pick', (x) => x.prompt?.data.cards1?.length !== 5 || x.prompt?.method !== 'GAME_TARGET' || (x.prompt.data.options.chosenTargets ?? []).length > 0)
  const after = await until(b, 'a prompt', (x) => (x.prompt && !x.answering ? x : false))
  if (after.prompt!.method === 'GAME_TARGET') {
    await pickDone(b)
  }

  await passUntil(table, a, 'the pile choice', (x) => x.prompt?.method === 'GAME_CHOOSE_PILE')
  await expect(a.page.locator('.modal .piles-choice section')).toHaveCount(2)
  const piles = await until(a, 'piles', (x) => x.prompt?.data)
  expect(piles.cards1.length + piles.cards2.length).toBe(5)
  const before = await until(a, 'state', (x) => x)
  await a.page.locator('.modal .piles-choice section').nth(1).getByRole('button').click()
  const s = await until(a, 'the pile in hand', (x) => (x.prompt?.messageId !== before.prompt!.messageId && x.prompt?.method === 'GAME_SELECT' ? x : false))
  // Fact or Fiction left the hand, the chosen pile came in
  expect(s.game.hand.length).toBe(handBefore - 1 + piles.cards2.length)
  await finish(table)
})

test('ability picker and paying from the mana pool', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [`battlefield:${a.name}:Karplusan Forest:1`, `hand:${a.name}:Bonesplitter:1`])

  // spend the pool by hand for this test
  await a.page.getByRole('button', { name: /More/ }).click()
  await a.page.getByRole('button', { name: /Spend mana pool automatically/ }).click()

  await clickCard(a, 'Karplusan Forest', 'mine')
  await waitPrompt(a, 'GAME_CHOOSE_ABILITY')
  expect(await a.page.locator('.modal .option-list button').count()).toBeGreaterThan(1)
  // the first of its three mana abilities makes colorless mana
  await choose(a, /Add/)
  let s = await until(a, 'mana in the pool', (x) => (me(x).manaPool.C === 1 ? x : false))
  await expect(a.page.locator('.player-panel.mine .mana-pool button')).toHaveCount(1)

  await clickCard(a, 'Bonesplitter', 'hand')
  s = await waitPrompt(a, 'GAME_PLAY_MANA')
  const before = s
  await a.page.locator('.player-panel.mine .mana-pool button').click()
  await until(a, 'the payment', (x) => x.prompt?.messageId !== before.prompt!.messageId)
  s = await passUntil(table, a, 'Bonesplitter on the battlefield', (x) => findPermanent(x, 'Bonesplitter'))
  expect(me(s).manaPool.C).toBe(0)
  await finish(table)
})

test('searching the library: Rampant Growth', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Forest: 2 }), `hand:${a.name}:Rampant Growth:1`, `library:${a.name}:Mountain:2`])

  await cast(a, 'Rampant Growth')
  const s = await passUntil(table, a, 'the library search', (x) => x.prompt?.method === 'GAME_TARGET' && x.prompt.data.cards1?.length > 0)
  // only basic lands can be picked, everything else in the library is shown dimmed
  expect(s.prompt!.data.cards1.length).toBeGreaterThan(2)
  await expect(a.page.locator('.modal .card-grid .card[data-name="Mountain"]').first()).not.toHaveClass(/dimmed/)
  await pickCard(a, 'Mountain')
  const after = await passUntil(table, a, 'the land on the battlefield', (x) => findPermanent(x, 'Mountain'))
  expect(findPermanent(after, 'Mountain').tapped).toBe(true)
  expect(logText(after)).toContain('Rampant Growth')
  await finish(table)
})

test('targeting a card in the graveyard: Raise Dead', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Swamp: 1 }), `hand:${a.name}:Raise Dead:1`, `graveyard:${a.name}:Grizzly Bears:1`, `graveyard:${a.name}:Craw Wurm:1`, `graveyard:${a.name}:Mountain:1`])

  await clickCard(a, 'Raise Dead', 'hand')
  await waitPrompt(a, 'GAME_TARGET')
  // the legal targets are offered in a picker, the land in the graveyard is not
  await expect(a.page.locator('.modal .card-grid .card')).toHaveCount(2)
  await pickCard(a, 'Grizzly Bears')
  await payMana(a)
  const s = await passUntil(table, a, 'the creature back in hand', (x) => x.game.hand.some((c: any) => c.name === 'Grizzly Bears'))
  expect(me(s).graveyard.map((c: any) => c.name).sort()).toEqual(['Craw Wurm', 'Mountain', 'Raise Dead'])

  // the graveyard can be browsed from the player panel
  await a.page.locator('.player-panel.mine .zone-piles [title="Graveyard"]').click()
  await expect(a.page.locator('.modal .card-grid .card')).toHaveCount(3)
  await a.page.locator('.modal header button').click()
  await finish(table)
})

test('choice list with a filter: Cavern of Souls', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [`hand:${a.name}:Cavern of Souls:1`])

  await clickCard(a, 'Cavern of Souls', 'hand')
  const s = await waitPrompt(a, 'GAME_CHOOSE_CHOICE')
  expect(s.prompt!.data.choice.items.length).toBeGreaterThan(100)
  await a.page.locator('.modal input').fill('Elf')
  await a.page.locator('.modal .option-list button').getByText('Elf', { exact: true }).click()
  const after = await until(a, 'the land on the battlefield', (x) => (findPermanent(x, 'Cavern of Souls') && x.prompt?.method === 'GAME_SELECT' ? x : false))
  expect(logText(after)).toMatch(/Elf/)
  await finish(table)
})
