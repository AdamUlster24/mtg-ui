import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { playToTheEnd } from '../../bot'
import { logText, snap, startGame } from '../../helpers'
import { PLAY_SERVER, ROOT } from '../../servers'

const deck = (name: string) => readFileSync(path.join(ROOT, 'e2e', 'decks', `${name}.txt`), 'utf8')

// Whole games with legal 100-card Commander decks on a server with normal rules (decks are validated,
// nothing is set up by test commands). Two bots click through the real UI until somebody wins.
const MATCHUPS: [string, string][] = [
  ['goblins', 'elves'],
  ['elves', 'soldiers'],
  ['soldiers', 'goblins'],
]

for (const [first, second] of MATCHUPS) {
  test(`full game: ${first} vs ${second}`, async ({ browser }) => {
    const table = await startGame(browser, { server: PLAY_SERVER, deckA: deck(first), deckB: deck(second) })
    const lines: string[] = []
    const report = await playToTheEnd(table, {
      log: (line) => {
        lines.push(line)
        if (/REPEATING/.test(line)) console.log(line)
      },
    })
    console.log(`${first} vs ${second}: ${report.winner} won on turn ${report.turns}\n  prompts: ${JSON.stringify(report.prompts)}\n  ${lines.filter((l) => /REPEATING/.test(l)).concat(lines.slice(-2)).join('\n  ')}`)

    // a real finish: somebody actually lost the game, nobody conceded or was timed out by the server
    const log = logText(await snap(table.a))
    console.log('  how it ended:\n    ' + log.split('\n').filter((l) => l.trim()).slice(-7).join('\n    '))
    expect(log).not.toMatch(/timed out|conceded|has left/i)
    expect(log).toMatch(/has lost the game|has won the game/i)

    // both players see the result, and no browser logged an error on the way
    const [a, b] = table.seats
    const titles = [await a.page.locator('.modal h3').textContent(), await b.page.locator('.modal h3').textContent()]
    expect(titles.sort()).toEqual(['Defeat', 'Victory'])
    for (const seat of table.seats) {
      expect(seat.problems, `browser errors for ${seat.name}`).toEqual([])
      await seat.page.getByRole('button', { name: 'Back to lobby' }).click()
      await expect(seat.page.locator('.lobby')).toBeVisible()
      await seat.context.close()
    }
  })
}
