import type { ReactNode } from 'react'
import type { Card } from '../protocol/types'

/** Card art comes from the gateway's Scryfall cache */
export function imageUrls(card: Card): string[] {
  const source = card.isAbility && card.sourceCard ? card.sourceCard : card
  if (source.faceDown || !source.name) return []
  const name = encodeURIComponent(source.name)
  const set = encodeURIComponent(source.set ?? '')
  const asCard = `/img/card?set=${set}&name=${name}&number=${encodeURIComponent(source.number ?? '')}${source.transformed ? '&back=1' : ''}`
  if (source.token || (source.commandKind && source.commandKind !== 'commander')) {
    // XMage knows tokens and emblems by an image name and number ("Treasure", 2)
    const image = encodeURIComponent(source.imageFileName || source.name.replace(/ Token$/, ''))
    const asToken = `/img/card?set=${set}&name=${image}&number=${source.imageNumber ?? 0}&token=1`
    // token copies of real cards have no token art, so fall back to the card itself
    return source.token ? [asToken, `/img/card?set=&number=&name=${name}`] : [asToken]
  }
  return [asCard]
}

const SYMBOL = /\{([0-9WUBRGCXYZSTQEPH/]{1,5}|½|∞)\}/gi

/** "{2}{W/U}" -> mana symbol images */
export function withSymbols(text: string, keyPrefix = 's'): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const match of text.matchAll(SYMBOL)) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const code = match[1].replace(/\//g, '').toUpperCase()
    out.push(
      <img
        key={`${keyPrefix}${i++}`}
        className="mana"
        src={`https://svgs.scryfall.io/card-symbols/${encodeURIComponent(code)}.svg`}
        alt={match[0]}
      />,
    )
    last = match.index + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function ManaCost({ cost }: { cost?: string }) {
  if (!cost) return null
  return <span className="mana-cost">{withSymbols(cost)}</span>
}

/**
 * XMage sends rules and log lines as small HTML fragments. Rebuild them as React nodes,
 * keeping only harmless formatting (never inject the server's markup directly).
 */
export function RichText({ html }: { html: string }) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  let key = 0
  const walk = (node: Node): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) {
      return withSymbols(node.textContent ?? '', `t${key++}-`)
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null
    const el = node as HTMLElement
    const children = Array.from(el.childNodes).map(walk)
    const k = key++
    switch (el.tagName) {
      case 'BR':
        return <br key={k} />
      case 'I':
      case 'EM':
        return <i key={k}>{children}</i>
      case 'B':
      case 'STRONG':
        return <b key={k}>{children}</b>
      case 'FONT': {
        const color = el.getAttribute('color') ?? ''
        const safe = /^#[0-9a-f]{3,8}$|^[a-z]+$/i.test(color) ? color : undefined
        return (
          <span key={k} className="log-color" style={safe ? { ['--c' as string]: safe } : undefined}>
            {children}
          </span>
        )
      }
      default:
        return <span key={k}>{children}</span>
    }
  }
  return <>{Array.from(doc.body.childNodes).map(walk)}</>
}

export function plain(html: string | undefined): string {
  if (!html) return ''
  const spaced = html.replace(/<(br|div|p)\b[^>]*>/gi, ' ')
  return (new DOMParser().parseFromString(spaced, 'text/html').body.textContent ?? '').replace(/\s\[[0-9a-f]{3}\]/g, '').trim()
}

/** XMage tags objects in messages with a short id like "Sol Ring [3fa]"; noise for players */
export function tidy(html: string | undefined): string {
  return (html ?? '').replace(/\s\[[0-9a-f]{3}\]/g, '')
}
