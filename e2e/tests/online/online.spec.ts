import { expect, test, type WebSocketRoute } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, openSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { playToTheEnd } from '../../bot'
import { clickVisible, logText, me, snap, startGame, until } from '../../helpers'
import { ONLINE_SERVER, ROOT } from '../../servers'

// The real thing: scripts/play-online.sh starts a server and a public tunnel, and two browsers play
// each other through the public link (not through localhost).

const deck = (name: string) => readFileSync(path.join(ROOT, 'e2e', 'decks', `${name}.txt`), 'utf8')
const infoFile = path.join(ONLINE_SERVER.runDir, 'online.json')
let script: ChildProcess
let link = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(6 * 60_000)
  rmSync(infoFile, { force: true })
  const log = openSync(path.join(ROOT, 'e2e', 'test-results', 'play-online.out'), 'w')
  script = spawn(path.join(ROOT, 'scripts', 'play-online.sh'), [], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      SKIP_BUILD: process.env.E2E_SKIP_BUILD ?? '0',
      RUN_DIR: ONLINE_SERVER.runDir,
      GATEWAY_PORT: String(ONLINE_SERVER.port),
      XMAGE_PORT: String(ONLINE_SERVER.xmagePort),
      GATEWAY_PASSWORD: ONLINE_SERVER.password,
      GATEWAY_HEAP: '2g',
    },
  })
  // the script writes the link once the tunnel answers
  const deadline = Date.now() + 5 * 60_000
  while (!existsSync(infoFile)) {
    if (Date.now() > deadline) throw new Error('play-online.sh did not come up, see e2e/test-results/play-online.out')
    await new Promise((r) => setTimeout(r, 1000))
  }
  const info = JSON.parse(readFileSync(infoFile, 'utf8'))
  expect(info.password).toBe(ONLINE_SERVER.password)
  expect(info.url).toMatch(/^https:\/\//)
  link = info.url
  console.log(`public link: ${link}`)
})

test.afterAll(() => {
  if (script?.pid) {
    try {
      process.kill(-script.pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
})

test('the script printed the link and the password to share', () => {
  const out = readFileSync(path.join(ROOT, 'e2e', 'test-results', 'play-online.out'), 'utf8')
  expect(out).toContain(`Link:      ${link}`)
  expect(out).toContain(`Password:  ${ONLINE_SERVER.password}`)
})

test('a wrong password is rejected', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(link)
  await page.locator('input[type=password]').fill('not-the-password')
  await page.keyboard.press('Enter')
  await expect(page.locator('.gate .deck-error')).toHaveText('Wrong password')
  // still at the door: no name prompt, no lobby
  await expect(page.locator('input[type=password]')).toBeVisible()
  await expect(page.locator('.lobby')).toHaveCount(0)

  // nothing behind it is reachable without the password either
  const refused = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
        ws.onopen = () => ws.send(JSON.stringify({ id: 1, cmd: 'login', username: 'intruder' }))
        ws.onmessage = (e) => resolve(JSON.parse(e.data))
      }),
  )
  expect(refused).toMatchObject({ ok: false })

  await page.locator('input[type=password]').fill(ONLINE_SERVER.password)
  await page.keyboard.press('Enter')
  await expect(page.locator('.gate input[type=text]')).toBeVisible()
  await context.close()
})

test('a game through the public link survives a dropped connection and a reload', async ({ browser }) => {
  test.setTimeout(20 * 60_000)
  // Chromium's "offline" switch leaves open websockets alone, so the test sits on player A's
  // connection itself: it can cut it and keep it down, like a wifi dropout does
  const line = { down: false, sockets: [] as WebSocketRoute[] }
  const table = await startGame(browser, {
    server: ONLINE_SERVER,
    baseURL: link,
    deckA: deck('goblins'),
    deckB: deck('soldiers'),
    prepare: async (context, name) => {
      if (!name.startsWith('ann')) return
      await context.routeWebSocket(/\/ws$/, (ws) => {
        if (line.down) {
          void ws.close()
          return
        }
        ws.connectToServer()
        line.sockets.push(ws)
      })
    },
  })
  const { a, b } = table
  expect(new URL(a.page.url()).host).toBe(new URL(link).host)

  // a first move, so there is something on the table
  let s = await snap(a)
  const land = s.game.hand.find((c: any) => c.playable && c.types.includes('LAND'))
  if (land) {
    await clickVisible(a, a.page.locator(`.hand [data-card-id="${land.id}"]`))
    await until(a, 'the land on the battlefield', (x) => me(x).battlefield.length === 1 && x.prompt?.method === 'GAME_SELECT')
  }
  s = await snap(a)
  const permanents = me(s).battlefield.length
  const logLines = s.log.length

  // the connection drops: the client says so, comes back on its own, and nothing is lost
  line.down = true
  await a.context.setOffline(true)
  await Promise.all(line.sockets.map((ws) => ws.close()))
  await expect(a.page.locator('.offline')).toBeVisible({ timeout: 30_000 })
  // it stays down for a while; the client keeps trying
  await a.page.waitForTimeout(4000)
  await expect(a.page.locator('.offline')).toBeVisible()
  line.down = false
  await a.context.setOffline(false)
  await expect(a.page.locator('.offline')).toHaveCount(0, { timeout: 30_000 })
  s = await until(a, 'the game after reconnecting', (x) => (x.online && x.screen === 'game' && x.prompt?.method === 'GAME_SELECT' && !x.answering ? x : false), 30_000)
  expect(me(s).battlefield.length).toBe(permanents)
  expect(s.log.length).toBeGreaterThanOrEqual(logLines)

  // and the reconnected player can keep playing: passing priority moves the game on
  const step = s.game.step
  await a.page.locator('.prompt-buttons .primary').click()
  await until(a, 'the game to move on', (x) => x.game.step !== step || x.prompt?.messageId !== s.prompt!.messageId, 20_000)

  // the other player reloads the page in the middle of the game
  await b.page.reload()
  await expect(b.page.locator('.game')).toBeVisible({ timeout: 30_000 })
  const reloaded = await until(b, 'the board after the reload', (x) => (x.game && x.game.players.length === 2 ? x : false), 30_000)
  expect(reloaded.game.players.find((p: any) => p.name === a.name).battlefield.length).toBe(permanents)
  expect(reloaded.log.length).toBeGreaterThan(0)

  // then the whole game is played out over the tunnel
  const report = await playToTheEnd(table)
  console.log(`online game: ${report.winner} won on turn ${report.turns}, prompts ${JSON.stringify(report.prompts)}`)
  const log = logText(await snap(a))
  expect(log).not.toMatch(/timed out|conceded/i)
  const titles = [await a.page.locator('.modal h3').textContent(), await b.page.locator('.modal h3').textContent()]
  expect(titles.sort()).toEqual(['Defeat', 'Victory'])
  for (const seat of table.seats) {
    expect(seat.problems, `browser errors for ${seat.name}`).toEqual([])
    await seat.context.close()
  }
})
