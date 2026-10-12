import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { cheat, finish, startGame, until, me, opponent, type Seat } from '../../helpers'
import { ROOT } from '../../servers'

const OUT = path.join(ROOT, 'docs', 'captures', 'layout')

const SIZES = [
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
]

/** Boards with 5, 15 and 30 permanents per side: lands, creatures, artifacts, enchantments, tokens */
const BOARDS: Record<number, string[]> = {
  5: ['Forest:2', 'Mountain:1', 'Grizzly Bears:1', 'Savannah Lions:1'],
  15: ['Forest:4', 'Mountain:3', 'Karplusan Forest:1', 'Grizzly Bears:1', 'Savannah Lions:1', 'Craw Wurm:1', 'Serra Angel:1', 'Soul Warden:1', 'Sol Ring:1', 'Glorious Anthem:1'],
  30: [
    'Forest:6', 'Mountain:4', 'Plains:3', 'Karplusan Forest:1',
    'Grizzly Bears:1', 'Savannah Lions:1', 'Craw Wurm:1', 'Serra Angel:1', 'Soul Warden:1',
    'Elite Vanguard:1', 'Llanowar Elves:1', 'Shivan Dragon:1', 'Air Elemental:1', 'Hill Giant:1',
    'Sol Ring:1', 'Bonesplitter:1', 'Howling Mine:1', 'Glorious Anthem:1', 'Impact Tremors:1', 'Honor of the Pure:1',
  ],
}

interface Box {
  what: string
  x: number
  y: number
  w: number
  h: number
}

/** Everything that must stay on screen and clear of each other */
async function measure(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element, what: string) => {
      const r = el.getBoundingClientRect()
      return { what, x: r.left, y: r.top, w: r.width, h: r.height }
    }
    const all = (selector: string, what: string) => Array.from(document.querySelectorAll(selector)).map((el, i) => box(el, `${what} ${i}`))
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      table: box(document.querySelector('.table')!, 'table'),
      sections: [
        box(document.querySelector('.strip.top .player-panel')!, 'opponent panel'),
        box(document.querySelector('.battlefield.theirs')!, 'opponent battlefield'),
        box(document.querySelector('.phase-track')!, 'phase track'),
        box(document.querySelector('.battlefield.mine')!, 'my battlefield'),
        box(document.querySelector('.strip.bottom .player-panel')!, 'my panel'),
      ],
      fixed: [box(document.querySelector('.prompt-bar')!, 'prompt bar'), ...all('.player-panel', 'player panel')],
      rows: Array.from(document.querySelectorAll('.bf-row')).map((row, r) => Array.from(row.children).map((el, i) => box(el, `row ${r} slot ${i}`))),
      cards: all('.battlefield .card', 'permanent'),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      overflowY: document.documentElement.scrollHeight > window.innerHeight,
    }
  })
}

const overlap = (a: Box, b: Box) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 2 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 2

async function checkLayout(seat: Seat, label: string) {
  const m = await measure(seat.page)
  const problems: string[] = []
  if (m.overflowX || m.overflowY) problems.push('page scrolls')
  // the vertical order of the table, top to bottom, without overlaps
  for (let i = 1; i < m.sections.length; i++) {
    const above = m.sections[i - 1]
    const below = m.sections[i]
    if (above.y + above.h > below.y + 2) problems.push(`${above.what} overlaps ${below.what} by ${Math.round(above.y + above.h - below.y)}px`)
  }
  for (const b of m.fixed) {
    if (b.x < -1 || b.y < -1 || b.x + b.w > m.viewport.w + 1 || b.y + b.h > m.viewport.h + 1) problems.push(`${b.what} is cut off`)
  }
  const stack = m.table.x + m.table.w
  for (const c of m.cards) {
    if (c.x < m.table.x - 1 || c.x + c.w > stack + 1 || c.y < -1 || c.y + c.h > m.viewport.h + 1) problems.push(`${c.what} leaves the table`)
  }
  // neighbours in a row never cover each other (piles and attachments live inside one slot)
  for (const row of m.rows) {
    for (let i = 1; i < row.length; i++) {
      if (overlap(row[i - 1], row[i])) problems.push(`${row[i - 1].what} overlaps ${row[i].what}`)
    }
  }
  // the two battlefields never run into the hand, the panels or each other
  const [oppPanel, theirs, , mine, myPanel] = m.sections
  for (const c of m.cards) {
    if (overlap(c, oppPanel) || overlap(c, myPanel)) problems.push(`${c.what} covers a player panel`)
  }
  if (overlap(theirs, mine)) problems.push('battlefields overlap')
  expect(problems, `${label}: layout problems`).toEqual([])
}

for (const size of SIZES) {
  test(`layout holds at ${size.width}x${size.height} with 5, 15 and 30 permanents per side`, async ({ browser }) => {
    const table = await startGame(browser, { viewport: size })
    const { a, b } = table
    let previous: string[] = []
    for (const count of [5, 15, 30]) {
      // boards grow: add what the bigger board has on top of the smaller one
      const wanted = BOARDS[count]
      const extra = wanted
        .map((entry) => {
          const [name, n] = entry.split(':')
          const had = Number(previous.find((p) => p.startsWith(name + ':'))?.split(':')[1] ?? 0)
          return [name, Number(n) - had] as const
        })
        .filter(([, n]) => n > 0)
      await cheat(a, extra.flatMap(([name, n]) => [a, b].map((seat) => `battlefield:${seat.name}:${name}:${n}`)))
      previous = wanted
      for (const seat of table.seats) {
        await until(seat, `${count} permanents per side`, (s) => me(s).battlefield.length === count && opponent(s).battlefield.length === count)
        // let the cards settle and the art load (first run fetches it from Scryfall)
        await seat.page.waitForFunction(() => document.querySelectorAll('.battlefield .face.art-loading').length === 0, null, { timeout: 90_000 })
        await seat.page.waitForTimeout(800)
        await checkLayout(seat, `${seat === a ? 'active player' : 'opponent'} ${size.width}x${size.height} ${count}`)
      }
      await a.page.screenshot({ path: path.join(OUT, `${size.width}x${size.height}-${String(count).padStart(2, '0')}-permanents.jpg`), type: 'jpeg', quality: 80 })
    }
    await finish(table)
  })
}
