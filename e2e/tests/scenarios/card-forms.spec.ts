import { expect, test } from '@playwright/test'
import {
  card,
  cheat,
  choose,
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
  settle,
  snap,
  startGame,
  until,
  waitPrompt,
} from '../../helpers'

test('split card: both halves are shown and either can be cast (Fire // Ice)', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Island: 2 }), `hand:${a.name}:Fire // Ice:1`, `battlefield:${b.name}:Grizzly Bears:1`])
  let s = await snap(a)
  const split = s.game.hand.find((c: any) => c.name === 'Fire // Ice')
  expect(split.split).toBe(true)
  expect([split.leftHalf.name, split.rightHalf.name]).toEqual(['Fire', 'Ice'])
  const preview = await hover(a, card(a, 'Fire // Ice', 'hand'))
  await expect(preview.locator('.pv-half')).toHaveCount(2)
  await expect(preview.locator('.pv-half').nth(1)).toContainText('Ice')

  const hand = s.game.hand.length
  await clickCard(a, 'Fire // Ice', 'hand')
  await waitPrompt(a, 'GAME_CHOOSE_ABILITY')
  await choose(a, /Ice/)
  s = await settle(a)
  if (s.prompt!.method === 'GAME_TARGET') await clickCard(a, 'Grizzly Bears', 'theirs')
  await payMana(a)
  s = await passUntil(table, a, 'Ice to resolve', (x) => findPermanent(x, 'Grizzly Bears')?.tapped && x.game.stack.length === 0)
  // Ice left the hand and drew a card
  expect(s.game.hand.length).toBe(hand)
  await finish(table)
})

test('adventure card: the adventure is cast, then the creature from exile (Bonecrusher Giant)', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Mountain: 5 }), `hand:${a.name}:Bonecrusher Giant:1`])
  let s = await snap(a)
  const giant = s.game.hand.find((c: any) => c.name === 'Bonecrusher Giant')
  expect(giant.rightHalf.name).toBe('Stomp')
  expect(giant.rightHalf.spellType).toMatch(/adventure/i)
  const preview = await hover(a, card(a, 'Bonecrusher Giant', 'hand'))
  await expect(preview).toContainText('Stomp')

  await clickCard(a, 'Bonecrusher Giant', 'hand')
  await waitPrompt(a, 'GAME_CHOOSE_ABILITY')
  await choose(a, /Stomp/)
  await waitPrompt(a, 'GAME_TARGET')
  s = await snap(a)
  await clickVisible(a, a.page.locator(`.life-orb[data-oid="${opponent(s).id}"]`))
  await payMana(a)
  s = await passUntil(table, a, 'Stomp to resolve', (x) => opponent(x).life === 38 && x.game.stack.length === 0)

  // the card went on an adventure: it waits in exile and can be cast from there, which the pile shows
  expect(me(s).exile.map((c: any) => c.name)).toEqual(['Bonecrusher Giant'])
  const pile = a.page.locator('.player-panel.mine .zone-piles [title="Exile"]')
  await expect(pile).toHaveClass(/has-playable/)
  await expect(pile.locator('.pile-playable')).toHaveText('▶1')
  await pile.click()
  await expect(a.page.locator('.modal .card-grid .card[data-name="Bonecrusher Giant"]')).not.toHaveClass(/dimmed/)
  const before = await snap(a)
  await a.page.locator('.modal .card-grid .card[data-name="Bonecrusher Giant"]').click()
  await until(a, 'the cast to start', (x) => x.prompt?.messageId !== before.prompt!.messageId)
  await settle(a)
  await payMana(a)
  s = await passUntil(table, a, 'the giant on the battlefield', (x) => findPermanent(x, 'Bonecrusher Giant'))
  await expect(b.page.locator('.battlefield.theirs .card[data-name="Bonecrusher Giant"]')).toBeVisible()
  await finish(table)
})

test('flashback: a card in the graveyard is offered without opening the pile (Think Twice)', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Island: 3 }), `graveyard:${a.name}:Think Twice:1`, `graveyard:${a.name}:Grizzly Bears:1`])
  let s = await snap(a)
  const hand = s.game.hand.length
  const pile = a.page.locator('.player-panel.mine .zone-piles [data-pile^="graveyard"]')
  await expect(pile).toHaveClass(/has-playable/)
  await expect(pile.locator('.pile-playable')).toHaveText('▶1')

  await pile.click()
  // what can be played comes first, the rest is dimmed
  await expect(a.page.locator('.modal .card-grid .card').first()).toHaveAttribute('data-name', 'Think Twice')
  await expect(a.page.locator('.modal .card-grid .card[data-name="Grizzly Bears"]')).toHaveClass(/dimmed/)
  const before = await snap(a)
  await a.page.locator('.modal .card-grid .card[data-name="Think Twice"]').click()
  await until(a, 'the cast to start', (x) => x.prompt?.messageId !== before.prompt!.messageId)
  await settle(a)
  await payMana(a)
  s = await passUntil(table, a, 'the draw', (x) => x.game.hand.length === hand + 1)
  expect(me(s).exile.map((c: any) => c.name)).toEqual(['Think Twice'])
  await finish(table)
})

test('top of the library is face up and playable with Future Sight', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [`battlefield:${a.name}:Future Sight:1`])
  let s = await until(a, 'the revealed top card', (x) => (me(x).topCard ? x : false))
  expect(me(s).topCard.name).toBe('Wastes')
  expect(me(s).topCard.playable).toBe(true)
  const top = a.page.locator('.player-panel.mine .pile.revealed .card[data-name="Wastes"]')
  await expect(top).toHaveClass(/mark-playable/)
  // the opponent sees it too
  await expect(b.page.locator('.player-panel.theirs .pile.revealed .card[data-name="Wastes"]')).toBeVisible()

  const library = me(s).libraryCount
  await clickVisible(a, top)
  s = await until(a, 'the land from the library', (x) => (findPermanent(x, 'Wastes') ? x : false))
  expect(me(s).libraryCount).toBe(library - 1)
  await finish(table)
})

test('flip card flips and is drawn upside down (Budoka Gardener)', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Forest: 10 }), `battlefield:${a.name}:Budoka Gardener:1`])
  let s = await snap(a)
  expect(findPermanent(s, 'Budoka Gardener').flipCard).toBe(true)
  expect(findPermanent(s, 'Budoka Gardener').flipped).toBe(false)

  // {T}: put a land from hand onto the battlefield; with ten lands it flips
  await clickCard(a, 'Budoka Gardener', 'mine')
  s = await settle(a)
  for (let i = 0; i < 6 && !findPermanent(s, 'Dokai, Weaver of Life'); i++) {
    if (s.prompt!.method === 'GAME_TARGET') {
      if ((await a.page.locator('.modal .card-grid .card').count()) > 0) await a.page.locator('.modal .card-grid .card:not(.dimmed)').first().click()
      else await clickVisible(a, a.page.locator('.hand .card.mark-target').first())
      s = await until(a, 'the next prompt', (x) => (x.prompt?.messageId !== s.prompt!.messageId && !x.answering ? x : false))
    } else if (s.prompt!.method === 'GAME_ASK') {
      s = await settle(a)
    } else {
      s = await passUntil(table, a, 'the flip', (x) => findPermanent(x, 'Dokai, Weaver of Life') || x.prompt?.method !== 'GAME_SELECT')
    }
  }
  const flipped = findPermanent(s, 'Dokai, Weaver of Life')
  expect(flipped.flipped).toBe(true)
  await expect(card(a, 'Dokai, Weaver of Life', 'mine')).toHaveClass(/flipped/)
  await finish(table)
})

test('modal double-faced card: played as its land side (Shatterskull Smashing)', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [`hand:${a.name}:Shatterskull Smashing:1`])
  let s = await snap(a)
  const mdfc = s.game.hand.find((c: any) => c.name === 'Shatterskull Smashing')
  expect(mdfc.secondFace.name).toBe('Shatterskull, the Hammer Pass')
  const preview = await hover(a, card(a, 'Shatterskull Smashing', 'hand'))
  await expect(preview.locator('.pv-other')).toContainText('Shatterskull, the Hammer Pass')

  await clickCard(a, 'Shatterskull Smashing', 'hand')
  await waitPrompt(a, 'GAME_CHOOSE_ABILITY')
  await choose(a, /Hammer Pass|Play/)
  // "pay 3 life to have it enter untapped?"
  s = await settle(a)
  s = await until(a, 'the land side on the battlefield', (x) => (findPermanent(x, 'Shatterskull, the Hammer Pass') && x.prompt?.method === 'GAME_SELECT' ? x : false))
  expect(findPermanent(s, 'Shatterskull, the Hammer Pass').types).toContain('LAND')
  await expect(b.page.locator('.battlefield.theirs .card[data-name="Shatterskull, the Hammer Pass"]')).toBeVisible()
  await finish(table)
})

test('morph: cast face down, hidden from the opponent, turned face up (Battering Craghorn)', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Mountain: 6 }), `hand:${a.name}:Battering Craghorn:1`])

  await clickCard(a, 'Battering Craghorn', 'hand')
  await waitPrompt(a, 'GAME_CHOOSE_ABILITY')
  await choose(a, /[Mm]orph|face down/)
  await payMana(a)
  let s = await passUntil(table, a, 'the face-down creature', (x) => me(x).battlefield.some((c: any) => c.faceDown) && x.game.stack.length === 0)
  const mine = me(s).battlefield.find((c: any) => c.faceDown)
  expect(mine.morphed).toBe(true)
  expect(`${mine.power}/${mine.toughness}`).toBe('2/2')
  // I know what it is, the opponent does not
  expect(mine.original.name).toBe('Battering Craghorn')
  const theirs = opponent(await snap(b)).battlefield.find((c: any) => c.faceDown)
  expect(theirs.name).not.toBe('Battering Craghorn')
  expect(theirs.original).toBeUndefined()
  const hidden = a.page.locator(`.battlefield.mine .card[data-card-id="${mine.id}"]`)
  await expect(hidden.locator('.card-back')).toBeVisible()
  await expect(hidden.locator('.mark-chip.hidden-kind')).toHaveText('Morph')
  const preview = await hover(a, hidden)
  await expect(preview.locator('.pv-flag').first()).toContainText('really Battering Craghorn')
  const theirPreview = await hover(b, b.page.locator(`.battlefield.theirs .card[data-card-id="${mine.id}"]`))
  await expect(theirPreview).not.toContainText('Craghorn')

  // turning it face up is a special action paid with its morph cost
  await clickVisible(a, hidden)
  s = await settle(a, [/face up|[Mm]orph/])
  await payMana(a)
  s = await until(a, 'the creature face up', (x) => (findPermanent(x, 'Battering Craghorn') && !findPermanent(x, 'Battering Craghorn').faceDown ? x : false))
  await expect(b.page.locator('.battlefield.theirs .card[data-name="Battering Craghorn"]')).toBeVisible()
  await finish(table)
})

test('mutate: a creature merges onto another (Gemrazer)', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Forest: 4 }), `hand:${a.name}:Gemrazer:1`, `battlefield:${a.name}:Grizzly Bears:1`])

  await clickCard(a, 'Gemrazer', 'hand')
  await waitPrompt(a, 'GAME_CHOOSE_ABILITY')
  await choose(a, /[Mm]utate/)
  let s = await settle(a)
  if (s.prompt!.method === 'GAME_TARGET') await clickCard(a, 'Grizzly Bears', 'mine')
  await payMana(a)
  // on top or underneath
  s = await passUntil(table, a, 'the merged creature', (x) => me(x).battlefield.some((c: any) => c.mutated) || x.prompt?.method === 'GAME_ASK')
  if (s.prompt?.method === 'GAME_ASK') {
    await a.page.locator('.prompt-buttons .primary').click()
    s = await passUntil(table, a, 'the merged creature', (x) => me(x).battlefield.some((c: any) => c.mutated))
  }
  const merged = me(s).battlefield.find((c: any) => c.mutated)
  expect(merged.mutateView.name).toBeTruthy()
  expect(merged.mutateView.id).toBeTruthy()
  expect(me(s).battlefield.filter((c: any) => c.types.includes('CREATURE'))).toHaveLength(1)
  await expect(a.page.locator(`.battlefield.mine .card[data-card-id="${merged.id}"] .mark-chip.mutated`)).toBeVisible()
  await finish(table)
})
