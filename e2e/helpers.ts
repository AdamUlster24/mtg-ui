import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { TEST_SERVER, urlOf, type ServerSpec } from './servers'

export interface Seat {
  page: Page
  context: BrowserContext
  name: string
  server: ServerSpec
  /** console errors and uncaught exceptions seen in this browser */
  problems: string[]
}

export interface Table {
  a: Seat
  b: Seat
  seats: Seat[]
}

/** The parts of the client's state the tests look at (see web/src/store.ts) */
export interface Snap {
  screen: string
  online: boolean
  answering: boolean
  prompt: null | { method: string; messageId: number; data: any }
  game: any
  gameEnd: any
  gameOverMessage: string | null
  log: { message: string }[]
}

export type Zone = 'hand' | 'mine' | 'theirs' | 'stack' | 'command' | 'dialog' | 'any'

const ZONES: Record<Zone, string> = {
  hand: '.hand',
  mine: '.battlefield.mine',
  theirs: '.battlefield.theirs',
  stack: '.stack-zone',
  command: '.player-panel.mine .command-zone',
  dialog: '.modal',
  any: '.game',
}

export const MINIMAL_DECK = ['Commander', '1 Isamaru, Hound of Konda', '', 'Deck', '60 Wastes'].join('\n')

let counter = 0
export const uniqueName = (prefix: string) =>
  `${prefix}${(Date.now() % 100000).toString(36)}${(counter++).toString(36)}`.slice(0, 14)

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- browser / lobby

export async function openSeat(
  browser: Browser,
  server: ServerSpec,
  name: string,
  options: { baseURL?: string; viewport?: { width: number; height: number }; videoDir?: string; password?: string } = {},
): Promise<Seat> {
  const viewport = options.viewport ?? { width: 1600, height: 900 }
  const context = await browser.newContext({
    viewport,
    recordVideo: options.videoDir ? { dir: options.videoDir, size: viewport } : undefined,
  })
  const page = await context.newPage()
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(`exception: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    // art that Scryfall doesn't have falls back to a drawn card, the 404 itself is expected
    if (m.location().url.includes('/img/card')) return
    // dropped connections are part of some tests; the client reports them in its own UI
    if (/WebSocket|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|net::ERR/i.test(m.text())) return
    problems.push(`console: ${m.text()}`)
  })

  await page.goto(options.baseURL ?? urlOf(server))
  const password = options.password ?? server.password
  if (password) {
    await page.locator('input[type=password]').fill(password)
    await page.keyboard.press('Enter')
  }
  await page.locator('.gate input[type=text]').fill(name)
  await page.keyboard.press('Enter')
  await expect(page.locator('.lobby')).toBeVisible()
  return { page, context, name, server, problems }
}

export async function enterDeck(seat: Seat, deck: string) {
  await seat.page.locator('.lobby textarea').fill(deck)
  await expect(seat.page.locator('.deck-status.good')).toBeVisible()
}

export interface StartOptions {
  server?: ServerSpec
  deckA?: string
  deckB?: string
  viewport?: { width: number; height: number }
  videoDir?: string
  baseURL?: string
}

/**
 * Two players through the lobby into a running game: A takes the first turn, both keep their
 * hands, and the function returns when A has priority in the first main phase.
 */
export async function startGame(browser: Browser, options: StartOptions = {}): Promise<Table> {
  const server = options.server ?? TEST_SERVER
  const a = await openSeat(browser, server, uniqueName('ann'), options)
  const b = await openSeat(browser, server, uniqueName('bob'), options)
  await enterDeck(a, options.deckA ?? MINIMAL_DECK)
  await enterDeck(b, options.deckB ?? MINIMAL_DECK)

  await a.page.getByRole('button', { name: 'Create table' }).click()
  await expect(a.page.locator('.seats')).toBeVisible()
  await b.page.locator('.table-row', { hasText: a.name }).getByRole('button', { name: 'Join' }).click()
  await expect(a.page.locator('.seat.taken')).toHaveCount(2)
  await a.page.getByRole('button', { name: 'Start game' }).click()
  await expect(a.page.locator('.game')).toBeVisible({ timeout: 30_000 })
  await expect(b.page.locator('.game')).toBeVisible({ timeout: 30_000 })

  const table = { a, b, seats: [a, b] }
  await preGame(table)
  return table
}

/** Starting player choice and mulligan questions */
export async function preGame(table: Table) {
  const { a } = table
  const deadline = Date.now() + 40_000
  while (Date.now() < deadline) {
    for (const seat of table.seats) {
      const s = await snap(seat)
      const method = s.prompt?.method
      const message = String(s.prompt?.data.message ?? '')
      if (s.answering || !s.game) continue
      if (method === 'GAME_TARGET' && /starting player/i.test(message)) {
        const first = s.game.players.find((p: any) => p.name === a.name)
        await seat.page.locator(`.life-orb[data-oid="${first.id}"]`).click()
        await promptChanged(seat, s)
      } else if (method === 'GAME_ASK' && /mulligan/i.test(message)) {
        await seat.page.locator('.prompt-buttons button', { hasText: 'Keep' }).click()
        await promptChanged(seat, s)
      } else if (method === 'GAME_SELECT' && seat === a && s.game.step === 'PRECOMBAT_MAIN') {
        return
      } else if (method === 'GAME_SELECT') {
        await seat.page.locator('.prompt-buttons .primary').click()
        await promptChanged(seat, s)
      }
    }
    await sleep(100)
  }
  throw new Error('Game did not reach the first main phase')
}

// ---------------------------------------------------------------- state

export function snap(seat: Seat): Promise<Snap> {
  return seat.page.evaluate(() => {
    const s = (window as any).mtgui.store.getState()
    return {
      screen: s.screen,
      online: s.online,
      answering: s.answering,
      prompt: s.prompt,
      game: s.game,
      gameEnd: s.gameEnd,
      gameOverMessage: s.gameOverMessage,
      log: s.log,
    }
  })
}

/** Polls the client state until `test` returns something truthy, and returns that */
export async function until<T>(seat: Seat, what: string, test: (s: Snap) => T | false | null | undefined, timeout = 15_000): Promise<T> {
  const deadline = Date.now() + timeout
  let last: Snap | null = null
  while (Date.now() < deadline) {
    last = await snap(seat)
    const result = test(last)
    if (result) return result
    await sleep(80)
  }
  const prompt = last?.prompt ? `${last.prompt.method} "${last.prompt.data.message ?? ''}"` : 'none'
  throw new Error(`${seat.name}: timed out waiting for ${what} (prompt: ${prompt}, step: ${last?.game?.step})`)
}

/** Waits for the server's reaction to an answer: a newer prompt than `before` */
export async function promptChanged(seat: Seat, before: Snap, timeout = 15_000) {
  const id = before.prompt?.messageId ?? -1
  return until(seat, 'the next prompt', (s) => (s.prompt && s.prompt.messageId !== id && !s.answering ? s : false), timeout)
}

export function waitPrompt(seat: Seat, method: string | RegExp, message?: RegExp, timeout = 15_000): Promise<Snap> {
  return until(
    seat,
    `prompt ${method}${message ? ' ' + message : ''}`,
    (s) => {
      if (!s.prompt || s.answering) return false
      const ok = typeof method === 'string' ? s.prompt.method === method : method.test(s.prompt.method)
      const text = String(s.prompt.data.message ?? s.prompt.data.choice?.message ?? '')
      return ok && (!message || message.test(text)) ? s : false
    },
    timeout,
  )
}

export const me = (s: Snap) => s.game.players.find((p: any) => p.id === s.game.myPlayerId)
export const opponent = (s: Snap) => s.game.players.find((p: any) => p.id !== s.game.myPlayerId)
export const permanents = (s: Snap) => s.game.players.flatMap((p: any) => p.battlefield)
export const findPermanent = (s: Snap, name: string) => permanents(s).find((c: any) => c.name === name)
export const logText = (s: Snap) => s.log.map((l) => l.message.replace(/<[^>]+>/g, '')).join('\n')

// ---------------------------------------------------------------- actions

export function card(seat: Seat, name: string, zone: Zone = 'any'): Locator {
  return seat.page.locator(`${ZONES[zone]} .card[data-name="${name}"]`).first()
}

/**
 * Clicks an element the way a player does: on a spot of it that is actually showing.
 * Cards overlap (a fanned hand, piled lands, attachments), so their centre is often covered.
 */
export async function clickVisible(seat: Seat, target: Locator) {
  await target.waitFor({ state: 'visible' })
  await target.scrollIntoViewIfNeeded()
  // a hand card under the pointer is raised over its neighbours: start from a neutral spot
  await seat.page.mouse.move(4, 4)
  const deadline = Date.now() + 10_000
  for (;;) {
    const point = await target.evaluate((el) => {
      const r = el.getBoundingClientRect()
      for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        for (let x = r.left + 3; x < r.right - 2; x += 4) {
          const y = r.top + r.height * fy
          const hit = document.elementFromPoint(x, y)
          if (hit && el.contains(hit)) return { x, y }
        }
      }
      return null
    })
    if (point) {
      await seat.page.mouse.click(point.x, point.y)
      return
    }
    if (Date.now() > deadline) throw new Error(`${seat.name}: no visible spot to click on ${target}`)
    await sleep(100)
  }
}

/** Clicks a card and waits until the server reacted */
export async function clickCard(seat: Seat, name: string, zone: Zone = 'any') {
  const before = await snap(seat)
  await clickVisible(seat, card(seat, name, zone))
  return promptChanged(seat, before)
}

export async function clickId(seat: Seat, id: string) {
  const before = await snap(seat)
  await clickVisible(seat, seat.page.locator(`[data-oid="${id}"]`).first())
  return promptChanged(seat, before)
}

/** Clicks a button of the prompt bar by its label */
export async function press(seat: Seat, label: string | RegExp) {
  const before = await snap(seat)
  await seat.page.locator('.prompt-buttons button', { hasText: label }).first().click()
  return promptChanged(seat, before)
}

/** Clicks an entry of a choice / ability dialog */
export async function choose(seat: Seat, text: string | RegExp) {
  const before = await snap(seat)
  await seat.page.locator('.modal .option-list button', { hasText: text }).first().click()
  return promptChanged(seat, before)
}

/** Mana sources of the player that can still be tapped, best match for the cost first */
export function manaSources(s: Snap): any[] {
  const cost = String(s.prompt?.data.message ?? '').split('<')[0]
  const colors = [...cost.matchAll(/\{([WUBRG])\}/g)].map((m) => m[1])
  const makes = (c: any, color: string) => c.rules.join(' ').includes(`{${color}}`)
  const sources = me(s).battlefield.filter((c: any) => c.playable && !c.tapped && c.types.includes('LAND'))
  // XMage lets you tap anything, so pick a land that makes a color the cost still needs;
  // generic costs are paid with the land type there is most of, to keep the other colors available
  const copies = (c: any) => sources.filter((o: any) => o.name === c.name).length
  const score = (c: any) => (colors.some((color) => makes(c, color)) ? 100 : 0) + copies(c)
  return sources
    .map((c: any, i: number) => ({ c, i }))
    .sort((x: any, y: any) => score(y.c) - score(x.c) || y.i - x.i)
    .map((x: any) => x.c)
}

/** Taps untapped lands until the cost is paid */
export async function payMana(seat: Seat) {
  for (let i = 0; i < 20; i++) {
    const s = await until(seat, 'a prompt', (x) => (x.prompt && !x.answering ? x : false))
    if (s.prompt!.method !== 'GAME_PLAY_MANA') return s
    const land = manaSources(s)[0]
    if (!land) throw new Error(`${seat.name}: no untapped land left to pay "${s.prompt!.data.message}"`)
    await clickId(seat, land.id)
  }
  throw new Error(`${seat.name}: still paying after 20 lands`)
}

/** Casts a card from hand and pays for it; targets and other choices are up to the caller */
export async function cast(seat: Seat, name: string, zone: Zone = 'hand') {
  await clickCard(seat, name, zone)
  return payMana(seat)
}

/** Passes priority once */
export async function pass(seat: Seat) {
  const s = await waitPrompt(seat, 'GAME_SELECT')
  await seat.page.locator('.prompt-buttons .primary').click()
  await until(seat, 'the pass to register', (x) => x.prompt?.messageId !== s.prompt!.messageId)
}

/**
 * Both players keep passing priority until `done` holds for `watch`.
 * Prompts other than "you have priority" stop it with an error, so nothing is skipped silently.
 */
export async function passUntil(table: Table, watch: Seat, what: string, done: (s: Snap) => unknown, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const state = await snap(watch)
    if (done(state)) return state
    for (const seat of table.seats) {
      const s = seat === watch ? state : await snap(seat)
      if (!s.prompt || s.answering) continue
      if (s.prompt.method === 'GAME_SELECT') {
        await seat.page.locator('.prompt-buttons .primary').click()
        await until(seat, 'the pass to register', (x) => x.prompt?.messageId !== s.prompt!.messageId).catch(() => {})
      } else if (s.prompt.method !== 'GAME_UPDATE_AND_INFORM') {
        throw new Error(`${seat.name}: unexpected prompt while passing: ${s.prompt.method} "${s.prompt.data.message}"`)
      }
    }
    await sleep(60)
  }
  throw new Error(`timed out passing until ${what}`)
}

// ---------------------------------------------------------------- test mode

/**
 * Puts cards straight into zones with XMage's test-mode commands, e.g.
 *   battlefield:<player>:Forest:5   hand:<player>:Giant Growth:1   token:<player>:TreasureToken:2
 * (see ../mage/Mage.Server/release/config/init.example.txt). The seat must have priority.
 */
export async function cheat(seat: Seat, commands: string[]) {
  const dir = path.join(seat.server.runDir, 'config')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'init.txt'), ['[scenario]', ...commands, ''].join('\n'))
  const before = await waitPrompt(seat, 'GAME_SELECT')
  await seat.page.getByRole('button', { name: /More/ }).click()
  await seat.page.getByRole('button', { name: 'Test mode: run commands' }).click()
  await waitPrompt(seat, 'GAME_CHOOSE_CHOICE', /commands group/i)
  await seat.page.locator('.modal .option-list button', { hasText: 'scenario' }).click()
  return until(seat, 'priority after the test commands', (s) =>
    s.prompt?.method === 'GAME_SELECT' && s.prompt.messageId !== before.prompt!.messageId && !s.answering ? s : false,
  )
}

/** Basic lands for both colors of anything a scenario wants to cast */
export const lands = (seat: Seat, types: Record<string, number>) =>
  Object.entries(types).map(([land, count]) => `battlefield:${seat.name}:${land}:${count}`)

// ---------------------------------------------------------------- wrap up

/** Fails the test if a browser logged errors, then leaves the game so the server can drop it */
export async function finish(table: Table) {
  for (const seat of table.seats) {
    expect(seat.problems, `browser errors for ${seat.name}`).toEqual([])
  }
  const { a } = table
  if (!a.page.isClosed()) {
    await a.page
      .evaluate(() => {
        const s = (window as any).mtgui.store.getState()
        if (s.gameInfo && !s.gameEnd) s.action('CONCEDE')
      })
      .catch(() => {})
    await sleep(300)
  }
  for (const seat of table.seats) {
    await seat.context.close()
  }
}

// ---------------------------------------------------------------- dialogs

/** Answers the number picker */
export async function setAmount(seat: Seat, value: number) {
  const before = await waitPrompt(seat, 'GAME_GET_AMOUNT')
  await seat.page.locator('.modal .amount input').fill(String(value))
  await seat.page.locator('.modal footer .primary').click()
  return promptChanged(seat, before)
}

/** Answers the "distribute N among these" dialog, one number per row */
export async function setAmounts(seat: Seat, values: number[]) {
  const before = await waitPrompt(seat, 'GAME_GET_MULTI_AMOUNT')
  const inputs = seat.page.locator('.modal .multi-amount input')
  await expect(inputs).toHaveCount(values.length)
  for (let i = 0; i < values.length; i++) {
    await inputs.nth(i).fill(String(values[i]))
  }
  await seat.page.locator('.modal footer .primary').click()
  return promptChanged(seat, before)
}

/** Picks a card in the card picker dialog (library search, graveyard, piles, revealed cards) */
export async function pickCard(seat: Seat, name: string) {
  const before = await snap(seat)
  await seat.page.locator(`.modal .card-grid .card[data-name="${name}"]`).first().click()
  return promptChanged(seat, before)
}

/** Closes the card picker with its "Done" button */
export async function pickDone(seat: Seat) {
  const before = await snap(seat)
  await seat.page.locator('.modal footer .btn:not(.ghost)').click()
  return promptChanged(seat, before)
}

/** Clicks a player's life orb, e.g. as a target */
export async function clickPlayer(seat: Seat, playerName: string) {
  const s = await snap(seat)
  const player = s.game.players.find((p: any) => p.name === playerName)
  return clickId(seat, player.id)
}

/** True once the card's art has loaded (false: the drawn fallback frame is shown instead) */
export async function hasArt(seat: Seat, locator: Locator, timeout = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const state = await locator.evaluate((el) => {
      const img = el.querySelector('.face img') as HTMLImageElement | null
      if (!img) return el.querySelector('.text-face') ? 'text' : 'none'
      if (el.querySelector('.face.art-loading')) return 'loading'
      return img.complete && img.naturalWidth > 0 ? 'art' : 'loading'
    })
    if (state === 'art') return true
    if (state === 'text') return false
    await sleep(200)
  }
  return false
}
