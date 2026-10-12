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
  hover,
  lands,
  me,
  opponent,
  passUntil,
  payMana,
  press,
  resolveUntil,
  settle,
  snap,
  startGame,
  until,
  waitPrompt,
} from '../../helpers'

test('saga: lore counters and chapter triggers (History of Benalia)', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Plains: 3 }), `hand:${a.name}:History of Benalia:1`])
  await cast(a, 'History of Benalia')
  const s = await passUntil(table, a, 'chapter one', (x) => findPermanent(x, 'Knight Token') && x.game.stack.length === 0)
  expect(findPermanent(s, 'History of Benalia').counters).toEqual([{ name: 'lore', count: 1 }])
  await expect(card(a, 'History of Benalia', 'mine').locator('[data-counter="lore"]')).toContainText('1')
  expect(findPermanent(s, 'Knight Token').token).toBe(true)
  await finish(table)
})

test('level up: level counters change the creature (Student of Warfare)', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Plains: 3 }), `battlefield:${a.name}:Student of Warfare:1`])
  for (let level = 1; level <= 2; level++) {
    await clickCard(a, 'Student of Warfare', 'mine')
    await settle(a, [/[Ll]evel up/])
    await payMana(a)
    await passUntil(table, a, `level ${level}`, (x) => findPermanent(x, 'Student of Warfare').counters.some((c: any) => c.name === 'level' && c.count === level) && x.game.stack.length === 0)
  }
  const s = await snap(a)
  // level 2-6: 3/3 first strike
  expect(`${findPermanent(s, 'Student of Warfare').power}/${findPermanent(s, 'Student of Warfare').toughness}`).toBe('3/3')
  await expect(card(a, 'Student of Warfare', 'mine').locator('.badge.pt')).toHaveText('3/3')
  await expect(card(a, 'Student of Warfare', 'mine').locator('.badge.pt')).toHaveClass(/boosted/)
  await expect(card(a, 'Student of Warfare', 'mine').locator('[data-icon="ABILITY_FIRST_STRIKE"]')).toBeVisible()
  await finish(table)
})

test('class: levels are shown on the card (Ranger Class)', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Forest: 4 }), `hand:${a.name}:Ranger Class:1`])
  await cast(a, 'Ranger Class')
  let s = await passUntil(table, a, 'the class and its wolf', (x) => findPermanent(x, 'Ranger Class') && findPermanent(x, 'Wolf Token') && x.game.stack.length === 0)
  await expect(card(a, 'Ranger Class', 'mine').locator('[data-icon="ABILITY_CLASS_LEVEL"]')).toContainText('1')
  await clickCard(a, 'Ranger Class', 'mine')
  await settle(a, [/[Ll]evel 2/])
  await payMana(a)
  s = await passUntil(table, a, 'level 2', (x) => findPermanent(x, 'Ranger Class').icons.some((i: any) => i.type === 'ABILITY_CLASS_LEVEL' && /2/.test(i.text)) && x.game.stack.length === 0)
  await expect(card(a, 'Ranger Class', 'mine').locator('[data-icon="ABILITY_CLASS_LEVEL"]')).toContainText('2')
  await finish(table)
})

test('emblems sit in the command zone and show their text', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [`emblem:${a.name}:ElspethSunsChampionEmblem:1`])
  const s = await until(a, 'the emblem', (x) => (me(x).commandZone.some((c: any) => c.commandKind === 'emblem') ? x : false))
  const emblem = me(s).commandZone.find((c: any) => c.commandKind === 'emblem')
  expect(emblem.rules.join(' ')).toMatch(/\+2\/\+2/)
  const tile = a.page.locator('.player-panel.mine .command-object[data-command-kind="emblem"]')
  await expect(tile).toBeVisible()
  await expect(b.page.locator('.player-panel.theirs .command-object[data-command-kind="emblem"]')).toBeVisible()
  await tile.hover()
  await expect(a.page.locator('.preview')).toContainText('+2/+2')
  await finish(table)
})

test('dungeon: venturing puts the dungeon in the command zone with its room', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Plains: 4 }), `hand:${a.name}:Veteran Dungeoneer:1`])
  await cast(a, 'Veteran Dungeoneer')
  // which dungeon; its first room then scries
  let s = await passUntil(table, a, 'the venture', (x) => x.prompt?.method === 'GAME_CHOOSE_CHOICE' || me(x).commandZone.some((c: any) => c.commandKind === 'dungeon'))
  if (s.prompt?.method === 'GAME_CHOOSE_CHOICE') {
    await choose(a, /Lost Mine of Phandelver/)
  }
  s = await resolveUntil(table, a, 'the dungeon', (x) => me(x).commandZone.some((c: any) => c.commandKind === 'dungeon') && x.game.stack.length === 0 && x.prompt?.method === 'GAME_SELECT')
  const dungeon = me(s).commandZone.find((c: any) => c.commandKind === 'dungeon')
  expect(dungeon.name).toMatch(/Lost Mine of Phandelver/)
  await expect(a.page.locator('.player-panel.mine .command-object[data-command-kind="dungeon"]')).toContainText('Lost Mine')
  await finish(table)
})

test('the monarch and the initiative are shown on the player', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Swamp: 4 }), `hand:${a.name}:Thorn of the Black Rose:1`, `hand:${a.name}:Aarakocra Sneak:1`, ...lands(a, { Island: 4 })])
  await cast(a, 'Thorn of the Black Rose')
  await passUntil(table, a, 'the monarch', (x) => me(x).monarch && x.game.stack.length === 0)
  await expect(a.page.locator('.player-panel.mine [data-badge="Monarch"]')).toBeVisible()
  await expect(b.page.locator('.player-panel.theirs [data-badge="Monarch"]')).toBeVisible()

  await cast(a, 'Aarakocra Sneak')
  // taking the initiative ventures into the Undercity, whose first room searches for a basic land
  const settled = (x: any) => me(x).initiative && x.game.stack.length === 0 && x.prompt?.method === 'GAME_SELECT'
  let s = await passUntil(table, a, 'the initiative', (x) => settled(x) || /CHOICE|TARGET/.test(x.prompt?.method ?? ''))
  for (let i = 0; i < 4 && !settled(s); i++) {
    if (s.prompt?.method === 'GAME_CHOOSE_CHOICE') await choose(a, /./)
    else if (s.prompt?.method === 'GAME_TARGET') {
      const before = s
      await a.page.locator('.modal .card-grid .card:not(.dimmed)').first().click()
      await until(a, 'the pick', (x) => x.prompt?.messageId !== before.prompt!.messageId)
    }
    s = await passUntil(table, a, 'the initiative', (x) => settled(x) || /CHOICE|TARGET/.test(x.prompt?.method ?? ''))
  }
  await expect(a.page.locator('.player-panel.mine [data-badge="Initiative"]')).toBeVisible()
  expect(me(s).commandZone.some((c: any) => c.commandKind === 'dungeon' && /Undercity/.test(c.name))).toBe(true)
  await finish(table)
})

test('day and night are shown once the cycle starts (Brutal Cathar)', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Plains: 3 }), `hand:${a.name}:Brutal Cathar:1`])
  await expect(a.page.locator('[data-day-night]')).toHaveCount(0)
  await cast(a, 'Brutal Cathar')
  await passUntil(table, a, 'the cathar', (x) => findPermanent(x, 'Brutal Cathar') && x.game.stack.length === 0)
  await expect(a.page.locator('[data-day-night="day"]')).toBeVisible()
  await expect(b.page.locator('[data-day-night="day"]')).toBeVisible()
  await finish(table)
})

test('commander: combat damage is counted, and the tax shows after recasting', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Plains: 5, Mountain: 1 }), `hand:${a.name}:Shock:1`])
  await cast(a, 'Isamaru, Hound of Konda', 'command')
  let s = await passUntil(table, a, 'the commander', (x) => findPermanent(x, 'Isamaru, Hound of Konda') && x.game.stack.length === 0)
  await expect(card(a, 'Isamaru, Hound of Konda', 'mine').locator('[data-icon="COMMANDER"]')).toBeVisible()

  // kill it, put it back, cast it again: two mana more
  await clickCard(a, 'Shock', 'hand')
  await waitPrompt(a, 'GAME_TARGET')
  await clickCard(a, 'Isamaru, Hound of Konda', 'mine')
  await payMana(a)
  await passUntil(table, a, 'the command zone question', (x) => x.prompt?.method === 'GAME_ASK')
  await a.page.locator('.prompt-buttons .primary').click()
  s = await passUntil(table, a, 'the commander back in the command zone', (x) => me(x).commandZone.some((c: any) => c.name === 'Isamaru, Hound of Konda') && x.prompt?.method === 'GAME_SELECT')
  const commander = me(s).commandZone.find((c: any) => c.name === 'Isamaru, Hound of Konda')
  expect([...commander.rules, ...commander.hints].join(' ')).toMatch(/1 time played from the command zone/)
  const preview = await hover(a, a.page.locator('.player-panel.mine .command-zone .card'))
  await expect(preview).toContainText('1 time played from the command zone')
  await clickCard(a, 'Isamaru, Hound of Konda', 'command')
  s = await waitPrompt(a, 'GAME_PLAY_MANA')
  // the commander tax: two generic mana on top of {W}
  expect(String(s.prompt!.data.message)).toMatch(/\{2\}/)
  await payMana(a)
  await passUntil(table, a, 'the commander again', (x) => findPermanent(x, 'Isamaru, Hound of Konda') && x.game.stack.length === 0)

  // next turn it attacks: the damage it has dealt is tracked for the 21 rule
  await passUntil(table, a, 'my next attack', (x) => x.game.turn === 3 && x.prompt?.method === 'GAME_SELECT' && /attackers/i.test(x.prompt.data.message), 60_000)
  await clickCard(a, 'Isamaru, Hound of Konda', 'mine')
  await press(a, 'Attack')
  await passUntil(table, b, 'the commander damage', (x) => me(x).life === 38, 30_000)
  for (const seat of table.seats) {
    await expect(seat.page.locator('[data-commander-damage="2"]')).toContainText('2/21')
  }
  await finish(table)
})

test('player counters: poison and energy', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Forest: 1 }), `hand:${a.name}:Attune with Aether:1`, `battlefield:${a.name}:Glistener Elf:1`])
  await cast(a, 'Attune with Aether')
  let s = await passUntil(table, a, 'the search', (x) => x.prompt?.method === 'GAME_TARGET' && x.prompt.data.cards1?.length > 0)
  await a.page.locator('.modal .card-grid .card:not(.dimmed)').first().click()
  s = await passUntil(table, a, 'the energy', (x) => me(x).counters.some((c: any) => /energy/i.test(c.name) && c.count === 2))
  await expect(a.page.locator('.player-panel.mine [data-badge="2 energy"]')).toBeVisible()

  await passUntil(table, a, 'the attack', (x) => x.prompt?.method === 'GAME_SELECT' && /attackers/i.test(x.prompt.data.message))
  await clickCard(a, 'Glistener Elf', 'mine')
  await press(a, 'Attack')
  s = await passUntil(table, b, 'the poison counter', (x) => me(x).counters.some((c: any) => /poison/i.test(c.name)))
  expect(me(s).life).toBe(40)
  await expect(b.page.locator('.player-panel.mine [data-badge="1 poison"]')).toBeVisible()
  await expect(a.page.locator('.player-panel.theirs [data-badge="1 poison"]')).toBeVisible()
  await finish(table)
})

test('card icons: keyword abilities and restrictions are marked on the card', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Plains: 2 }), `battlefield:${a.name}:Serra Angel:1`, `battlefield:${b.name}:Grizzly Bears:1`, `hand:${a.name}:Pacifism:1`])
  const angel = card(a, 'Serra Angel', 'mine')
  await expect(angel.locator('[data-icon="ABILITY_FLYING"]')).toBeVisible()
  await expect(angel.locator('[data-icon="ABILITY_VIGILANCE"]')).toBeVisible()
  await expect(card(b, 'Serra Angel', 'theirs').locator('[data-icon="ABILITY_FLYING"]')).toBeVisible()

  await clickCard(a, 'Pacifism', 'hand')
  const s = await settle(a)
  if (s.prompt!.method === 'GAME_TARGET') await clickCard(a, 'Grizzly Bears', 'theirs')
  await payMana(a)
  await passUntil(table, a, 'Pacifism', (x) => findPermanent(x, 'Pacifism')?.attachedTo)
  // "can't attack or block" shows as a restriction mark with the reason
  const bears = card(b, 'Grizzly Bears', 'mine')
  await expect(bears.locator('[data-icon="OTHER_HAS_RESTRICTIONS"]')).toBeVisible()
  const preview = await hover(b, bears)
  await expect(preview.locator('.pv-icons')).toContainText(/attack/i)
  await finish(table)
})

test('a curse attached to a player is listed on that player', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Swamp: 5 }), `hand:${a.name}:Curse of Thirst:1`])
  await clickCard(a, 'Curse of Thirst', 'hand')
  let s = await settle(a)
  if (s.prompt!.method === 'GAME_TARGET') {
    await clickVisible(a, a.page.locator(`.life-orb[data-oid="${opponent(s).id}"]`))
  }
  await payMana(a)
  s = await passUntil(table, a, 'the curse', (x) => opponent(x).attachments.length === 1 && x.game.stack.length === 0)
  await expect(a.page.locator('.player-panel.theirs [data-attached="Curse of Thirst"]')).toBeVisible()
  await expect(b.page.locator('.player-panel.mine [data-attached="Curse of Thirst"]')).toBeVisible()
  await finish(table)
})
