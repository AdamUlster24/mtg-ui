import { expect, test } from '@playwright/test'
import {
  card,
  cast,
  cheat,
  choose,
  clickCard,
  clickVisible,
  finish,
  findPermanent,
  hasArt,
  lands,
  me,
  opponent,
  passUntil,
  payMana,
  startGame,
  until,
  waitPrompt,
} from '../../helpers'

test('tokens: created by a spell and by test commands, with art', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Plains: 2 }), `hand:${a.name}:Raise the Alarm:1`, `token:${a.name}:TreasureToken:3`])

  let s = await until(a, 'treasures', (x) => (me(x).battlefield.filter((c: any) => c.name === 'Treasure Token').length === 3 ? x : false))
  expect(findPermanent(s, 'Treasure Token').token).toBe(true)
  // identical tokens share one pile with a count
  const pile = a.page.locator('.battlefield.mine .bf-slot', { has: a.page.locator('.card[data-name="Treasure Token"]') })
  await expect(pile.locator('.pile-count')).toHaveText('×3')
  expect(await hasArt(a, card(a, 'Treasure Token', 'mine'))).toBe(true)

  await cast(a, 'Raise the Alarm')
  s = await passUntil(table, b, 'two soldier tokens', (x) => opponent(x).battlefield.filter((c: any) => c.name === 'Soldier Token').length === 2)
  const soldier = opponent(s).battlefield.find((c: any) => c.name === 'Soldier Token')
  expect(soldier.token).toBe(true)
  expect(`${soldier.power}/${soldier.toughness}`).toBe('1/1')
  expect(await hasArt(b, card(b, 'Soldier Token', 'theirs'))).toBe(true)
  await finish(table)
})

test('double-faced card transforms into a planeswalker: Jace, Vryn\'s Prodigy', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [`battlefield:${a.name}:Jace, Vryn's Prodigy:1`, `graveyard:${a.name}:Mountain:5`])

  expect(await hasArt(a, card(a, "Jace, Vryn's Prodigy", 'mine'))).toBe(true)
  const front = await card(a, "Jace, Vryn's Prodigy", 'mine').locator('img').getAttribute('src')
  expect(front).not.toContain('back=1')

  // {T}: draw, then discard; with five cards in the graveyard he flips
  let s = await clickCard(a, "Jace, Vryn's Prodigy", 'mine')
  if (s.prompt!.method === 'GAME_CHOOSE_ABILITY') {
    await choose(a, /Draw a card/)
  }
  s = await passUntil(table, a, 'the discard', (x) => x.prompt?.method === 'GAME_TARGET')
  const discard = s.game.hand[0]
  await clickVisible(a, a.page.locator(`.hand .card[data-card-id="${discard.id}"]`))

  s = await passUntil(table, a, 'the transformed planeswalker', (x) => findPermanent(x, 'Jace, Telepath Unbound'))
  const jace = findPermanent(s, 'Jace, Telepath Unbound')
  expect(jace.transformed).toBe(true)
  expect(jace.types).toContain('PLANESWALKER')
  expect(jace.loyalty).toBe('5')
  await expect(card(a, 'Jace, Telepath Unbound', 'mine').locator('.badge.loyalty')).toHaveText('5')
  // the back face has its own art, for both players
  await expect(card(a, 'Jace, Telepath Unbound', 'mine').locator('img')).toHaveAttribute('src', /back=1/)
  expect(await hasArt(a, card(a, 'Jace, Telepath Unbound', 'mine'))).toBe(true)
  expect(await hasArt(b, card(b, 'Jace, Telepath Unbound', 'theirs'))).toBe(true)
  await finish(table)
})

test('planeswalker: loyalty abilities and loyalty counters', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [`battlefield:${a.name}:Jace Beleren:1`])
  let s = await until(a, 'jace', (x) => (findPermanent(x, 'Jace Beleren') ? x : false))
  expect(findPermanent(s, 'Jace Beleren').loyalty).toBe('3')
  const handA = s.game.hand.length
  const handB = opponent(s).handCount

  await clickCard(a, 'Jace Beleren', 'mine')
  await waitPrompt(a, 'GAME_CHOOSE_ABILITY')
  await choose(a, /Each player draws a card/)
  s = await passUntil(table, a, 'both players drawing', (x) => x.game.hand.length === handA + 1)
  expect(findPermanent(s, 'Jace Beleren').loyalty).toBe('5')
  expect(opponent(s).handCount).toBe(handB + 1)
  await expect(card(b, 'Jace Beleren', 'theirs').locator('.badge.loyalty')).toHaveText('5')
  await finish(table)
})

test('aura and equipment attach to creatures and are drawn behind them', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [
    ...lands(a, { Plains: 4 }),
    `battlefield:${a.name}:Savannah Lions:1`,
    `battlefield:${a.name}:Bonesplitter:1`,
    `battlefield:${b.name}:Grizzly Bears:1`,
    `hand:${a.name}:Pacifism:1`,
  ])

  // aura on the opponent's creature
  await clickCard(a, 'Pacifism', 'hand')
  let s = await until(a, 'a prompt', (x) => (x.prompt && !x.answering ? x : false))
  if (s.prompt!.method === 'GAME_TARGET') {
    await clickCard(a, 'Grizzly Bears', 'theirs')
  }
  await payMana(a)
  s = await passUntil(table, a, 'Pacifism attached', (x) => findPermanent(x, 'Pacifism')?.attachedTo)
  const bears = findPermanent(s, 'Grizzly Bears')
  expect(findPermanent(s, 'Pacifism').attachedTo).toBe(bears.id)
  expect(bears.attachments).toHaveLength(1)

  // equip: activated ability with a target, then payment
  await clickCard(a, 'Bonesplitter', 'mine')
  s = await until(a, 'a prompt', (x) => (x.prompt && !x.answering ? x : false))
  if (s.prompt!.method === 'GAME_TARGET') {
    await clickCard(a, 'Savannah Lions', 'mine')
  }
  await payMana(a)
  s = await passUntil(table, a, 'Bonesplitter attached', (x) => findPermanent(x, 'Bonesplitter')?.attachedTo)
  const lions = findPermanent(s, 'Savannah Lions')
  expect(findPermanent(s, 'Bonesplitter').attachedTo).toBe(lions.id)
  expect(lions.power).toBe('4')
  await expect(card(a, 'Savannah Lions', 'mine').locator('.badge.pt')).toHaveText('4/1')

  // equipment sits in its creature's slot on my side; the aura is on the opponent's side, so it keeps its own slot
  const slot = a.page.locator('.battlefield.mine .bf-slot', { has: a.page.locator('.card[data-name="Savannah Lions"]') })
  await expect(slot.locator('.attachment .card[data-name="Bonesplitter"]')).toBeVisible()
  await expect(b.page.locator('.battlefield.theirs .bf-slot .attachment .card[data-name="Bonesplitter"]')).toBeVisible()
  await finish(table)
})

test('counters: enters with +1/+1 counters and spends one', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Forest: 3 }), `hand:${a.name}:Spike Feeder:1`])

  await cast(a, 'Spike Feeder')
  let s = await passUntil(table, a, 'Spike Feeder', (x) => findPermanent(x, 'Spike Feeder'))
  expect(findPermanent(s, 'Spike Feeder').counters).toEqual([{ name: '+1/+1', count: 2 }])
  await expect(card(a, 'Spike Feeder', 'mine').locator('.counters span')).toContainText('2')
  await expect(card(b, 'Spike Feeder', 'theirs').locator('.badge.pt')).toHaveText('2/2')

  // "Remove a +1/+1 counter: You gain 2 life" is one of its two abilities
  await clickCard(a, 'Spike Feeder', 'mine')
  s = await until(a, 'a prompt', (x) => (x.prompt && !x.answering ? x : false))
  if (s.prompt!.method === 'GAME_CHOOSE_ABILITY') {
    await choose(a, /gain 2 life/)
  }
  s = await passUntil(table, a, 'life 42', (x) => me(x).life === 42)
  expect(findPermanent(s, 'Spike Feeder').counters).toEqual([{ name: '+1/+1', count: 1 }])
  await expect(card(a, 'Spike Feeder', 'mine').locator('.badge.pt')).toHaveText('1/1')
  await finish(table)
})
