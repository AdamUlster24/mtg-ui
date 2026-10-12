import { expect, test, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import {
  cast,
  cheat,
  choose,
  clickCard,
  finish,
  findPermanent,
  lands,
  me,
  opponent,
  pass,
  passUntil,
  payMana,
  press,
  startGame,
  until,
  waitPrompt,
} from '../../helpers'
import { ROOT } from '../../servers'

const OUT = path.join(ROOT, 'docs', 'captures', 'animations')
let step = 0

/** A few frames in quick succession while `action` plays out, to look at the motion itself */
async function filmed<T>(page: Page, name: string, action: () => Promise<T>, frames = 6): Promise<T> {
  const prefix = path.join(OUT, `${String(++step).padStart(2, '0')}-${name}`)
  const running = action()
  for (let i = 0; i < frames; i++) {
    await page.screenshot({ path: `${prefix}-${i}.jpg`, type: 'jpeg', quality: 70 })
  }
  return running
}

/** True while something on the page is mid-animation (Web Animations, CSS or layout) */
const moving = (page: Page) =>
  page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && (a.effect?.getTiming().iterations ?? 1) !== Infinity).length)

test('every zone change, life change, tap and attack is animated', async ({ browser }) => {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  const videoDir = path.join(OUT, '.video')
  const table = await startGame(browser, { videoDir })
  const { a, b } = table
  await cheat(a, [
    ...lands(a, { Forest: 3, Mountain: 1, Plains: 1, Island: 1 }),
    ...lands(b, { Mountain: 1 }),
    `battlefield:${a.name}:Craw Wurm:1`,
    `battlefield:${a.name}:Jace Beleren:1`,
    `battlefield:${b.name}:Savannah Lions:1`,
    `battlefield:${b.name}:Elite Vanguard:1`,
    `battlefield:${b.name}:Hill Giant:1`,
    `hand:${a.name}:Grizzly Bears:1`,
    `hand:${a.name}:Shock:1`,
    `hand:${a.name}:Swords to Plowshares:1`,
    `hand:${a.name}:Unsummon:1`,
    `hand:${b.name}:Shock:1`,
  ])
  await a.page.waitForFunction(() => document.querySelectorAll('.game .face.art-loading').length === 0, null, { timeout: 60_000 })
  const seen: Record<string, number> = {}
  const during = async (name: string, page: Page) => {
    seen[name] = Math.max(seen[name] ?? 0, await moving(page))
  }

  // draw: both players draw a card (mine from my library, the opponent's from theirs)
  let s = await until(a, 'state', (x) => x)
  const hand = s.game.hand.length
  await clickCard(a, 'Jace Beleren', 'mine')
  await waitPrompt(a, 'GAME_CHOOSE_ABILITY')
  await choose(a, /Each player draws a card/)
  await filmed(a.page, 'draw', async () => {
    await passUntil(table, a, 'the draw', (x) => x.game.hand.length === hand + 1)
    await during('draw', a.page)
  })

  // cast: hand -> stack
  await filmed(a.page, 'cast', async () => {
    await clickCard(a, 'Grizzly Bears', 'hand')
    await payMana(a)
    await during('cast', a.page)
  })
  await pass(a)

  // the opponent answers from their hand: opponent's hand -> stack, then damage on my creature
  await waitPrompt(b, 'GAME_SELECT')
  await filmed(a.page, 'opponent-casts', async () => {
    await clickCard(b, 'Shock', 'hand')
    await waitPrompt(b, 'GAME_TARGET')
    await clickCard(b, 'Craw Wurm', 'theirs')
    await payMana(b)
    await until(a, 'the opposing spell on my screen', (x) => x.game.stack.length === 2)
    await during('opponent-casts', a.page)
  })
  await filmed(a.page, 'damage', async () => {
    await passUntil(table, a, 'damage on the wurm', (x) => findPermanent(x, 'Craw Wurm')?.damage === 2)
    await during('damage', a.page)
  })
  await expect(a.page.locator('.battlefield.mine .card[data-name="Craw Wurm"] .badge.damage')).toHaveText('2')

  // resolve: stack -> battlefield
  await filmed(a.page, 'resolve', async () => {
    await passUntil(table, a, 'the bears', (x) => findPermanent(x, 'Grizzly Bears'))
    await during('resolve', a.page)
  })

  // die: battlefield -> graveyard pile
  await clickCard(a, 'Shock', 'hand')
  await waitPrompt(a, 'GAME_TARGET')
  await clickCard(a, 'Savannah Lions', 'theirs')
  await payMana(a)
  await filmed(a.page, 'die', async () => {
    await passUntil(table, a, 'the lions in the graveyard', (x) => opponent(x).graveyard.some((c: any) => c.name === 'Savannah Lions'))
    await during('die', a.page)
  })

  // exile: battlefield -> exile pile, and the opponent gains life
  await clickCard(a, 'Swords to Plowshares', 'hand')
  await waitPrompt(a, 'GAME_TARGET')
  await clickCard(a, 'Elite Vanguard', 'theirs')
  await payMana(a)
  await filmed(a.page, 'exile-and-life-gain', async () => {
    await passUntil(table, a, 'the vanguard in exile', (x) => opponent(x).exile.some((c: any) => c.name === 'Elite Vanguard') && opponent(x).life === 42)
    await during('exile', a.page)
  })
  await expect(a.page.locator('.player-panel.theirs .life-change.gained')).toHaveText('+2')

  // bounce: battlefield -> opponent's hand
  s = await until(a, 'state', (x) => x)
  const theirHand = opponent(s).handCount
  await clickCard(a, 'Unsummon', 'hand')
  await waitPrompt(a, 'GAME_TARGET')
  await clickCard(a, 'Hill Giant', 'theirs')
  await payMana(a)
  await filmed(a.page, 'bounce', async () => {
    await passUntil(table, a, 'the giant back in hand', (x) => opponent(x).handCount === theirHand + 1 && !findPermanent(x, 'Hill Giant'))
    await during('bounce', a.page)
  })

  // attack: tap, lunge forward, arrow, then the life total drops
  await passUntil(table, a, 'the attack declaration', (x) => x.prompt?.method === 'GAME_SELECT' && /attackers/i.test(x.prompt.data.message))
  await filmed(a.page, 'attack', async () => {
    await clickCard(a, 'Craw Wurm', 'mine')
    await during('attack', a.page)
    await press(a, 'Attack')
  })
  await filmed(b.page, 'life-loss', async () => {
    await passUntil(table, b, 'the combat damage', (x) => me(x).life === 36)
    await during('life-loss', b.page)
  })
  await expect(b.page.locator('.player-panel.mine .life-change.lost')).toHaveText('−6')
  await expect(a.page.locator('.battlefield.mine .card[data-name="Craw Wurm"]')).toHaveClass(/tapped/)

  // every step had something in motion when it happened
  for (const name of ['draw', 'cast', 'opponent-casts', 'damage', 'resolve', 'die', 'exile', 'bounce', 'attack', 'life-loss']) {
    expect(seen[name], `animations running during "${name}"`).toBeGreaterThan(0)
  }

  const videos = [a.page.video(), b.page.video()]
  await finish(table)
  for (const [i, name] of ['player-a.webm', 'player-b.webm'].entries()) {
    const file = path.join(OUT, name)
    await videos[i]?.saveAs(file)
    // the raw recording is ~10 MB; shrink it if ffmpeg is around so the repo stays small
    const small = path.join(OUT, `small-${name}`)
    const done = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', file, '-vf', 'scale=1280:-2,fps=24', '-c:v', 'libvpx-vp9', '-crf', '40', '-b:v', '0', '-an', small])
    if (done.status === 0) renameSync(small, file)
    else rmSync(small, { force: true })
  }
  rmSync(videoDir, { recursive: true, force: true })
})
