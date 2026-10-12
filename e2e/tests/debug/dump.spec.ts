import { test } from '@playwright/test'
import { startGame } from '../../helpers'

test('dump', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  const out = await a.page.evaluate(async () => {
    const rects: string[] = []
    const sel = ['.prompt-tools button', '.prompt-bar', '.strip.bottom', '.table', '.hand']
    for (let i = 0; i < 6; i++) {
      rects.push(sel.map((s) => { const r = document.querySelector(s)!.getBoundingClientRect(); return `${s}:${r.x.toFixed(2)},${r.y.toFixed(2)},${r.width.toFixed(2)},${r.height.toFixed(2)}` }).join(' | '))
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    }
    return rects
  })
  console.log('RECTS\n' + out.join('\n'))
})
