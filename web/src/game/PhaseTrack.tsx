import type { ReactNode } from 'react'
import type { GameView } from '../protocol/types'

const STEPS: [string, string, string][] = [
  ['UNTAP', 'Untap', 'UN'],
  ['UPKEEP', 'Upkeep', 'UP'],
  ['DRAW', 'Draw', 'DR'],
  ['PRECOMBAT_MAIN', 'Main 1', 'M1'],
  ['BEGIN_COMBAT', 'Begin combat', 'BC'],
  ['DECLARE_ATTACKERS', 'Attackers', 'AT'],
  ['DECLARE_BLOCKERS', 'Blockers', 'BL'],
  ['COMBAT_DAMAGE', 'Damage', 'DM'],
  ['END_COMBAT', 'End combat', 'EC'],
  ['POSTCOMBAT_MAIN', 'Main 2', 'M2'],
  ['END_TURN', 'End', 'ET'],
]

export function PhaseTrack({ game, onOpenStops, children }: { game: GameView; onOpenStops: () => void; children?: ReactNode }) {
  const mine = game.activePlayerId === game.myPlayerId
  const step = game.step === 'FIRST_COMBAT_DAMAGE' ? 'COMBAT_DAMAGE' : game.step === 'CLEANUP' ? 'END_TURN' : game.step
  const index = STEPS.findIndex((s) => s[0] === step)
  const current = STEPS[index]
  return (
    <div className={`phase-track ${mine ? 'mine' : 'theirs'}`} data-step={game.step}>
      <span className="turn-label">
        Turn {game.turn} · {mine ? 'You' : game.activePlayerName}
      </span>
      {/* like the Swing client: the phase bar leads to the "where do I stop" settings */}
      <button className="steps" onClick={onOpenStops} title="Choose where the game stops for you">
        {index >= 0 && <i className="step-marker" style={{ ['--at' as string]: index }} />}
        {STEPS.map(([id, label, short]) => (
          <span key={id} className={id === step ? 'on' : ''} title={label}>
            {short}
          </span>
        ))}
      </button>
      <span className="step-label" key={current?.[0]}>
        {current?.[1] ?? ''}
      </span>
      <span className="track-extras">{children}</span>
    </div>
  )
}
