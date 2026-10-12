import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { cheat, clickVisible, finish, payMana, snap, startGame, until } from '../../helpers'
import { ROOT } from '../../servers'

const OUT = path.join(ROOT, 'docs', 'captures', 'layout')
const SIZES = [
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
]

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const boxes = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })) as Promise<Box[]>
const overlap = (a: Box, b: Box) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 2 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 2

/** How many pixels of an element can actually be seen and clicked along its middle line and its top edge */
const visibleStrip = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const r = (el.querySelector('.card-body') ?? el).getBoundingClientRect()
      let best = 0
      for (const fy of [0.12, 0.5]) {
        let seen = 0
        for (let x = r.left + 1; x < r.right; x += 2) {
          const hit = document.elementFromPoint(x, r.top + r.height * fy)
          if (hit && el.contains(hit)) seen += 2
        }
        best = Math.max(best, seen)
      }
      return best
    }),
  )

async function checkStack(page: Page, size: { width: number; height: number }, count: number, label: string) {
  const zone = (await boxes(page, '.stack-box'))[0]
  const problems: string[] = []
  if (zone.y < 0 || zone.y + zone.h > size.height || zone.x < 0 || zone.x + zone.w > size.width) problems.push('the stack leaves the screen')
  for (const panel of await boxes(page, '.player-panel, .prompt-bar')) {
    if (overlap(zone, panel)) problems.push('the stack covers a player panel or the prompt')
  }
  const cards = await boxes(page, '.stack-zone .card')
  expect(cards).toHaveLength(count)
  for (const [i, c] of cards.entries()) {
    if (c.y < -1 || c.y + c.h > size.height + 1) problems.push(`stack item ${i} leaves the screen`)
  }
  // every item keeps a strip of its own (its title), the one that resolves next is complete
  const strips = await page.locator('.stack-zone .stack-slot').evaluateAll((slots) => slots.map((slot, i) => (i === slots.length - 1 ? 999 : slots[i + 1].getBoundingClientRect().top - slot.getBoundingClientRect().top)))
  strips.forEach((strip, i) => {
    if (strip < 14) problems.push(`stack item ${i} shows only ${Math.round(strip)}px`)
  })
  expect(problems, `${label}: stack layout`).toEqual([])
}

async function checkHand(page: Page, size: { width: number; height: number }, count: number, label: string) {
  const problems: string[] = []
  const cards = await boxes(page, '.hand .card')
  expect(cards).toHaveLength(count)
  const panels = await boxes(page, '.strip.bottom .player-panel, .prompt-bar')
  const table = (await boxes(page, '.table'))[0]
  for (const [i, c] of cards.entries()) {
    if (c.x < table.x - 1 || c.x + c.w > table.x + table.w + 1) problems.push(`hand card ${i} leaves the table`)
    if (panels.some((p) => overlap(c, p))) problems.push(`hand card ${i} covers the player panel or the prompt`)
  }
  for (const [i, strip] of (await visibleStrip(page, '.hand .card')).entries()) {
    if (strip < 12) problems.push(`hand card ${i} shows only ${strip}px`)
  }
  expect(problems, `${label}: hand layout`).toEqual([])
}

for (const size of SIZES) {
  test(`stack with 1, 5 and 12 items stays readable at ${size.width}x${size.height}`, async ({ browser }) => {
    mkdirSync(OUT, { recursive: true })
    const table = await startGame(browser, { viewport: size })
    const { a } = table
    await cheat(a, [`battlefield:${a.name}:Island:12`, `hand:${a.name}:Opt:12`])
    let onStack = 0
    for (const count of [1, 5, 12]) {
      // instants; the caster keeps priority, so they pile up
      while (onStack < count) {
        const s = await snap(a)
        const next = s.game.hand.find((c: any) => c.name === 'Opt')
        await clickVisible(a, a.page.locator(`.hand [data-card-id="${next.id}"]`))
        await payMana(a)
        onStack++
        await until(a, `${onStack} spells on the stack`, (x) => x.game.stack.length === onStack && x.prompt?.method === 'GAME_SELECT' && !x.answering)
      }
      await a.page.mouse.move(4, 4)
      await a.page.waitForTimeout(700)
      await checkStack(a.page, size, count, `${size.width}x${size.height}, ${count} on the stack`)
      await a.page.screenshot({ path: path.join(OUT, `${size.width}x${size.height}-stack-${String(count).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 80 })
    }
    // pointing at a covered item brings all of it into view
    await clickVisible(a, a.page.locator('.stack-zone .stack-slot').nth(6).locator('.card'), true)
    await a.page.waitForTimeout(400)
    const shown = (await boxes(a.page, '.stack-zone .stack-slot:nth-child(7) .card'))[0]
    expect(shown.y).toBeGreaterThanOrEqual(-1)
    expect(shown.y + shown.h).toBeLessThanOrEqual(size.height + 1)
    await expect(a.page.locator('.preview')).toBeVisible()
    await a.page.screenshot({ path: path.join(OUT, `${size.width}x${size.height}-stack-12-hover.jpg`), type: 'jpeg', quality: 80 })
    await finish(table)
  })

  test(`hand with 1, 7 and 15 cards stays readable at ${size.width}x${size.height}`, async ({ browser }) => {
    mkdirSync(OUT, { recursive: true })
    const table = await startGame(browser, { viewport: size, tableOptions: { startHandSize: 1 } })
    const { a } = table
    let inHand = 1
    for (const count of [1, 7, 15]) {
      if (count > inHand) {
        await cheat(a, [`hand:${a.name}:Grizzly Bears:${count - inHand}`])
        inHand = count
      }
      await until(a, `${count} cards in hand`, (x) => x.game.hand.length === count)
      await a.page.mouse.move(4, 4)
      await a.page.waitForFunction(() => document.querySelectorAll('.hand .face.art-loading').length === 0, null, { timeout: 60_000 })
      await a.page.waitForTimeout(700)
      await checkHand(a.page, size, count, `${size.width}x${size.height}, ${count} in hand`)
      await a.page.screenshot({ path: path.join(OUT, `${size.width}x${size.height}-hand-${String(count).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 80 })
    }
    // the card under the pointer comes up whole
    const slot = a.page.locator('.hand .hand-slot').nth(7)
    await slot.hover({ position: { x: 6, y: 40 } })
    await a.page.waitForTimeout(400)
    const raised = (await boxes(a.page, '.hand .hand-slot:nth-child(8) .card'))[0]
    expect(raised.y).toBeGreaterThanOrEqual(-1)
    expect(raised.y + raised.h).toBeLessThanOrEqual(size.height + 1)
    await a.page.screenshot({ path: path.join(OUT, `${size.width}x${size.height}-hand-15-hover.jpg`), type: 'jpeg', quality: 80 })
    await finish(table)
  })
}
