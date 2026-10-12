# mtg-ui

A browser client for [XMage](https://github.com/magefree/mage), built for two people playing 1v1 Commander
online. XMage's server, rules engine and card implementations are used unmodified; this repo replaces only
the Swing client.

```
Browser (React + TS)  <-- JSON / WebSocket -->  gateway (Java)  <-- XMage client protocol -->  XMage server
        web/                                      gateway/                                      ../mage
```

- **`gateway/`** – a small Java process. For every browser user it opens a normal XMage client connection
  (`mage.remote.SessionImpl`, the class the Swing client uses) and translates XMage's callbacks and view
  objects to JSON. It also starts the XMage server in the same JVM, parses pasted decklists against the
  XMage card database, and caches card and token art from Scryfall.
- **`web/`** – the React client: lobby, battlefield, hand, stack, zone piles, targeting and combat arrows,
  prompts and dialogs, animations, game log and chat.
- **`e2e/`** – Playwright tests that drive two real browsers through games.
- **`../mage`** – a plain checkout of XMage next to this repo. Nothing in it is patched.

## Play

Requirements: JDK 17+, Node 20+, and the XMage checkout at `../mage`.

```bash
scripts/build-mage.sh   # once, and again after every `git pull` in ../mage (takes several minutes)
scripts/run.sh          # builds gateway + web client, serves everything on http://localhost:8080
```

Open http://localhost:8080 in two tabs to play against yourself (each tab is its own player). Paste a
Commander decklist (Moxfield, Archidekt, MTGA or plain `1 Card Name` lines, with the commander under a
`Commander` heading), create a table in one tab, join it from the other, start.

### With a friend over the internet

```bash
scripts/play-online.sh
```

starts the server, opens a public tunnel and prints what to send your friend:

```
  Ready. Send your friend this:

      Link:      https://something-random.trycloudflare.com
      Password:  k3v9x2m1qa
```

Only the host runs anything; the friend opens the link, enters the password and a name, and pastes a deck.

- The tunnel is a [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
  and needs `cloudflared` installed (no account). The link changes every time the script starts.
- `TUNNEL=tailscale scripts/play-online.sh` uses Tailscale Funnel instead; `TUNNEL=none` starts only the
  password-protected server, for a port-forward of your own.
- `GATEWAY_PASSWORD=... scripts/play-online.sh` sets the password instead of generating one.
- XMage's own port (17171) is bound to 127.0.0.1 and is never exposed.
- A dropped connection or a reloaded page rejoins the running game; the gateway keeps a player's session
  for 30 minutes after their browser disappears.

### In a game

- Cards you can play glow blue, legal targets glow orange, your selection glows green.
- The button at the bottom right is always the default action (Pass, Resolve, Attack, Keep, …); `Space`
  presses it. `Y` / `N` answer questions, `Esc` cancels.
- `More ▾` holds the pass-until shortcuts (`F4` next turn, `F5` end step, `F7` next main, `F8` stack
  resolved, `F9` my next turn, `F3` stop passing), the mana pool auto-payment switch, "ask to restart this
  turn" and concede.
- While you pay for a spell, `Cancel` takes it back. `Undo` (`Ctrl+Z`) appears when XMage can take back
  mana you tapped while holding priority.
- Click a graveyard or exile pile to look through it. Hover any card for a large view with its current
  text, power/toughness and counters.

## Tests

```bash
cd e2e
npm install
npx playwright install ffmpeg   # once, for the recordings
npm test                        # everything
```

The tests use Google Chrome (`E2E_BROWSER_CHANNEL=chromium` plus `npx playwright install chromium` for the
bundled browser instead). They start their own servers on other ports and stop them afterwards;
`E2E_KEEP_SERVERS=1` leaves them running between runs (`scripts/stop-test-servers.sh` stops them), and
`E2E_SKIP_BUILD=1` skips rebuilding the gateway and web client.

| Project | Command | What it does |
|---|---|---|
| `scenarios` | `npm run test:scenarios` | 22 short games on a server in XMage's test mode, each set up with test commands to hit one thing |
| `games` | `npm run test:games` | three whole games with legal 100-card decks on a server with normal rules, played by two bots through the UI until someone loses; plus deck validation in the lobby |
| `online` | `npm run test:online` | runs `scripts/play-online.sh` and plays through the public tunnel link |
| `captures` | `npm run capture` | layout checks at three resolutions and the animation recordings in `docs/captures` |

What the scenarios cover:

- **Prompts:** yes/no questions, choice lists (with filter), number picker and X costs, distributing
  numbers (combat damage among blockers), pile choice, ability picker, picking cards from a library search,
  from a graveyard and from looked-at cards (scry), ordering simultaneous triggers, target selection on
  the battlefield, on the stack and on players, mana payment by tapping lands and from the mana pool,
  declaring attackers ("all attack" and one by one), declaring blockers including two blockers on one
  attacker, a rollback request answered by the opponent.
- **Cards:** tokens (created by spells and directly) with their art, a double-faced card transforming
  into a planeswalker with its back-face art, planeswalker loyalty abilities, auras and equipment
  attaching, +1/+1 counters, the commander cast from the command zone, dying and returning to it.
- **Flow:** responding on the stack, cancel while paying, undo, chat, a page reload restoring an open
  dialog, winning by combat damage with result screens and the way back to the lobby.

`GAME_PLAY_XMANA` is the one prompt type the gateway forwards that no test triggers: current XMage never
sends it (X is announced through the number picker). The client still answers it with OK / Cancel.

The online test checks, through the public link: the script prints link and password, a wrong password is
rejected (in the UI and on the raw websocket), a game starts, player A's connection is cut and stays down
for a few seconds and then recovers with the board intact, player B reloads mid-game, and the game is then
played to its end.

### Captures

`docs/captures/layout/` has the board at 1280×720, 1600×900 and 1920×1080 with 5, 15 and 30 permanents per
side. The test that takes them also measures the page: nothing scrolls, the table's sections don't overlap,
no permanent leaves the table or covers a player panel, and neighbouring slots in a row don't cover each
other.

`docs/captures/animations/` has frames and two recordings (`player-a.webm`, `player-b.webm`, one per side
of the same game) of: drawing, casting, the opponent casting, damage on a creature, a spell resolving, a
creature dying, exile with life gain, a bounce to hand, an attack, and life loss. The test asserts that
animations are running during each of these.

## How it works

XMage sends whole board snapshots, never "this card moved". The client animates in two ways:

- A card that is on screen before and after a snapshot keeps one element (Motion's shared layout id), so
  hand → stack → battlefield → graveyard pile are continuous moves.
- For cards coming from or going to hidden zones, `web/src/game/motion.ts` compares consecutive snapshots:
  new cards fly in from the library pile or the opponent's hand, and cards that vanish leave a copy that
  flies to the graveyard, exile, hand or library.

Every prompt is XMage's own (`ClientCallbackMethod`), answered with one of five typed replies. Clicking a
card, permanent or player sends its id; the prompt bar's buttons send yes/no; dialogs send the rest.

### Protocol

Browser → gateway: `{id, cmd, ...}`; every command gets `{type:"reply", id, ok, data|error}`.

| cmd | |
|---|---|
| `hello {token?, password?}` | first message; re-attaches to a running session after a reload or reconnect |
| `login {username}` | connect to XMage |
| `checkDeck {deck}` | validate a pasted decklist |
| `tables`, `createTable {deck,…}`, `joinTable {tableId, deck}`, `leaveTable`, `startMatch` | lobby |
| `respond {gameId, kind, value}` | answer a prompt; `kind` = `uuid` \| `boolean` \| `string` \| `integer` \| `manaType` |
| `action {gameId, action, data?}` | `mage.constants.PlayerAction` (pass modes, undo, rollback, concede) |
| `chat {chatId, message}` | |
| `cheat` | test mode only: run a command group from `config/init.txt` |
| `keepalive` | answered with `{type:"pong"}`; the client reconnects when the answers stop |

Gateway → browser: `{type:"event", method, objectId, messageId, data}` where `method` is XMage's
`ClientCallbackMethod` (`GAME_INIT`, `GAME_SELECT`, `GAME_TARGET`, `CHATMESSAGE`, …). The JSON shapes are
defined in `gateway/.../ViewMapper.java` and mirrored in `web/src/protocol/types.ts`.

## Settings (environment variables)

| Variable | Default | |
|---|---|---|
| `GATEWAY_PORT` | `8080` | HTTP / WebSocket port |
| `GATEWAY_PASSWORD` | empty | shared password for everyone who connects (`play-online.sh` always sets one) |
| `GATEWAY_HEAP` | `3g` | JVM heap (the XMage server lives in this process) |
| `SESSION_TIMEOUT_MINUTES` | `30` | how long a player's session survives without a browser |
| `RUN_DIR` | `run/` | runtime files: XMage config, card database, image cache, logs |
| `XMAGE_PORT` | `17171` | port of the embedded XMage server (written into a new `RUN_DIR/config/config.xml`) |
| `XMAGE_EMBEDDED` | `true` | `false` = connect to an already running XMage server at `XMAGE_HOST` |
| `XMAGE_TEST_MODE` | `false` | XMage test mode: no deck validation, test commands (see below) |
| `XMAGE_GAME_TYPE` / `XMAGE_DECK_TYPE` | Commander Two Player Duel / Variant Magic - Commander | defaults for new tables |
| `MAGE_DIR` | `../mage` | XMage checkout used by the scripts |

`RUN_DIR/config/config.xml` is copied from XMage on first start and can be edited.

**Test mode** (`XMAGE_TEST_MODE=true scripts/run.sh`) is handy for trying things out: write command groups
to `run/config/init.txt` in XMage's format (`battlefield:<player>:Forest:5`, `hand:<player>:Lightning Bolt:1`,
`token:<player>:TreasureToken:3`; see `../mage/Mage.Server/release/config/init.example.txt`) and run one
from `More ▾ → Test mode: run commands` while you have priority.

## Updating XMage

```bash
git -C ../mage pull && scripts/build-mage.sh && scripts/run.sh
```

New and fixed cards need nothing else. The gateway only has to change when XMage changes its network
contract (`Mage.Common`: `mage.view.*`, `MageServer`, `ClientCallbackMethod`); that shows up as a compile
error in `gateway/`, mostly in `ViewMapper.java`. If the XMage version number changes, update `mage.version`
in `gateway/pom.xml`. `build-mage.sh` also refreshes `gateway/src/main/resources/token-images.tsv`, the
token-to-art table extracted from XMage's sources. `MAGE_COMMIT` records the XMage commit this was last
built and tested against; run the tests after an update.

## Layout

```
gateway/    Java gateway (Maven); the JSON contract lives in ViewMapper.java
web/        React + TypeScript client (Vite)
e2e/        Playwright tests, test decks, the bot that plays whole games
scripts/    build-mage.sh, run.sh, play-online.sh, smoke.mjs, stop-test-servers.sh
docs/       captures taken by the tests
mvnw        Maven wrapper, so no system Maven is needed
run*/       runtime files, created on first start, not committed
```

## Not built

Best-of-three and sideboarding, drafts / sealed / tournaments, more than two players, a deck builder,
spectating, user accounts, sounds.
