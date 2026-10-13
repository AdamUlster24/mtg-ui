import { useState } from "react";
import { Modal } from "../game/Dialogs";
import type { ServerSettings, StepStops } from "../protocol/types";
import { useStore } from "../store";

const STEPS: [keyof StepStops, string][] = [
  ["upkeep", "Upkeep"],
  ["draw", "Draw"],
  ["main1", "First main phase"],
  ["beforeCombat", "Beginning of combat"],
  ["endOfCombat", "End of combat"],
  ["main2", "Second main phase"],
  ["endOfTurn", "End step"],
];

type Flag = {
  [K in keyof ServerSettings]: ServerSettings[K] extends boolean ? K : never;
}[keyof ServerSettings];

const STOPS: [Flag, string, string][] = [
  [
    "stopOnDeclareAttackers",
    "Stop to declare attackers while passing",
    "F4 / F5 / F7 still stop when you could attack",
  ],
  [
    "stopOnDeclareBlockersWithAnyPermanents",
    "Stop to declare blockers when I have possible blockers",
    "",
  ],
  [
    "stopOnDeclareBlockersWithZeroPermanents",
    "Stop to declare blockers even when I have none",
    "",
  ],
  [
    "stopOnAllMainPhases",
    "F7 (until next main phase) also stops in the opponent's main phases",
    "off: only in my own",
  ],
  [
    "stopOnAllEndPhases",
    "F5 (until end step) also stops at my own end step",
    "off: only at the opponent's",
  ],
  [
    "stopOnStackNewObjects",
    "F10 (until the stack resolves) stops when something new goes on the stack",
    "on my turn, so I can respond",
  ],
];

const PLAY: [Flag, string, string][] = [
  ["manaPoolAutomatic", "Spend mana from my pool automatically", ""],
  [
    "manaPoolAutomaticRestricted",
    "Do not spend mana automatically that was in my pool before I started casting",
    "only mana made while paying is used by itself",
  ],
  [
    "useFirstManaAbility",
    "Tapping a land uses its first mana ability",
    "no question for lands with several",
  ],
  ["confirmEmptyManaPool", "Ask before passing with mana left in my pool", ""],
  ["passPriorityCast", "Pass priority right after I cast a spell", ""],
  [
    "passPriorityActivation",
    "Pass priority right after I activate an ability",
    "",
  ],
  [
    "autoOrderTrigger",
    "Order my triggers by itself when the order does not matter",
    "",
  ],
  [
    "askMoveToGraveOrder",
    "Ask for the order when several cards go to my graveyard",
    "",
  ],
  [
    "useSameSettingsForReplacementEffects",
    "A remembered choice between replacement effects counts for every copy of the card",
    "off: only for that one object",
  ],
  ["allowRequestShowHandCards", "Let the opponent ask to see my hand", ""],
];

function Toggle({
  label,
  note,
  checked,
  onChange,
  name,
}: {
  label: string;
  note?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  name: string;
}) {
  return (
    <label className="setting">
      <input
        type="checkbox"
        data-setting={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {note ? <small>{note}</small> : null}
      </span>
    </label>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const {
    settings,
    defaultSettings,
    prefs,
    saveSettings,
    savePrefs,
    gameInfo,
    action,
    notify,
    testMode,
  } = useStore();
  const [draft, setDraft] = useState<ServerSettings | null>(
    settings ?? defaultSettings,
  );
  const [tab, setTab] = useState<"stops" | "play" | "screen">("stops");
  if (!draft) return null;

  // every change goes to the server right away, so it already counts for the current game
  const change = (next: ServerSettings) => {
    setDraft(next);
    saveSettings(next).catch((e: Error) => notify("Settings", e.message));
  };
  const setStep = (
    turn: "yourTurn" | "opponentTurn",
    step: keyof StepStops,
    value: boolean,
  ) => change({ ...draft, [turn]: { ...draft[turn], [step]: value } });

  return (
    <Modal title="Settings" wide onClose={onClose}>
      {/* players get one short page; XMage's remaining switches are for testing only */}
      {testMode && (
        <div className="tabs">
          {(["stops", "play", "screen"] as const).map((t) => (
            <button
              key={t}
              className={tab === t ? "on" : ""}
              onClick={() => setTab(t)}
            >
              {t === "stops"
                ? "Stops"
                : t === "play"
                  ? "Playing"
                  : "This screen"}
            </button>
          ))}
        </div>
      )}

      {(tab === "stops" || !testMode) && (
        <div className="settings-body">
          <p className="muted">
            Where the game waits for you when nothing is on the stack. Unticked
            steps are passed automatically.
          </p>
          <table className="stops">
            <thead>
              <tr>
                <th />
                <th>My turn</th>
                <th>Opponent's turn</th>
              </tr>
            </thead>
            <tbody>
              {STEPS.map(([step, label]) => (
                <tr key={step}>
                  <td>{label}</td>
                  {(["yourTurn", "opponentTurn"] as const).map((turn) => (
                    <td key={turn}>
                      <input
                        type="checkbox"
                        data-setting={`${turn}.${step}`}
                        checked={draft[turn][step]}
                        onChange={(e) => setStep(turn, step, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {testMode &&
            STOPS.map(([key, label, note]) => (
              <Toggle
                key={key}
                name={key}
                label={label}
                note={note}
                checked={draft[key]}
                onChange={(v) => change({ ...draft, [key]: v })}
              />
            ))}
          {!testMode && (
            <>
              <p className="muted">
                Whenever a spell or ability is cast you get the chance to
                respond, wherever you are. After you cast something, priority
                passes by itself; hold Ctrl to keep it.
              </p>
              <Toggle
                name="autoOrderTrigger"
                label="Order my triggers by itself when the order does not matter"
                checked={draft.autoOrderTrigger}
                onChange={(v) => change({ ...draft, autoOrderTrigger: v })}
              />
              <div className="row">
                <button
                  className="btn"
                  disabled={!gameInfo}
                  data-reset="remembered"
                  title={
                    'Answers you told the game to repeat ("always yes", trigger order, replacement effects) last for the current game'
                  }
                  onClick={() => {
                    action("REQUEST_AUTO_ANSWER_RESET_ALL");
                    action("TRIGGER_AUTO_ORDER_RESET_ALL");
                    action("RESET_AUTO_SELECT_REPLACEMENT_EFFECTS");
                  }}
                >
                  Forget remembered answers
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {testMode && tab === "play" && (
        <div className="settings-body">
          {PLAY.map(([key, label, note]) => (
            <Toggle
              key={key}
              name={key}
              label={label}
              note={note}
              checked={draft[key]}
              onChange={(v) => change({ ...draft, [key]: v })}
            />
          ))}
          <label className="setting">
            <select
              data-setting="autoTargetLevel"
              value={draft.autoTargetLevel}
              onChange={(e) =>
                change({ ...draft, autoTargetLevel: Number(e.target.value) })
              }
            >
              <option value={0}>Never choose targets for me</option>
              <option value={1}>
                Choose for me when there is only one legal target
              </option>
              <option value={2}>
                Also when all legal targets are the same
              </option>
            </select>
          </label>
          <h4>Remembered answers</h4>
          <p className="muted">
            Answers you told the game to repeat ("always yes", trigger order,
            replacement effects) last for the current game.
          </p>
          <div className="row">
            <button
              className="btn"
              disabled={!gameInfo}
              data-reset="answers"
              onClick={() => action("REQUEST_AUTO_ANSWER_RESET_ALL")}
            >
              Forget yes / no answers
            </button>
            <button
              className="btn"
              disabled={!gameInfo}
              data-reset="triggers"
              onClick={() => action("TRIGGER_AUTO_ORDER_RESET_ALL")}
            >
              Forget trigger order
            </button>
            <button
              className="btn"
              disabled={!gameInfo}
              data-reset="replacement"
              onClick={() => action("RESET_AUTO_SELECT_REPLACEMENT_EFFECTS")}
            >
              Forget replacement choices
            </button>
          </div>
        </div>
      )}

      {(tab === "screen" || !testMode) && (
        <div className="settings-body">
          <label className="setting column">
            <span>
              Card size on the battlefield: {Math.round(prefs.cardScale * 100)}%
            </span>
            <input
              type="range"
              data-pref="cardScale"
              min={0.6}
              max={1}
              step={0.05}
              value={prefs.cardScale}
              onChange={(e) => savePrefs({ cardScale: Number(e.target.value) })}
            />
          </label>
          <label className="setting">
            <select
              data-pref="animations"
              value={prefs.animations}
              onChange={(e) =>
                savePrefs({
                  animations: e.target.value as "normal" | "fast" | "off",
                })
              }
            >
              <option value="normal">Animations: normal</option>
              <option value="fast">Animations: fast</option>
              <option value="off">Animations: off</option>
            </select>
          </label>
          <Toggle
            name="showLog"
            label="Show the game log"
            checked={prefs.showLog}
            onChange={(v) => savePrefs({ showLog: v })}
          />
        </div>
      )}

      <footer>
        <button
          className="btn ghost"
          data-reset="defaults"
          onClick={() => {
            if (defaultSettings) change(defaultSettings);
            savePrefs({ cardScale: 1, animations: "normal", showLog: true });
          }}
        >
          Back to defaults
        </button>
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </Modal>
  );
}
