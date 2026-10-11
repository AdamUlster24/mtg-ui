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

  const mark = (id: string, card?: Card): Mark => {
    if (chosen.has(id) || card?.selected) return 'selected'
    if (method === 'GAME_TARGET') {
      return targets.has(id) || card?.choosable ? 'target' : null
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
