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

export function PhaseTrack({ game }: { game: GameView }) {
  const mine = game.activePlayerId === game.myPlayerId
  const step = game.step === 'FIRST_COMBAT_DAMAGE' ? 'COMBAT_DAMAGE' : game.step === 'CLEANUP' ? 'END_TURN' : game.step
  const current = STEPS.find((s) => s[0] === step)
  return (
    <div className={`phase-track ${mine ? 'mine' : 'theirs'}`}>
      <span className="turn-label">
        Turn {game.turn} · {mine ? 'You' : game.activePlayerName}
      </span>
      <div className="steps">
        {STEPS.map(([id, label, short]) => (
          <span key={id} className={id === step ? 'on' : ''} title={label}>
            {short}
          </span>
        ))}
      </div>
      <span className="step-label">{current?.[1] ?? ''}</span>
    </div>
  )
}
