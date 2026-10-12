package dev.mtgui.gateway;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import io.javalin.websocket.WsContext;
import mage.cards.decks.DeckCardInfo;
import mage.cards.decks.DeckCardLists;
import mage.cards.repository.CardInfo;
import mage.cards.repository.CardRepository;
import mage.constants.MatchBufferTime;
import mage.game.mulligan.MulliganType;
import mage.constants.ManaType;
import mage.constants.MatchTimeLimit;
import mage.constants.MultiplayerAttackOption;
import mage.constants.PlayerAction;
import mage.constants.RangeOfInfluence;
import mage.constants.SkillLevel;
import mage.game.match.MatchOptions;
import mage.interfaces.MageClient;
import mage.interfaces.callback.ClientCallback;
import mage.interfaces.callback.ClientCallbackMethod;
import mage.players.PlayerType;
import mage.remote.Connection;
import mage.remote.SessionImpl;
import mage.utils.MageVersion;
import mage.view.*;
import org.apache.log4j.Logger;

import java.util.ArrayDeque;
import java.util.Collection;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * One browser user. Owns a regular XMage client connection (the same SessionImpl the Swing
 * client uses) and translates between it and the browser's JSON websocket.
 * <p>
 * The session outlives the websocket: a page reload re-attaches with the same token and gets
 * the latest game state replayed, the XMage server never notices.
 */
final class ClientSession implements MageClient {

    private static final Logger logger = Logger.getLogger(ClientSession.class);
    private static final MageVersion VERSION = new MageVersion(MageClient.class);
    private static final int CHAT_HISTORY = 400;

    final String token = UUID.randomUUID().toString();
    private final GatewayConfig config;
    private final SessionImpl session = new SessionImpl(this);
    // XMage calls block on the network, keep them off the websocket threads and in order
    private final ExecutorService commands = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "gateway-commands");
        t.setDaemon(true);
        return t;
    });

    private volatile WsContext ws;
    private volatile long detachedAt = 0;
    private String userName;

    // state replayed to the browser after a reload
    private JsonObject currentGame; // gameId, playerId, tableId, chatId
    private String lastGameEvent;
    private JsonObject currentTable;
    private final Deque<String> chatHistory = new ArrayDeque<>();
    // sideboarding between the games of a match: what the server sent, replayed after a reload
    private String sideboardEvent;
    private DeckView sideboardDeck;
    // the player's XMage preferences, as the browser sent them
    private JsonObject settings;

    ClientSession(GatewayConfig config) {
        this.config = config;
    }

    // ------------------------------------------------------------ websocket side

    synchronized void attach(WsContext ws) {
        this.ws = ws;
        this.detachedAt = 0;
    }

    synchronized void detach(WsContext ws) {
        if (this.ws == ws) {
            this.ws = null;
            this.detachedAt = System.currentTimeMillis();
        }
    }

    long detachedAt() {
        return detachedAt;
    }

    boolean isConnected() {
        return session.isConnected();
    }

    void close() {
        commands.shutdownNow();
        try {
            session.connectStop(false, false);
        } catch (Throwable t) {
            logger.warn("Error on closing session of " + userName, t);
        }
    }

    void ping() {
        if (session.isConnected()) {
            commands.execute(session::ping);
        }
    }

    private synchronized void sendRaw(String json) {
        WsContext target = ws;
        if (target != null && target.session.isOpen()) {
            try {
                target.send(json);
            } catch (Throwable t) {
                logger.warn("Can't send to browser of " + userName + ": " + t);
            }
        }
    }

    private void sendEvent(String method, UUID objectId, int messageId, JsonElement data) {
        sendRaw(event(method, objectId, messageId, data));
    }

    private static String event(String method, UUID objectId, int messageId, JsonElement data) {
        JsonObject o = new JsonObject();
        o.addProperty("type", "event");
        o.addProperty("method", method);
        o.addProperty("objectId", ViewMapper.str(objectId));
        o.addProperty("messageId", messageId);
        o.add("data", data == null ? JsonNull.INSTANCE : data);
        return o.toString();
    }

    private void reply(JsonElement id, JsonElement data) {
        JsonObject o = new JsonObject();
        o.addProperty("type", "reply");
        o.add("id", id);
        o.addProperty("ok", true);
        o.add("data", data == null ? JsonNull.INSTANCE : data);
        sendRaw(o.toString());
    }

    private void replyError(JsonElement id, String error) {
        JsonObject o = new JsonObject();
        o.addProperty("type", "reply");
        o.add("id", id);
        o.addProperty("ok", false);
        o.addProperty("error", error);
        sendRaw(o.toString());
    }

    // ------------------------------------------------------------ commands from the browser

    void handle(JsonObject msg) {
        commands.execute(() -> {
            JsonElement id = msg.get("id");
            try {
                reply(id, dispatch(msg));
            } catch (GatewayException e) {
                replyError(id, e.getMessage());
            } catch (Throwable t) {
                logger.error("Command failed: " + msg.get("cmd"), t);
                replyError(id, "Internal error: " + t);
            }
        });
    }

    private JsonElement dispatch(JsonObject msg) throws Exception {
        String cmd = string(msg, "cmd");
        if (cmd == null) {
            throw new GatewayException("Missing cmd");
        }
        if (cmd.equals("login")) {
            if (msg.has("settings") && msg.get("settings").isJsonObject()) {
                settings = msg.getAsJsonObject("settings");
            }
            return login(string(msg, "username"));
        }
        if (cmd.equals("settings")) {
            // XMage applies these on the server: stop steps, auto-payment, auto-targeting, ...
            settings = msg.has("settings") && msg.get("settings").isJsonObject() ? msg.getAsJsonObject("settings") : null;
            if (session.isConnected() && !session.updatePreferencesForServer(Settings.fromJson(settings))) {
                throw new GatewayException("The server did not accept the settings" + lastError());
            }
            return Settings.toJson(Settings.fromJson(settings));
        }
        if (cmd.equals("resume")) {
            return resume();
        }
        if (cmd.equals("checkDeck")) {
            return checkDeck(msg);
        }
        if (!session.isConnected()) {
            throw new GatewayException("Not connected to the game server");
        }
        switch (cmd) {
            case "tables":
                return tables();
            case "createTable":
                return createTable(msg);
            case "joinTable":
                return joinTable(msg);
            case "leaveTable":
                session.leaveTable(session.getMainRoomId(), uuid(msg, "tableId"));
                synchronized (this) {
                    currentTable = null;
                }
                return null;
            case "startMatch":
                if (!session.startMatch(session.getMainRoomId(), uuid(msg, "tableId"))) {
                    throw new GatewayException("Can't start the match" + lastError());
                }
                return null;
            case "quitMatch": {
                // gives up the whole match, not just the current game
                JsonObject game;
                synchronized (this) {
                    game = currentGame;
                }
                if (game == null) {
                    throw new GatewayException("Not in a game");
                }
                session.quitMatch(uuid(game, "gameId"));
                return null;
            }
            case "submitDeck":
                return submitDeck(msg);
            case "respond":
                respond(msg);
                return null;
            case "action":
                action(msg);
                return null;
            case "cheat": {
                // XMage test mode only (the server ignores it otherwise): runs a command group from config/init.txt
                JsonObject game;
                synchronized (this) {
                    game = currentGame;
                }
                if (game == null || stringOrNull(game, "playerId") == null) {
                    throw new GatewayException("Not in a game");
                }
                session.cheatShow(uuid(game, "gameId"), uuid(game, "playerId"));
                return null;
            }
            case "chat":
                session.sendChatMessage(uuid(msg, "chatId"), string(msg, "message"));
                return null;
            case "leaveGame":
                synchronized (this) {
                    currentGame = null;
                    lastGameEvent = null;
                    chatHistory.clear();
                }
                return null;
            default:
                throw new GatewayException("Unknown command: " + cmd);
        }
    }

    private JsonElement login(String name) throws GatewayException {
        if (session.isConnected()) {
            return resume();
        }
        if (name == null || name.trim().isEmpty()) {
            throw new GatewayException("Enter a name");
        }
        Connection connection = new Connection();
        connection.setUsername(name.trim());
        connection.setPassword("");
        connection.setHost(config.xmageHost);
        connection.setPort(config.xmagePort);
        connection.setProxyType(Connection.ProxyType.NONE);
        connection.setUserData(Settings.fromJson(settings));
        if (!session.connectStart(connection)) {
            throw new GatewayException("Can't connect to the game server" + lastError());
        }
        this.userName = name.trim();
        logger.info("Browser user connected: " + userName);
        return resume();
    }

    /**
     * Everything the browser needs to rebuild its screen, also used after page reloads
     */
    private synchronized JsonElement resume() {
        JsonObject o = new JsonObject();
        o.addProperty("token", token);
        o.addProperty("connected", session.isConnected());
        if (!session.isConnected()) {
            return o;
        }
        o.addProperty("userName", userName);
        o.addProperty("testMode", session.isTestMode());
        o.addProperty("roomId", ViewMapper.str(session.getMainRoomId()));
        JsonArray gameTypes = new JsonArray();
        for (GameTypeView type : session.getGameTypes()) {
            gameTypes.add(type.getName());
        }
        o.add("gameTypes", gameTypes);
        JsonArray deckTypes = new JsonArray();
        for (String type : session.getDeckTypes()) {
            deckTypes.add(type);
        }
        o.add("deckTypes", deckTypes);
        o.add("settings", Settings.toJson(Settings.fromJson(settings)));
        o.add("defaultSettings", Settings.defaults());
        o.add("tableOptions", tableOptions());
        o.add("table", currentTable == null ? JsonNull.INSTANCE : currentTable);
        o.add("game", currentGame == null ? JsonNull.INSTANCE : currentGame);

        if (sideboardEvent != null) {
            final String event = sideboardEvent;
            commands.execute(() -> sendRaw(event));
        }
        // replay after the reply was sent, so the browser knows about the game first
        if (currentGame != null) {
            final List<String> replay = new java.util.ArrayList<>(chatHistory);
            final String gameEvent = lastGameEvent;
            commands.execute(() -> {
                replay.forEach(this::sendRaw);
                if (gameEvent != null) {
                    sendRaw(gameEvent);
                }
            });
        }
        return o;
    }

    private JsonElement tables() throws Exception {
        JsonArray list = new JsonArray();
        Collection<TableView> tables = session.getTables(session.getMainRoomId());
        if (tables != null) {
            for (TableView t : tables) {
                list.add(ViewMapper.table(t));
            }
        }
        return list;
    }

    private DeckCardLists deck(JsonObject msg) throws GatewayException {
        DeckText.Result result = DeckText.parse(string(msg, "deck"), string(msg, "commander"), "duel".equals(string(msg, "format")));
        if (!result.errors.isEmpty()) {
            throw new GatewayException(String.join("\n", result.errors));
        }
        if (result.deck.getCards().isEmpty()) {
            throw new GatewayException("The deck is empty");
        }
        return result.deck;
    }

    private JsonElement checkDeck(JsonObject msg) {
        DeckText.Result result = DeckText.parse(string(msg, "deck"), string(msg, "commander"), "duel".equals(string(msg, "format")));
        JsonObject o = new JsonObject();
        o.addProperty("mainCount", result.mainCount);
        JsonArray commanders = new JsonArray();
        result.commanders.forEach(commanders::add);
        o.add("commanders", commanders);
        JsonArray errors = new JsonArray();
        result.errors.forEach(errors::add);
        o.add("errors", errors);
        return o;
    }

    private JsonElement createTable(JsonObject msg) throws GatewayException {
        DeckCardLists deck = deck(msg);
        String gameType = orDefault(string(msg, "gameType"), config.defaultGameType);
        String deckType = orDefault(string(msg, "deckType"), config.defaultDeckType);
        String password = orDefault(string(msg, "password"), "");

        MatchOptions options = new MatchOptions(orDefault(string(msg, "name"), userName + "'s table"), gameType, false);
        options.getPlayerTypes().add(PlayerType.HUMAN);
        options.getPlayerTypes().add(PlayerType.HUMAN);
        options.setDeckType(deckType);
        options.setLimited(false);
        options.setAttackOption(MultiplayerAttackOption.MULTIPLE);
        options.setRange(RangeOfInfluence.ALL);
        options.setWinsNeeded(Math.max(1, Math.min(3, intOr(msg, "winsNeeded", 1))));
        options.setMatchTimeLimit(enumOr(MatchTimeLimit.class, string(msg, "timeLimit"), MatchTimeLimit.NONE));
        options.setMatchBufferTime(enumOr(MatchBufferTime.class, string(msg, "bufferTime"), MatchBufferTime.NONE));
        options.setMullgianType(enumOr(MulliganType.class, string(msg, "mulliganType"), MulliganType.GAME_DEFAULT));
        options.setFreeMulligans(Math.max(0, Math.min(5, intOr(msg, "freeMulligans", 0))));
        int startLife = intOr(msg, "startLife", 0);
        if (startLife > 0) {
            options.setCustomStartLifeEnabled(true);
            options.setCustomStartLife(Math.min(startLife, 999));
        }
        int startHand = intOr(msg, "startHandSize", 0);
        if (startHand > 0) {
            options.setCustomStartHandSizeEnabled(true);
            options.setCustomStartHandSize(Math.min(startHand, 20));
        }
        // Planechase: a shared plane in the command zone and a planar die
        options.setPlaneChase(msg.has("planeChase") && msg.get("planeChase").getAsBoolean());
        options.setSkillLevel(SkillLevel.CASUAL);
        options.setRollbackTurnsAllowed(!msg.has("rollbackTurnsAllowed") || msg.get("rollbackTurnsAllowed").getAsBoolean());
        options.setSpectatorsAllowed(true);
        options.setPassword(password);

        UUID roomId = session.getMainRoomId();
        TableView table = session.createTable(roomId, options);
        if (table == null) {
            throw new GatewayException("Can't create the table" + lastError());
        }
        if (!session.joinTable(roomId, table.getTableId(), userName, PlayerType.HUMAN, 1, deck, password)) {
            session.removeTable(roomId, table.getTableId());
            throw new GatewayException("Can't join the table (the server shows the reason)" + lastError());
        }
        return rememberTable(roomId, table.getTableId());
    }

    private JsonElement joinTable(JsonObject msg) throws GatewayException {
        DeckCardLists deck = deck(msg);
        UUID roomId = session.getMainRoomId();
        UUID tableId = uuid(msg, "tableId");
        if (!session.joinTable(roomId, tableId, userName, PlayerType.HUMAN, 1, deck, orDefault(string(msg, "password"), ""))) {
            throw new GatewayException("Can't join the table (the server shows the reason)" + lastError());
        }
        return rememberTable(roomId, tableId);
    }

    private JsonElement rememberTable(UUID roomId, UUID tableId) {
        Optional<TableView> table = session.getTable(roomId, tableId);
        JsonObject o = table.map(ViewMapper::table).orElseGet(JsonObject::new);
        o.addProperty("id", tableId.toString());
        synchronized (this) {
            currentTable = o;
        }
        return o;
    }

    /** The choices for a new table, as XMage names them */
    private static JsonObject tableOptions() {
        JsonObject o = new JsonObject();
        JsonArray mulligans = new JsonArray();
        for (MulliganType type : MulliganType.values()) {
            mulligans.add(option(type.name(), type.toString()));
        }
        o.add("mulliganTypes", mulligans);
        JsonArray limits = new JsonArray();
        for (MatchTimeLimit limit : MatchTimeLimit.values()) {
            limits.add(option(limit.name(), limit.getName()));
        }
        o.add("timeLimits", limits);
        JsonArray buffers = new JsonArray();
        for (MatchBufferTime buffer : MatchBufferTime.values()) {
            buffers.add(option(buffer.name(), buffer.getName()));
        }
        o.add("bufferTimes", buffers);
        return o;
    }

    private static JsonObject option(String key, String text) {
        JsonObject o = new JsonObject();
        o.addProperty("key", key);
        o.addProperty("text", text);
        return o;
    }

    /**
     * Between the games of a match XMage hands every player their deck to rearrange.
     * The browser answers with the ids of the cards it wants in the main deck and in the sideboard.
     */
    private JsonElement submitDeck(JsonObject msg) throws GatewayException {
        DeckView deck;
        synchronized (this) {
            deck = sideboardDeck;
        }
        if (deck == null) {
            throw new GatewayException("There is no deck to submit right now");
        }
        Map<String, SimpleCardView> pool = new HashMap<>();
        deck.getCards().values().forEach(c -> pool.put(c.getId().toString(), c));
        deck.getSideboard().values().forEach(c -> pool.put(c.getId().toString(), c));
        DeckCardLists lists = new DeckCardLists();
        lists.setName(deck.getName());
        Set<String> used = new HashSet<>();
        addCards(lists.getCards(), msg.getAsJsonArray("main"), pool, used);
        addCards(lists.getSideboard(), msg.getAsJsonArray("sideboard"), pool, used);
        if (used.size() != pool.size()) {
            throw new GatewayException("Every card has to be in the main deck or in the sideboard");
        }
        if (!session.submitDeck(uuid(msg, "tableId"), lists)) {
            throw new GatewayException("The deck was not accepted (the server shows the reason)" + lastError());
        }
        synchronized (this) {
            sideboardDeck = null;
            sideboardEvent = null;
        }
        return null;
    }

    private static void addCards(List<DeckCardInfo> target, JsonArray ids, Map<String, SimpleCardView> pool, Set<String> used) throws GatewayException {
        if (ids == null) {
            return;
        }
        for (JsonElement e : ids) {
            SimpleCardView card = pool.get(e.getAsString());
            if (card == null || !used.add(e.getAsString())) {
                throw new GatewayException("Unknown or repeated card in the submitted deck");
            }
            CardInfo info = CardRepository.instance.findCard(card.getExpansionSetCode(), card.getCardNumber());
            if (info == null) {
                throw new GatewayException("Can't find card " + card.getExpansionSetCode() + " " + card.getCardNumber());
            }
            target.add(new DeckCardInfo(info.getName(), info.getCardNumber(), info.getSetCode(), 1));
        }
    }

    private JsonObject deckJson(DeckView deck) {
        JsonObject o = new JsonObject();
        o.addProperty("name", deck.getName());
        o.add("main", deckCards(deck.getCards().values()));
        o.add("sideboard", deckCards(deck.getSideboard().values()));
        return o;
    }

    private static JsonArray deckCards(Collection<SimpleCardView> cards) {
        JsonArray list = new JsonArray();
        for (SimpleCardView c : cards) {
            list.add(ViewMapper.knownCard(c));
        }
        return list;
    }

    private static int intOr(JsonObject o, String key, int fallback) {
        JsonElement e = o.get(key);
        try {
            return e == null || e.isJsonNull() ? fallback : e.getAsInt();
        } catch (RuntimeException ex) {
            return fallback;
        }
    }

    private static <E extends Enum<E>> E enumOr(Class<E> type, String name, E fallback) {
        if (name == null) {
            return fallback;
        }
        try {
            return Enum.valueOf(type, name);
        } catch (IllegalArgumentException e) {
            return fallback;
        }
    }

    private void respond(JsonObject msg) throws GatewayException {
        UUID gameId = uuid(msg, "gameId");
        String kind = string(msg, "kind");
        JsonElement value = msg.get("value");
        boolean isNull = value == null || value.isJsonNull();
        switch (kind == null ? "" : kind) {
            case "uuid":
                session.sendPlayerUUID(gameId, isNull ? null : UUID.fromString(value.getAsString()));
                break;
            case "boolean":
                session.sendPlayerBoolean(gameId, !isNull && value.getAsBoolean());
                break;
            case "string":
                session.sendPlayerString(gameId, isNull ? null : value.getAsString());
                break;
            case "integer":
                session.sendPlayerInteger(gameId, isNull ? 0 : value.getAsInt());
                break;
            case "manaType":
                session.sendPlayerManaType(gameId, uuid(msg, "playerId"), ManaType.valueOf(value.getAsString()));
                break;
            default:
                throw new GatewayException("Unknown response kind: " + kind);
        }
    }

    private void action(JsonObject msg) throws GatewayException {
        PlayerAction action;
        try {
            action = PlayerAction.valueOf(string(msg, "action"));
        } catch (RuntimeException e) {
            throw new GatewayException("Unknown action: " + string(msg, "action"));
        }
        // data is an id, a number or a text depending on the action (see mage.constants.PlayerAction usage)
        Object data = null;
        JsonElement raw = msg.get("data");
        if (raw != null && raw.isJsonPrimitive()) {
            if (raw.getAsJsonPrimitive().isNumber()) {
                data = raw.getAsInt();
            } else {
                String text = raw.getAsString();
                try {
                    data = UUID.fromString(text);
                } catch (IllegalArgumentException e) {
                    data = text;
                }
            }
        }
        session.sendPlayerAction(action, uuid(msg, "gameId"), data);
    }

    // ------------------------------------------------------------ callbacks from XMage

    @Override
    public void onCallback(ClientCallback callback) {
        try {
            callback.decompressData();
            forward(callback);
        } catch (Throwable t) {
            logger.error("Can't process callback " + callback.getInfo(), t);
        }
    }

    private void forward(ClientCallback callback) {
        ClientCallbackMethod method = callback.getMethod();
        UUID objectId = callback.getObjectId();
        int messageId = callback.getMessageId();
        Object data = callback.getData();

        switch (method) {
            case START_GAME: {
                TableClientMessage message = (TableClientMessage) data;
                UUID gameId = message.getGameId();
                JsonObject game = ViewMapper.tableMessage(message);
                synchronized (this) {
                    currentGame = game;
                    lastGameEvent = null;
                    chatHistory.clear();
                    sideboardDeck = null;
                    sideboardEvent = null;
                }
                // same as the Swing client: open the game chat (it carries the game log), then join
                commands.execute(() -> {
                    Optional<UUID> chatId = session.getGameChatId(gameId);
                    chatId.ifPresent(id -> {
                        game.addProperty("chatId", id.toString());
                        session.joinChat(id);
                    });
                    sendEvent(method.name(), objectId, messageId, game);
                    session.joinGame(gameId);
                });
                break;
            }

            case GAME_INIT:
            case GAME_UPDATE:
                gameEvent(method, objectId, messageId, wrapGame((GameView) data));
                break;

            case GAME_UPDATE_AND_INFORM:
            case GAME_ASK:
            case GAME_TARGET:
            case GAME_SELECT:
            case GAME_CHOOSE_PILE:
            case GAME_CHOOSE_CHOICE:
            case GAME_PLAY_MANA:
            case GAME_PLAY_XMANA:
            case GAME_GET_AMOUNT:
            case GAME_GET_MULTI_AMOUNT:
            case GAME_OVER:
                gameEvent(method, objectId, messageId, ViewMapper.gameMessage((GameClientMessage) data));
                break;

            case GAME_CHOOSE_ABILITY:
                gameEvent(method, objectId, messageId, ViewMapper.abilityPicker((AbilityPickerView) data));
                break;

            case GAME_INFORM_PERSONAL: {
                JsonObject o = new JsonObject();
                o.addProperty("message", ((GameClientMessage) data).getMessage());
                sendEvent(method.name(), objectId, messageId, o);
                break;
            }

            case GAME_ERROR: {
                JsonObject o = new JsonObject();
                o.addProperty("message", String.valueOf(data));
                sendEvent(method.name(), objectId, messageId, o);
                break;
            }

            case END_GAME_INFO:
                sendEvent(method.name(), objectId, messageId, ViewMapper.gameEnd((GameEndView) data));
                break;

            case CHATMESSAGE: {
                String json = event(method.name(), objectId, messageId, ViewMapper.chat((ChatMessage) data));
                synchronized (this) {
                    if (currentGame != null && objectId != null
                            && objectId.toString().equals(stringOrNull(currentGame, "chatId"))) {
                        chatHistory.addLast(json);
                        if (chatHistory.size() > CHAT_HISTORY) {
                            chatHistory.removeFirst();
                        }
                    }
                }
                sendRaw(json);
                break;
            }

            case SERVER_MESSAGE:
                if (data != null) {
                    sendEvent(method.name(), objectId, messageId, ViewMapper.chat((ChatMessage) data));
                }
                break;

            case SHOW_USERMESSAGE: {
                List<?> parts = (List<?>) data;
                JsonObject o = new JsonObject();
                o.addProperty("title", parts.size() > 0 ? String.valueOf(parts.get(0)) : "");
                o.addProperty("message", parts.size() > 1 ? String.valueOf(parts.get(1)) : "");
                sendEvent(method.name(), objectId, messageId, o);
                break;
            }

            case USER_REQUEST_DIALOG:
                sendEvent(method.name(), objectId, messageId, ViewMapper.userRequest((UserRequestMessage) data));
                break;

            case SIDEBOARD:
            case CONSTRUCT: {
                TableClientMessage message = (TableClientMessage) data;
                JsonObject o = ViewMapper.tableMessage(message);
                o.addProperty("time", message.getTime());
                o.add("deck", deckJson(message.getDeck()));
                String json = event(method.name(), objectId, messageId, o);
                synchronized (this) {
                    sideboardDeck = message.getDeck();
                    sideboardEvent = json;
                }
                sendRaw(json);
                break;
            }

            case VIEW_SIDEBOARD:
            case VIEW_LIMITED_DECK:
                sendEvent(method.name(), objectId, messageId, ViewMapper.tableMessage((TableClientMessage) data));
                break;

            case JOINED_TABLE:
                sendEvent(method.name(), objectId, messageId, ViewMapper.tableMessage((TableClientMessage) data));
                break;

            default:
                // drafts, tournaments, sideboarding, replays: not supported by the web client yet
                logger.debug("Ignored callback " + callback.getInfo());
                sendEvent(method.name(), objectId, messageId, null);
                break;
        }
    }

    private static JsonObject wrapGame(GameView view) {
        JsonObject o = new JsonObject();
        o.add("game", ViewMapper.game(view));
        return o;
    }

    private void gameEvent(ClientCallbackMethod method, UUID gameId, int messageId, JsonObject data) {
        String json = event(method.name(), gameId, messageId, data);
        synchronized (this) {
            lastGameEvent = json;
        }
        sendRaw(json);
    }

    @Override
    public void onNewConnection() {
    }

    @Override
    public MageVersion getVersion() {
        return VERSION;
    }

    @Override
    public void connected(String message) {
    }

    @Override
    public void disconnected(boolean askToReconnect, boolean keepMySessionActive) {
        sendEvent("DISCONNECTED", null, 0, null);
    }

    @Override
    public void showMessage(String message) {
        JsonObject o = new JsonObject();
        o.addProperty("title", "Message");
        o.addProperty("message", message);
        sendEvent("SHOW_USERMESSAGE", null, 0, o);
    }

    @Override
    public void showError(String message) {
        JsonObject o = new JsonObject();
        o.addProperty("title", "Error");
        o.addProperty("message", message);
        sendEvent("SHOW_USERMESSAGE", null, 0, o);
    }

    // ------------------------------------------------------------ helpers

    private String lastError() {
        String error = session.getLastError();
        return error == null || error.isEmpty() ? "" : ": " + error;
    }

    private static String string(JsonObject o, String key) {
        return stringOrNull(o, key);
    }

    private static String stringOrNull(JsonObject o, String key) {
        JsonElement e = o.get(key);
        return e == null || e.isJsonNull() ? null : e.getAsString();
    }

    private static UUID uuid(JsonObject o, String key) throws GatewayException {
        String value = stringOrNull(o, key);
        if (value == null) {
            throw new GatewayException("Missing " + key);
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new GatewayException("Bad " + key);
        }
    }

    private static String orDefault(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value;
    }

    static final class GatewayException extends Exception {
        GatewayException(String message) {
            super(message);
        }
    }
}
