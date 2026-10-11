# mtg-ui

A browser client for [XMage](https://github.com/magefree/mage). XMage's server, rules engine and card
implementations are used unmodified; this repo replaces only the Swing client.

```
Browser (React + TS)  <-- JSON / WebSocket -->  gateway (Java)  <-- XMage client protocol -->  XMage server
        web/                                      gateway/                                      ../mage
```

- **`gateway/`** – a small Java process. For every browser user it opens a normal XMage client connection
  (`mage.remote.SessionImpl`, the class the Swing client uses) and translates XMage's callbacks and view
  objects to JSON. It also starts the XMage server in the same JVM, parses pasted decklists against the
  XMage card database, and caches card art from Scryfall.
- **`web/`** – the React client: lobby, battlefield, hand, stack, targeting/combat arrows, prompts, game log.
- **`../mage`** – a plain checkout of XMage next to this repo. Nothing in it is patched.

## Status

Early but playable: two people can play a full game of 1v1 Commander in the browser.

Working and tested end to end (two real browser tabs driven through games):

- Sign in, paste a decklist with live validation, create / join a table, start the match
- Mulligans, lands, casting spells and the commander, mana payment, declaring attackers, passing priority
- Stack display, targeting and combat arrows, card preview on hover, game log and chat
- Reloading the page mid-game restores the board, the log and the current prompt
- Conceding, the result screen, returning to the lobby

Written but not exercised yet: choice lists, number pickers, pile choices, picking cards from a
library / graveyard search, assigning blockers, token art, double-faced cards, and auras / equipment drawn
behind the permanent they are attached to. Playing over the internet (tunnel or port-forward) has only been
set up on paper; everything so far ran on localhost.

## Layout

```
gateway/    Java gateway (Maven); the JSON contract lives in ViewMapper.java
web/        React + TypeScript client (Vite)
scripts/    build-mage.sh, run.sh, smoke.mjs
mvnw        Maven wrapper, so no system Maven is needed
MAGE_COMMIT XMage commit this was last built and tested against
run/        runtime files, created on first start, not committed
```

## Run

Requirements: JDK 17+, Node 20+, and the XMage checkout at `../mage`.

```bash
scripts/build-mage.sh   # once, and again after every `git pull` in ../mage (takes several minutes)
scripts/run.sh          # builds gateway + web client, serves everything on http://localhost:8080
```

Open http://localhost:8080 in two tabs to play against yourself (each tab is its own player).

For UI work, keep `scripts/run.sh` running and start `npm run dev` in `web/` (hot reload, proxies to :8080).

`node scripts/smoke.mjs` plays the first turn of a Commander game through the gateway without a browser.

## Playing with a friend online

Only the host runs anything; the friend just opens a link.

1. Start with a password: `GATEWAY_PASSWORD=something scripts/run.sh`
2. Make port 8080 reachable for your friend, e.g. `tailscale funnel 8080`,
   `cloudflared tunnel --url http://localhost:8080`, or a router port-forward.
3. Both open the URL, enter the password and a name, paste a decklist, one creates a table, the other joins.

The XMage port itself (17171) is bound to 127.0.0.1 and never needs to be exposed.

## Settings (environment variables)

| Variable | Default | |
|---|---|---|
| `GATEWAY_PORT` | `8080` | HTTP / WebSocket port |
| `GATEWAY_PASSWORD` | empty | shared password for everyone who connects |
| `GATEWAY_HEAP` | `3g` | JVM heap (the XMage server lives in this process) |
| `XMAGE_EMBEDDED` | `true` | `false` = connect to an already running XMage server |
| `XMAGE_HOST` / `XMAGE_PORT` | `127.0.0.1` / `17171` | where that server is |
| `XMAGE_GAME_TYPE` / `XMAGE_DECK_TYPE` | Commander Two Player Duel / Variant Magic - Commander | defaults for new tables |
| `MAGE_DIR` | `../mage` | XMage checkout used by the scripts |

Runtime files (XMage config, card database, image cache, logs) live in `run/`, which is not committed.
`run/config/config.xml` is copied from XMage on first start and can be edited.

## Updating XMage

```bash
git -C ../mage pull && scripts/build-mage.sh && scripts/run.sh
```

New and fixed cards need nothing else. The gateway only has to change when XMage changes its network
contract (`Mage.Common`: `mage.view.*`, `MageServer`, `ClientCallbackMethod`); that shows up as a compile
error in `gateway/`, mostly in `ViewMapper.java`. If the XMage version number changes, update `mage.version`
in `gateway/pom.xml`. `MAGE_COMMIT` records the XMage commit this was last built and tested against.

## Protocol

Browser → gateway: `{id, cmd, ...}`; every command gets `{type:"reply", id, ok, data|error}`.

| cmd | |
|---|---|
| `hello {token?, password?}` | first message; re-attaches to a running session after a page reload |
| `login {username}` | connect to XMage |
| `checkDeck {deck}` | validate a pasted decklist |
| `tables`, `createTable {deck,…}`, `joinTable {tableId, deck}`, `leaveTable`, `startMatch` | lobby |
| `respond {gameId, kind, value}` | answer a prompt; `kind` = `uuid` \| `boolean` \| `string` \| `integer` \| `manaType` |
| `action {gameId, action, data?}` | `mage.constants.PlayerAction` (pass modes, undo, concede) |
| `chat {chatId, message}` | |

Gateway → browser: `{type:"event", method, objectId, messageId, data}` where `method` is XMage's
`ClientCallbackMethod` (`GAME_INIT`, `GAME_SELECT`, `GAME_TARGET`, `CHATMESSAGE`, …). Game events carry a
full board snapshot; the client animates by diffing consecutive snapshots. The JSON shapes are defined in
`gateway/.../ViewMapper.java` and mirrored in `web/src/protocol/types.ts`.

## Not built yet

Sideboarding and best-of-three, drafts/sealed/tournaments, more than two players, a deck builder,
spectating, user accounts, sounds.
