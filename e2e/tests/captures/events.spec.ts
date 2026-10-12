import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import {
  cast,
  cheat,
  choose,
  clickCard,
  clickVisible,
  finish,
  findPermanent,
  lands,
  me,
  opponent,
  pass,
  passUntil,
  payMana,
  resolveUntil,
  settle,
  snap,
  startGame,
  until,
  waitPrompt,
  type Seat,
} from '../../helpers'
import { ROOT } from '../../servers'

const OUT = path.join(ROOT, 'docs', 'captures', 'events')

/** Watches the page while `action` plays out: frames for review, and what was in motion */
async function filmed(page: Page, name: string, action: () => Promise<unknown>, frames = 7) {
  const seen = { animations: 0, effects: new Set<string>(), classes: new Set<string>() }
  let done = false
  const watch = (async () => {
    for (let i = 0; !done || i < frames; i++) {
      const now = await page.evaluate(() => ({
        running: document.getAnimations().filter((a) => a.playState === 'running' && (a.effect?.getTiming().iterations ?? 1) !== Infinity).length,
        effects: Array.from(document.querySelectorAll('[data-effect]')).map((e) => e.getAttribute('data-effect')!),
        piles: Array.from(document.querySelectorAll('.pile.shuffling, .pile.searching')).map((e) => (e.classList.contains('shuffling') ? 'shuffling' : 'searching')),
        marks: [
          ...Array.from(document.querySelectorAll('.counter-change')).map(() => 'counter-change'),
          ...Array.from(document.querySelectorAll('.life-change')).map(() => 'life-change'),
          ...Array.from(document.querySelectorAll('.fly-ghost.countered')).map(() => 'countered-ghost'),
          ...Array.from(document.querySelectorAll('.fly-ghost')).map(() => 'ghost'),
          ...Array.from(document.querySelectorAll('.life-orb.was-hit')).map(() => 'orb-hit'),
          ...Array.from(document.querySelectorAll('.tray-list.open')).map(() => 'tray-open'),
        ],
      }))
      seen.animations = Math.max(seen.animations, now.running)
      now.effects.forEach((e) => seen.effects.add(e))
      now.piles.forEach((e) => seen.classes.add(e))
      now.marks.forEach((e) => seen.classes.add(e))
      if (i < frames) await page.screenshot({ path: path.join(OUT, `${name}-${i}.jpg`), type: 'jpeg', quality: 70 })
      else await page.waitForTimeout(40)
      if (i > 200) break
    }
  })()
  await action()
  // let the tail of the animation play
  await page.waitForTimeout(500)
  done = true
  await watch
  return seen
}

async function target(seat: Seat, what: 'me' | 'opponent' | string, zone: 'mine' | 'theirs' = 'theirs') {
  const s = await settle(seat)
  if (s.prompt!.method !== 'GAME_TARGET') return
  if (what === 'me' || what === 'opponent') {
    const player = what === 'me' ? me(s) : opponent(s)
    await clickVisible(seat, seat.page.locator(`.life-orb[data-oid="${player.id}"]`))
  } else {
    await clickCard(seat, what, zone)
  }
}

test.beforeAll(() => {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
})

test('dice rolls and coin flips are animated', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Island: 4 }), `hand:${a.name}:Contact Other Plane:1`, `battlefield:${a.name}:Goblin Bangchuckers:1`])
  await cast(a, 'Contact Other Plane')
  const die = await filmed(a.page, '01-die-roll', () => resolveUntil(table, a, 'the roll to resolve', (x) => x.game.stack.length === 0 && x.prompt?.method === 'GAME_SELECT' && x.log.some((l) => /Roll a die/.test(l.message))))
  expect(die.effects).toContain('die')
  expect(die.animations).toBeGreaterThan(0)

  await clickCard(a, 'Goblin Bangchuckers', 'mine')
  await target(a, 'opponent')
  const coin = await filmed(a.page, '02-coin-flip', () => resolveUntil(table, a, 'the flip to resolve', (x) => x.game.stack.length === 0 && x.prompt?.method === 'GAME_SELECT' && x.log.some((l) => /flipped (Heads|Tails)/.test(l.message))))
  expect(coin.effects).toContain('coin')
  await finish(table)
})

test('shuffling, searching the library, and a token coming out of its source are animated', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await cheat(a, [...lands(a, { Forest: 2, Plains: 2 }), `hand:${a.name}:Rampant Growth:1`, `hand:${a.name}:Raise the Alarm:1`])
  await cast(a, 'Rampant Growth')
  const search = await filmed(a.page, '03-search-and-shuffle', async () => {
    const s = await passUntil(table, a, 'the search', (x) => x.prompt?.method === 'GAME_TARGET' && x.prompt.data.cards1?.length > 0)
    const before = s
    await a.page.locator('.modal .card-grid .card:not(.dimmed)').first().click()
    await until(a, 'the pick', (x) => x.prompt?.messageId !== before.prompt!.messageId)
    await passUntil(table, a, 'the shuffle', (x) => x.game.stack.length === 0 && x.prompt?.method === 'GAME_SELECT' && me(x).battlefield.length === 5)
  }, 9)
  expect(search.classes).toContain('searching')
  expect(search.classes).toContain('shuffling')

  await cast(a, 'Raise the Alarm')
  const tokens = await filmed(a.page, '04-tokens-from-source', () => passUntil(table, a, 'the tokens', (x) => me(x).battlefield.filter((c: any) => c.token).length === 2))
  expect(tokens.animations).toBeGreaterThan(0)
  await finish(table)
})

test('counters going on and coming off, and a revealed hand, are animated', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [...lands(a, { Forest: 3, Island: 1 }), `hand:${a.name}:Spike Feeder:1`, `hand:${a.name}:Telepathy:1`, `hand:${b.name}:Grizzly Bears:1`])
  await cast(a, 'Spike Feeder')
  const added = await filmed(a.page, '05-counters-added', () => passUntil(table, a, 'the counters', (x) => findPermanent(x, 'Spike Feeder')?.counters.length === 1 && x.game.stack.length === 0))
  expect(added.animations).toBeGreaterThan(0)

  await clickCard(a, 'Spike Feeder', 'mine')
  let s = await settle(a, [/gain 2 life/])
  const removed = await filmed(a.page, '06-counter-removed', () => passUntil(table, a, 'the life', (x) => me(x).life === 42))
  expect(removed.classes).toContain('counter-change')
  expect(removed.classes).toContain('life-change')

  await cast(a, 'Telepathy')
  const reveal = await filmed(a.page, '07-reveal', () => passUntil(table, a, 'the revealed hand', (x) => x.game.revealed.length === 1 && x.game.stack.length === 0))
  expect(reveal.classes).toContain('tray-open')
  expect(reveal.animations).toBeGreaterThan(0)
  s = await snap(a)
  expect(s.game.revealed[0].cards.length).toBeGreaterThan(0)
  await finish(table)
})

test('discarding, milling, a countered spell and combat damage are animated', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  await cheat(a, [
    ...lands(a, { Island: 5, Swamp: 2 }),
    ...lands(b, { Island: 2 }),
    `hand:${a.name}:Mind Rot:1`,
    `hand:${a.name}:Thought Scour:1`,
    `hand:${a.name}:Air Elemental:1`,
    `hand:${b.name}:Counterspell:1`,
    `battlefield:${a.name}:Craw Wurm:1`,
  ])

  // the opponent discards two cards: their hand shrinks, their graveyard fills
  await clickCard(a, 'Mind Rot', 'hand')
  await target(a, 'opponent')
  await payMana(a)
  const discard = await filmed(a.page, '08-discard', async () => {
    await pass(a)
    // the opponent picks what to discard
    for (let i = 0; i < 6; i++) {
      const s = await until(b, 'a prompt', (x) => (x.prompt && !x.answering ? x : false))
      if (opponent(await snap(a)).graveyard.length >= 2) break
      if (s.prompt!.method === 'GAME_TARGET') {
        await clickVisible(b, b.page.locator('.hand .card.mark-target, .hand .card').first())
        await until(b, 'the pick', (x) => x.prompt?.messageId !== s.prompt!.messageId)
      } else if (s.prompt!.method === 'GAME_SELECT') {
        await pass(b)
      } else {
        await b.page.waitForTimeout(200)
      }
    }
    await until(a, 'two cards in their graveyard', (x) => opponent(x).graveyard.length >= 2)
  }, 9)
  expect(discard.animations).toBeGreaterThan(0)

  // milling: library to graveyard
  await passUntil(table, a, 'priority', (x) => x.prompt?.method === 'GAME_SELECT' && x.game.stack.length === 0)
  await clickCard(a, 'Thought Scour', 'hand')
  await target(a, 'me')
  await payMana(a)
  const mill = await filmed(a.page, '09-mill', () => passUntil(table, a, 'the mill', (x) => me(x).graveyard.filter((c: any) => c.name === 'Wastes').length === 2 && x.game.stack.length === 0))
  expect(mill.animations).toBeGreaterThan(0)

  // a spell is countered: crossed out on its way to the graveyard
  await passUntil(table, a, 'priority', (x) => x.prompt?.method === 'GAME_SELECT' && x.game.stack.length === 0)
  await cast(a, 'Air Elemental')
  await pass(a)
  await waitPrompt(b, 'GAME_SELECT')
  await clickCard(b, 'Counterspell', 'hand')
  const sb = await settle(b)
  if (sb.prompt!.method === 'GAME_TARGET') await clickCard(b, 'Air Elemental', 'stack')
  await payMana(b)
  const countered = await filmed(a.page, '10-countered', () => passUntil(table, a, 'the counter', (x) => x.game.stack.length === 0 && me(x).graveyard.some((c: any) => c.name === 'Air Elemental')), 9)
  expect(countered.effects).toContain('countered')
  expect(countered.classes).toContain('countered-ghost')

  // combat damage: the attacker hits, the life total drops with a jolt
  await passUntil(table, a, 'the attack', (x) => x.prompt?.method === 'GAME_SELECT' && /attackers/i.test(x.prompt.data.message))
  await clickCard(a, 'Craw Wurm', 'mine')
  await a.page.locator('.prompt-buttons .primary').click()
  const hit = await filmed(b.page, '11-combat-damage', () => passUntil(table, b, 'the hit', (x) => me(x).life === 34), 9)
  expect(hit.classes).toContain('orb-hit')
  expect(hit.classes).toContain('life-change')
  await finish(table)
})

test('the turn passing and the phase moving on are animated', async ({ browser }) => {
  const table = await startGame(browser)
  const { a, b } = table
  const marker = () => a.page.locator('.step-marker').evaluate((el) => el.getBoundingClientRect().left)
  const start = await marker()
  const phase = await filmed(a.page, '12-phase-change', async () => {
    const s = await snap(a)
    await pass(a)
    await until(a, 'the next step', (x) => x.game.step !== s.game.step)
  })
  expect(phase.animations).toBeGreaterThan(0)
  expect(await marker()).not.toBe(start)

  const turn = await filmed(a.page, '13-turn-change', () => passUntil(table, b, 'turn 2', (x) => x.game.turn === 2 && x.prompt?.method === 'GAME_SELECT'), 9)
  expect(turn.effects).toContain('turn')
  await expect(a.page.locator('.phase-track.theirs')).toBeVisible()
  await finish(table)
})
