import type { Locator } from '@playwright/test'
import { clickVisible, me, opponent, sleep, snap, type Seat, type Snap, type Table } from './helpers'

/**
 * A simple player that drives the real UI: plays a land, casts what it can, attacks with everything,
 * never blocks, and answers every dialog XMage throws at it. It is not smart; its job is to get
 * through whole games so that every kind of prompt shows up and has to work.
 */

export interface GameReport {
  turns: number
  winner: string
  /** how often each kind of prompt was answered */
  prompts: Record<string, number>
}

interface Memory {
  /** cards that could not be paid for this turn */
  failed: Set<string>
  casting: string | null
  turn: number
  /** actions taken in the current step, to break out of loops */
  stepKey: string
  stepActions: number
  lastMessage: string
  repeats: number
  answered: number
  /** planeswalkers already activated this turn, spells this player put on the stack, stacks already answered */
  activated: Set<string>
  mine: Set<string>
  responded: Set<string>
}

const text = (s: Snap) => String(s.prompt?.data.message ?? s.prompt?.data.choice?.message ?? '').replace(/<[^>]+>/g, ' ')

async function clickFirst(seat: Seat, target: Locator): Promise<boolean> {
  if ((await target.count()) === 0) return false
  await clickVisible(seat, target.first())
  return true
}

const promptButton = (seat: Seat, label?: string | RegExp) =>
  label ? seat.page.locator('.prompt-buttons button', { hasText: label }) : seat.page.locator('.prompt-buttons button')

const byId = (seat: Seat, id: string) => seat.page.locator(`[data-oid="${id}"], .modal [data-card-id="${id}"]`)

/** Untapped permanents that can make mana for the cost being paid, best first */
function manaSources(s: Snap): any[] {
  const cost = text(s).split('  ')[0]
  const colors = [...cost.matchAll(/\{([WUBRG])\}/g)].map((m) => m[1])
  const sources = me(s).battlefield.filter((c: any) => c.playable && !c.tapped && /Add \{|add one mana|mana of any/i.test(c.rules.join(' ')))
  const score = (c: any) => (colors.some((color) => c.rules.join(' ').includes(`{${color}}`)) ? 10 : 0) + (c.types.includes('LAND') ? 1 : 0)
  return sources
    .map((c: any, i: number) => ({ c, i }))
    .sort((x: any, y: any) => score(y.c) - score(x.c) || y.i - x.i)
    .map((x: any) => x.c)
}

async function act(seat: Seat, s: Snap, mem: Memory): Promise<void> {
  const prompt = s.prompt!
  const data = prompt.data
  const message = text(s)
  const page = seat.page

  switch (prompt.method) {
    case 'GAME_ASK': {
      if (/mulligan/i.test(message)) {
        await clickFirst(seat, promptButton(seat, 'Keep'))
        return
      }
      // say yes, but not forever if the same question keeps coming back
      const buttons = promptButton(seat)
      await clickVisible(seat, mem.repeats >= 2 ? buttons.last() : buttons.first())
      return
    }

    case 'GAME_TARGET': {
      const chosen = (data.options?.chosenTargets as string[] | undefined) ?? []
      // several of my triggers at once: any order will do
      if (await clickFirst(seat, page.locator('.modal .trigger-order .trigger .card'))) return
      const dialog = page.locator('.modal .card-grid')
      if ((await dialog.count()) > 0) {
        const done = page.locator('.modal footer .btn:not(.ghost)')
        if (chosen.length > 0 && (await done.count()) > 0) {
          await clickVisible(seat, done.first())
        } else if (!(await clickFirst(seat, page.locator('.modal .card-grid .card:not(.dimmed):not(.mark-selected)')))) {
          await clickFirst(seat, done)
        }
        return
      }
      const stop = promptButton(seat)
      if ((chosen.length > 0 || mem.repeats >= 3) && (await stop.count()) > 0) {
        await clickVisible(seat, stop.first())
        return
      }
      // aim at the opponent and their things when that is possible
      const targets = ((data.targets as string[]) ?? []).filter((id) => !chosen.includes(id))
      const theirs = new Set<string>([opponent(s).id, ...opponent(s).battlefield.map((c: any) => c.id)])
      const creature = opponent(s).battlefield.find((c: any) => targets.includes(c.id) && c.types.includes('CREATURE'))
      const order = [creature?.id, ...targets.filter((id) => theirs.has(id)), ...targets].filter(Boolean) as string[]
      for (const id of order) {
        if (await clickFirst(seat, byId(seat, id))) return
      }
      if (await clickFirst(seat, page.locator('.game .mark-target'))) return
      await clickFirst(seat, stop)
      return
    }

    case 'GAME_SELECT': {
      if (/attackers/i.test(message)) {
        const all = promptButton(seat, 'All attack')
        if (s.game.combat.length === 0 && mem.stepActions < 2 && (await all.count()) > 0) {
          await clickVisible(seat, all.first())
        } else {
          await clickVisible(seat, page.locator('.prompt-buttons .primary'))
        }
        return
      }
      const myTurn = s.game.activePlayerId === s.game.myPlayerId
      const main = s.game.step === 'PRECOMBAT_MAIN' || s.game.step === 'POSTCOMBAT_MAIN'
      // the opponent's spell is on the stack: answer it with a counterspell when there is one
      const top = s.game.stack[0]
      if (top && !myTurn && !top.isAbility && !mem.mine.has(top.id) && !mem.responded.has(top.id)) {
        mem.responded.add(top.id)
        const counter = s.game.hand.find((c: any) => c.playable && /counter target/i.test(c.rules.join(' ')))
        if (counter) {
          mem.casting = counter.id
          await clickVisible(seat, page.locator(`.hand [data-card-id="${counter.id}"]`).first())
          return
        }
      }
      if (myTurn && main && s.game.stack.length === 0 && !/blockers/i.test(message) && mem.stepActions < 25) {
        const options = [...s.game.hand, ...me(s).commandZone].filter((c: any) => c.playable && !mem.failed.has(c.id))
        const land = options.find((c: any) => c.types.includes('LAND'))
        const spell = options.filter((c: any) => !c.types.includes('LAND')).sort((x: any, y: any) => y.manaValue - x.manaValue)[0]
        // a planeswalker gets one loyalty ability per turn
        const walker = me(s).battlefield.find((c: any) => c.playable && c.types.includes('PLANESWALKER') && !mem.activated.has(c.id))
        if (!land && walker && mem.stepActions < 10) {
          mem.activated.add(walker.id)
          await clickVisible(seat, byId(seat, walker.id).first())
          return
        }
        const pick = land ?? spell
        if (pick) {
          mem.casting = pick.id
          // a card that turns out not to be castable (no targets, ...) must not be tried forever
          mem.failed.add(pick.id)
          await clickVisible(seat, page.locator(`.hand [data-card-id="${pick.id}"], .command-zone [data-card-id="${pick.id}"]`).first())
          return
        }
      }
      await clickVisible(seat, page.locator('.prompt-buttons .primary'))
      return
    }

    case 'GAME_PLAY_MANA': {
      const source = manaSources(s)[0]
      if (source && mem.stepActions < 60) {
        await clickVisible(seat, byId(seat, source.id).first())
      } else {
        await clickFirst(seat, promptButton(seat, 'Cancel'))
      }
      return
    }

    case 'GAME_PLAY_XMANA':
      await clickFirst(seat, promptButton(seat))
      return

    case 'GAME_CHOOSE_ABILITY':
    case 'GAME_CHOOSE_CHOICE':
      await clickFirst(seat, page.locator('.modal .option-list button'))
      return

    case 'GAME_GET_AMOUNT': {
      const min = data.min ?? 0
      const max = data.max ?? 0
      await page.locator('.modal .amount input').fill(String(Math.max(min, Math.min(max, 1))))
      await clickVisible(seat, page.locator('.modal footer .primary'))
      return
    }

    case 'GAME_GET_MULTI_AMOUNT': {
      const rows: { min: number; max: number }[] = data.multiAmount ?? []
      const values = rows.map((r) => r.min)
      let missing = (data.min ?? 0) - values.reduce((a, b) => a + b, 0)
      for (let i = 0; i < rows.length && missing > 0; i++) {
        const add = Math.min(missing, rows[i].max - values[i])
        values[i] += add
        missing -= add
      }
      const inputs = page.locator('.modal .multi-amount input')
      for (let i = 0; i < values.length; i++) {
        await inputs.nth(i).fill(String(values[i]))
      }
      await clickVisible(seat, page.locator('.modal footer .primary'))
      return
    }

    case 'GAME_CHOOSE_PILE':
      await clickFirst(seat, page.locator('.modal .piles-choice button'))
      return
  }
}

/**
 * Plays the game on the table to its end. Throws when nothing moves for a minute
 * (a prompt the UI can't answer) or when the game drags on past `maxTurns`.
 */
export async function playToTheEnd(table: Table, options: { maxTurns?: number; maxMinutes?: number; log?: (line: string) => void } = {}): Promise<GameReport> {
  const maxTurns = options.maxTurns ?? 80
  const prompts: Record<string, number> = {}
  const memory = new Map<Seat, Memory>()
  for (const seat of table.seats) {
    memory.set(seat, { failed: new Set(), casting: null, turn: 0, stepKey: '', stepActions: 0, lastMessage: '', repeats: 0, answered: -1, activated: new Set(), mine: new Set(), responded: new Set() })
  }
  let progress = Date.now()
  let lastTurn = 0
  const started = Date.now()
  const maxMinutes = options.maxMinutes ?? 20

  for (;;) {
    for (const seat of table.seats) {
      const s = await snap(seat)
      const mem = memory.get(seat)!
      if (s.gameEnd) {
        const other = table.seats.find((x) => x !== seat)!
        const end = await waitForEnd(other)
        const winner = s.gameEnd.won ? seat.name : end.gameEnd.won ? other.name : 'nobody'
        return { turns: s.game?.turn ?? lastTurn, winner, prompts }
      }
      if (!s.game || !s.prompt || s.answering) continue
      if (s.game.turn !== lastTurn) {
        lastTurn = s.game.turn
        options.log?.(`turn ${lastTurn}: ${s.game.players.map((p: any) => `${p.name} ${p.life} life, ${p.battlefield.length} permanents`).join(' | ')}`)
        if (lastTurn > maxTurns) throw new Error(`game still running after ${maxTurns} turns`)
      }
      if (s.prompt.method === 'GAME_UPDATE_AND_INFORM' || s.prompt.method === 'GAME_OVER') continue
      if (s.prompt.messageId === mem.answered) continue

      if (mem.turn !== s.game.turn) {
        mem.turn = s.game.turn
        mem.failed.clear()
        mem.activated.clear()
      }
      const stepKey = `${s.game.turn}/${s.game.step}/${s.game.stack.length}`
      mem.stepActions = stepKey === mem.stepKey ? mem.stepActions + 1 : 0
      mem.stepKey = stepKey
      const message = `${s.prompt.method} ${text(s)}`
      mem.repeats = message === mem.lastMessage ? mem.repeats + 1 : 0
      mem.lastMessage = message
      if (s.prompt.method === 'GAME_SELECT' && mem.casting && s.game.stack.length > 0) {
        // the last pick made it onto the stack: it was fine
        mem.failed.delete(mem.casting)
        mem.mine.add(mem.casting)
        mem.casting = null
      }

      if (mem.repeats === 4 || mem.repeats === 12) {
        const d = s.prompt.data
        options.log?.(
          `REPEATING for ${seat.name}: ${message} | targets ${JSON.stringify(d.targets)} chosen ${JSON.stringify(d.options?.chosenTargets)} required ${d.required} ` +
            `cards1 ${d.cards1?.length} buttons ${JSON.stringify(await seat.page.locator('.prompt-buttons button').allTextContents())} modal ${await seat.page.locator('.modal').count()}`,
        )
      }
      if (mem.repeats > 40) throw new Error(`${seat.name} is going in circles on: ${message}`)

      prompts[s.prompt.method] = (prompts[s.prompt.method] ?? 0) + 1
      mem.answered = s.prompt.messageId
      progress = Date.now()
      await act(seat, s, mem)
      // give the server a moment to answer before looking at the other seat
      const deadline = Date.now() + 4000
      while (Date.now() < deadline) {
        const now = await snap(seat)
        if (now.gameEnd || (now.prompt?.messageId !== s.prompt.messageId && !now.answering)) break
        await sleep(40)
      }
      const after = await snap(seat)
      if (after.prompt?.messageId === s.prompt.messageId && !after.gameEnd) {
        // nothing came back (e.g. a click the server ignored): allow answering the same prompt again
        mem.answered = -1
        mem.repeats += 1
      }
    }
    if (Date.now() - started > maxMinutes * 60_000) throw new Error(`game still running after ${maxMinutes} minutes (turn ${lastTurn})`)
    if (Date.now() - progress > 60_000) {
      const states = await Promise.all(table.seats.map(async (seat) => `${seat.name}: ${JSON.stringify((await snap(seat)).prompt?.method)} "${text(await snap(seat))}"`))
      throw new Error(`no prompt was answered for a minute\n${states.join('\n')}`)
    }
    await sleep(30)
  }
}

async function waitForEnd(seat: Seat): Promise<Snap> {
  const deadline = Date.now() + 20_000
  for (;;) {
    const s = await snap(seat)
    if (s.gameEnd) return s
    if (Date.now() > deadline) throw new Error(`${seat.name} never got the result of the game`)
    await sleep(100)
  }
}
