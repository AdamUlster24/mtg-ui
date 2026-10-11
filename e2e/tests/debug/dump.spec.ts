import { test } from '@playwright/test'
import { clickCard, me, openSeat, snap, startGame, until, finish } from '../../helpers'

test('dump', async ({ browser }) => {
  const table = await startGame(browser)
  const { a } = table
  await clickCard(a, 'Wastes', 'hand')
  let s = await until(a, 'land', (x) => (me(x).battlefield.length === 1 && x.prompt?.method === 'GAME_SELECT' ? x : false))
  await clickCard(a, 'Wastes', 'mine')
  s = await until(a, 'mana', (x) => (me(x).manaPool.C === 1 ? x : false))
  await a.page.evaluate(() => {
    const st = (window as any).mtgui.store
    ;(window as any).seen = []
    st.subscribe((n: any, o: any) => { if (n.game !== o.game) (window as any).seen.push('game changed tapped=' + JSON.stringify(n.game.players.flatMap((p: any) => p.battlefield.map((c: any) => c.tapped)))) })
    return st.getState().request('action', { gameId: st.getState().gameInfo.gameId, action: 'UNDO' })
  })
  await a.page.waitForTimeout(2000)
  console.log('SEEN', JSON.stringify(await a.page.evaluate(() => (window as any).seen)))
  // does answering the prompt wake things up?
  await a.page.locator('.prompt-buttons .primary').click()
  await a.page.waitForTimeout(1500)
  s = await snap(a)
  console.log('AFTER PASS', s.game.step, JSON.stringify(me(s).battlefield.map((c: any) => c.tapped)), 'pool', me(s).manaPool.C, JSON.stringify(await a.page.evaluate(() => (window as any).seen)))
  await finish(table).catch(() => {})
})
