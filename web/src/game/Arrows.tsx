import { useEffect, useRef } from 'react'
import type { GameView } from '../protocol/types'

interface Arrow {
  from: string
  to: string
  kind: 'target' | 'attack' | 'block'
}

function arrowsOf(game: GameView): Arrow[] {
  const arrows: Arrow[] = []
  for (const item of game.stack) {
    for (const target of item.targets) arrows.push({ from: item.id, to: target, kind: 'target' })
  }
  for (const group of game.combat) {
    for (const attacker of group.attackers) {
      if (group.defenderId) arrows.push({ from: attacker, to: group.defenderId, kind: 'attack' })
    }
    for (const blocker of group.blockers) {
      if (group.attackers[0]) arrows.push({ from: blocker, to: group.attackers[0], kind: 'block' })
    }
  }
  return arrows
}

const center = (el: Element) => {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/**
 * Targeting and combat arrows, drawn over the whole board.
 * Positions are read from the DOM every frame because cards keep moving while they animate.
 */
export function Arrows({ game }: { game: GameView }) {
  const svg = useRef<SVGSVGElement>(null)
  const arrows = arrowsOf(game)
  const signature = arrows.map((a) => `${a.from}>${a.to}:${a.kind}`).join('|')

  useEffect(() => {
    const root = svg.current
    if (!root) return
    const paths = Array.from(root.querySelectorAll<SVGPathElement>('path[data-from]'))
    if (paths.length === 0) return
    let frame = 0
    const draw = () => {
      for (const path of paths) {
        const from = document.querySelector(`[data-oid="${path.dataset.from}"]`)
        const to = document.querySelector(`[data-oid="${path.dataset.to}"]`)
        if (!from || !to) {
          path.setAttribute('d', '')
          continue
        }
        const a = center(from)
        const b = center(to)
        const dx = b.x - a.x
        const dy = b.y - a.y
        const bend = Math.min(140, Math.hypot(dx, dy) * 0.28)
        // control point pushed sideways from the middle, so parallel arrows stay readable
        const cx = (a.x + b.x) / 2 - (dy / (Math.hypot(dx, dy) || 1)) * bend
        const cy = (a.y + b.y) / 2 + (dx / (Math.hypot(dx, dy) || 1)) * bend
        path.setAttribute('d', `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`)
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [signature])

  return (
    <svg ref={svg} className="arrows">
      <defs>
        {(['target', 'attack', 'block'] as const).map((kind) => (
          <marker key={kind} id={`head-${kind}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" className={`arrow-head ${kind}`} />
          </marker>
        ))}
      </defs>
      {arrows.map((a) => (
        <path
          key={`${a.from}>${a.to}:${a.kind}`}
          data-from={a.from}
          data-to={a.to}
          className={`arrow ${a.kind}`}
          markerEnd={`url(#head-${a.kind})`}
        />
      ))}
    </svg>
  )
}
