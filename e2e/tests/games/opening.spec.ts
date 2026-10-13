import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { finish, logText, snap, startGame } from '../../helpers'
import { PLAY_SERVER, ROOT } from '../../servers'

const deck = (name: string) => readFileSync(path.join(ROOT, 'e2e', 'decks', `${name}.txt`), 'utf8')

test('both players roll a d20 and the higher roll takes the first turn', async ({ browser }) => {
  const table = await startGame(browser, {
    server: PLAY_SERVER,
    deckA: deck('goblins'),
    deckB: deck('elves'),
    // note every die that is shown, from the first moment of the page
    prepare: async (context) => {
      await context.addInitScript(() => {
        ;(window as any).__dice = []
        new MutationObserver(() => {
          for (const el of document.querySelectorAll('[data-effect="opening"] .opening-player')) {
            const text = `${el.textContent}${el.classList.contains('won') ? ' won' : ''}`
            if (!(window as any).__dice.includes(text)) (window as any).__dice.push(text)
          }
        }).observe(document, { childList: true, subtree: true })
      })
    },
  })
  const { a, b } = table
  const log = logText(await snap(a))
  const rolls = [...log.matchAll(/\[Roll a die\] (\S+) rolled a d20, result: (\d+)/g)].map((m) => ({ name: m[1], roll: Number(m[2]) }))
  // one roll each, more only after a tie
  expect(rolls.length).toBeGreaterThanOrEqual(2)
  expect(rolls.length % 2).toBe(0)
  const [first, second] = rolls.slice(-2)
  expect([first.name, second.name].sort()).toEqual([a.name, b.name].sort())
  expect(first.roll).not.toBe(second.roll)
  for (const r of rolls) expect(r.roll >= 1 && r.roll <= 20).toBe(true)
  const winner = first.roll > second.roll ? first.name : second.name
  expect(log).toContain(`${winner} rolled higher and takes the first turn`)
  expect(log).toMatch(new RegExp(`TURN 1 for ${winner}`))
  // nobody was asked to pick, and XMage's coin toss is not mentioned
  expect(log).not.toMatch(/won the toss|chooses that/)

  // the other player saw the same rolls, and both saw dice on the table
  const theirs = logText(await snap(b))
  for (const r of rolls) expect(theirs).toContain(`${r.name} rolled a d20, result: ${r.roll}`)
  for (const seat of [a, b]) {
    const shown: string[] = await seat.page.evaluate(() => (window as any).__dice)
    expect(shown.sort()).toEqual([first, second].map((r) => `${r.roll}${r.name}${r.name === winner ? ' won' : ''}`).sort())
  }

  // after a reload the rolls are still in the log
  await a.page.reload()
  await expect(a.page.locator('.game')).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => logText(await snap(a))).toContain(`${winner} rolled higher and takes the first turn`)
  await finish(table)
})
