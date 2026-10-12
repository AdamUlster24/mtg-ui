import { createContext, useContext } from 'react'
import type { Card, Prompt } from '../protocol/types'

export type Mark = 'target' | 'playable' | 'selected' | null

export interface Interaction {
  /** how an object should be highlighted for the current prompt */
  mark: (id: string, card?: Card) => Mark
  /** click on a card, permanent or player */
  click: (id: string) => void
  /** the current prompt accepts object clicks */
  active: boolean
}

export const InteractionContext = createContext<Interaction>({
  mark: () => null,
  click: () => {},
  active: false,
})

export const useInteraction = () => useContext(InteractionContext)

const idList = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : [])

const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const

/**
 * What is still owed, read from XMage's "Pay {1}{G}" prompt.
 * `generic` means any mana will do for at least part of it.
 */
export function remainingCost(message: string | undefined): { generic: boolean; colors: Set<string> } {
  const cost = (message ?? '').split('<')[0]
  const colors = new Set<string>()
  let generic = false
  for (const match of cost.matchAll(/\{([^}]+)\}/g)) {
    const symbol = match[1].toUpperCase()
    // hybrid and Phyrexian symbols can be paid in more than one way: every way counts
    for (const part of symbol.split('/')) {
      if ((COLORS as readonly string[]).includes(part)) colors.add(part)
      else if (/^\d+$/.test(part) ? Number(part) > 0 : part === 'X' || part === 'S') generic = true
    }
  }
  return { generic, colors }
}

/** Can this permanent's mana abilities help with what is still owed? (null: it has no mana ability) */
export function paysFor(card: Card, cost: { generic: boolean; colors: Set<string> }): boolean | null {
  const text = card.rules.join(' ')
  if (!/\bAdd\b/i.test(text)) return null
  if (cost.generic || cost.colors.size === 0) return true
  if (/any (one )?(color|type)|mana of any|any combination/i.test(text)) return true
  return [...cost.colors].some((color) => text.includes(`{${color}}`))
}

export function buildInteraction(
  prompt: Prompt | null,
  answering: boolean,
  respond: (kind: 'uuid', value: string) => void,
): Interaction {
  const method = prompt?.method
  const clickable = method === 'GAME_SELECT' || method === 'GAME_TARGET' || method === 'GAME_PLAY_MANA'
  if (!prompt || !clickable) {
    return { mark: (_id, card) => (card?.selected ? 'selected' : null), click: () => {}, active: false }
  }
  const options = prompt.data.options ?? {}
  const targets = new Set([...(prompt.data.targets ?? []), ...idList(options.possibleTargets)])
  const chosen = new Set(idList(options.chosenTargets))
  const combat = new Set([...idList(options.possibleAttackers), ...idList(options.possibleBlockers)])

  const owed = method === 'GAME_PLAY_MANA' ? remainingCost(prompt.data.message) : null

  const mark = (id: string, card?: Card): Mark => {
    if (chosen.has(id) || card?.selected) return 'selected'
    if (method === 'GAME_TARGET') {
      return targets.has(id) || card?.choosable ? 'target' : null
    }
    if (owed && card?.playable && card.permanent) {
      // XMage marks every mana source; only point at the ones that can pay what is left
      // (things without a mana ability stay lit: convoke creatures, special payments)
      return paysFor(card, owed) === false ? null : 'playable'
    }
    return card?.playable || combat.has(id) ? 'playable' : null
  }

  return {
    mark,
    active: !answering,
    click: (id) => {
      // with an explicit target list only those can be picked; otherwise the server validates
      if (method === 'GAME_TARGET' && targets.size > 0 && !targets.has(id) && !chosen.has(id)) return
      respond('uuid', id)
    },
  }
}
