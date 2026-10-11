package dev.mtgui.gateway;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import mage.choices.Choice;
import mage.players.PlayableObjectStats;
import mage.players.PlayableObjectsList;
import mage.util.MultiAmountMessage;
import mage.view.*;

import java.io.Serializable;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Converts XMage view objects (mage.view.*) into the gateway's own JSON contract.
 * <p>
 * The web client only ever sees what is written here, so an upstream rename in mage.view
 * surfaces as a compile error in this file instead of a silent change on the wire.
 * Keep web/src/protocol/types.ts in sync with this class.
 */
final class ViewMapper {

    private ViewMapper() {
    }

    // ---------------------------------------------------------------- game

    static JsonObject game(GameView view) {
        JsonObject o = new JsonObject();
        if (view == null) {
            return o;
        }
        PlayableObjectsList canPlay = view.getCanPlayObjects();

        o.addProperty("turn", view.getTurn());
        o.addProperty("phase", view.getPhase() == null ? null : view.getPhase().name());
        o.addProperty("step", view.getStep() == null ? null : view.getStep().name());
        o.addProperty("activePlayerId", str(view.getActivePlayerId()));
        o.addProperty("activePlayerName", view.getActivePlayerName());
        o.addProperty("priorityPlayerName", view.getPriorityPlayerName());
        o.addProperty("special", view.getSpecial());
        o.addProperty("rollbackTurnsAllowed", view.isRollbackTurnsAllowed());

        PlayerView me = view.getMyPlayer();
        o.addProperty("myPlayerId", me == null ? null : str(me.getPlayerId()));

        JsonArray players = new JsonArray();
        for (PlayerView player : view.getPlayers()) {
            players.add(player(player, canPlay));
        }
        o.add("players", players);

        o.add("hand", cards(view.getMyHand(), canPlay));
        o.add("stack", cards(view.getStack(), canPlay));

        JsonArray combat = new JsonArray();
        for (CombatGroupView group : view.getCombat()) {
            JsonObject g = new JsonObject();
            g.addProperty("defenderId", str(group.getDefenderId()));
            g.addProperty("defenderName", group.getDefenderName());
            g.addProperty("blocked", group.isBlocked());
            g.add("attackers", ids(group.getAttackers().keySet()));
            g.add("blockers", ids(group.getBlockers().keySet()));
            combat.add(g);
        }
        o.add("combat", combat);

        JsonArray exiles = new JsonArray();
        for (ExileView exile : view.getExile()) {
            exiles.add(namedCards(str(exile.getId()), exile.getName(), exile, canPlay));
        }
        o.add("exiles", exiles);

        JsonArray revealed = new JsonArray();
        for (RevealedView r : view.getRevealed()) {
            revealed.add(namedCards(r.getName(), r.getName(), r.getCards(), canPlay));
        }
        o.add("revealed", revealed);

        JsonArray companion = new JsonArray();
        for (RevealedView r : view.getCompanion()) {
            companion.add(namedCards(r.getName(), r.getName(), r.getCards(), canPlay));
        }
        o.add("companion", companion);

        JsonArray lookedAt = new JsonArray();
        for (LookedAtView l : view.getLookedAt()) {
            JsonObject entry = new JsonObject();
            entry.addProperty("id", l.getName());
            entry.addProperty("name", l.getName());
            JsonArray list = new JsonArray();
            for (SimpleCardView c : l.getCards().values()) {
                list.add(c instanceof CardView ? card((CardView) c, canPlay) : simpleCard(c));
            }
            entry.add("cards", list);
            lookedAt.add(entry);
        }
        o.add("lookedAt", lookedAt);

        return o;
    }

    private static JsonObject namedCards(String id, String name, CardsView cards, PlayableObjectsList canPlay) {
        JsonObject o = new JsonObject();
        o.addProperty("id", id);
        o.addProperty("name", name);
        o.add("cards", cards(cards, canPlay));
        return o;
    }

    static JsonObject player(PlayerView p, PlayableObjectsList canPlay) {
        JsonObject o = new JsonObject();
        o.addProperty("id", str(p.getPlayerId()));
        o.addProperty("name", p.getName());
        o.addProperty("controlled", p.getControlled());
        o.addProperty("life", p.getLife());
        o.addProperty("libraryCount", p.getLibraryCount());
        o.addProperty("handCount", p.getHandCount());
        o.addProperty("active", p.isActive());
        o.addProperty("hasPriority", p.hasPriority());
        o.addProperty("hasLeft", p.hasLeft());
        o.addProperty("timerActive", p.isTimerActive());
        o.addProperty("priorityTimeLeftSecs", p.getPriorityTimeLeftSecs());
        // > 0: the player has something XMage can undo (mana tapped while holding priority)
        o.addProperty("undoSteps", p.getStatesSavedSize());
        o.addProperty("monarch", p.isMonarch());
        o.addProperty("initiative", p.isInitiative());
        o.addProperty("wins", p.getWins());
        o.addProperty("winsNeeded", p.getWinsNeeded());
        o.add("designations", strings(p.getDesignationNames()));
        o.add("counters", counters(p.getCounters()));

        ManaPoolView pool = p.getManaPool();
        JsonObject mana = new JsonObject();
        mana.addProperty("W", pool.getWhite());
        mana.addProperty("U", pool.getBlue());
        mana.addProperty("B", pool.getBlack());
        mana.addProperty("R", pool.getRed());
        mana.addProperty("G", pool.getGreen());
        mana.addProperty("C", pool.getColorless());
        o.add("manaPool", mana);

        o.add("graveyard", cards(p.getGraveyard(), canPlay));
        o.add("exile", cards(p.getExile(), canPlay));
        o.add("topCard", p.getTopCard() == null ? JsonNull.INSTANCE : card(p.getTopCard(), canPlay));

        JsonArray battlefield = new JsonArray();
        for (PermanentView permanent : p.getBattlefield().values()) {
            battlefield.add(card(permanent, canPlay));
        }
        o.add("battlefield", battlefield);

        JsonArray command = new JsonArray();
        for (CommandObjectView c : p.getCommandObjectList()) {
            command.add(commandObject(c, canPlay));
        }
        o.add("commandZone", command);
        return o;
    }

    private static JsonObject commandObject(CommandObjectView c, PlayableObjectsList canPlay) {
        if (c instanceof CardView) {
            JsonObject o = card((CardView) c, canPlay);
            o.addProperty("commandKind", "commander");
            return o;
        }
        JsonObject o = new JsonObject();
        o.addProperty("id", str(c.getId()));
        o.addProperty("name", c.getName());
        o.addProperty("set", c.getExpansionSetCode());
        o.addProperty("imageFileName", c.getImageFileName());
        o.addProperty("imageNumber", c.getImageNumber());
        o.add("rules", strings(c.getRules()));
        o.addProperty("choosable", c.isChoosable());
        o.addProperty("selected", c.isSelected());
        o.addProperty("playable", canPlay != null && canPlay.containsObject(c.getId()));
        o.addProperty("commandKind", c instanceof EmblemView ? "emblem"
                : c instanceof DungeonView ? "dungeon"
                : c instanceof PlaneView ? "plane" : "other");
        return o;
    }

    // ---------------------------------------------------------------- cards

    static JsonArray cards(Map<UUID, CardView> cards, PlayableObjectsList canPlay) {
        JsonArray list = new JsonArray();
        if (cards != null) {
            for (CardView c : cards.values()) {
                list.add(card(c, canPlay));
            }
        }
        return list;
    }

    private static JsonObject simpleCard(SimpleCardView c) {
        JsonObject o = new JsonObject();
        o.addProperty("id", str(c.getId()));
        o.addProperty("set", c.getExpansionSetCode());
        o.addProperty("number", c.getCardNumber());
        o.addProperty("choosable", c.isChoosable());
        o.addProperty("selected", c.isSelected());
        return o;
    }

    static JsonObject card(CardView c, PlayableObjectsList canPlay) {
        return card(c, canPlay, 0);
    }

    private static JsonObject card(CardView c, PlayableObjectsList canPlay, int depth) {
        // abilities (on the stack, or offered in "pick a trigger" dialogs) know the card they come from
        CardView source = c instanceof StackAbilityView ? ((StackAbilityView) c).getSourceCard()
                : c instanceof AbilityView ? ((AbilityView) c).getSourceCard() : null;
        JsonObject o = simpleCard(c);
        o.addProperty("name", c.getName());
        o.addProperty("displayName", c.getDisplayName());
        o.addProperty("imageFileName", c.getImageFileName());
        o.addProperty("imageNumber", c.getImageNumber());
        o.addProperty("token", c.isToken());
        o.addProperty("faceDown", c.isFaceDown());
        o.addProperty("typeLine", c.getTypeText());
        o.add("types", enums(c.getCardTypes()));
        o.addProperty("manaCost", c.getManaCostStr());
        o.addProperty("manaValue", c.getManaValue());
        o.addProperty("colors", c.getColor() == null ? "" : c.getColor().toString());
        o.addProperty("frameColors", c.getFrameColor() == null ? "" : c.getFrameColor().toString());
        o.addProperty("rarity", c.getRarity() == null ? null : c.getRarity().name());
        o.add("rules", rules(c.getRules(), source == null ? c.getName() : source.getName()));
        o.addProperty("power", c.getPower());
        o.addProperty("toughness", c.getToughness());
        o.addProperty("loyalty", c.getLoyalty());
        o.addProperty("defense", c.getDefense());
        o.add("counters", counters(c.getCounters()));
        o.addProperty("zone", c.getZone() == null ? null : c.getZone().name());
        o.addProperty("objectType", c.getMageObjectType() == null ? null : c.getMageObjectType().name());
        o.addProperty("isAbility", c.isAbility() || c instanceof AbilityView);
        o.addProperty("abilityType", c.getAbilityType() == null ? null : c.getAbilityType().name());
        o.addProperty("paid", c.isPaid());
        o.addProperty("canTransform", c.canTransform());
        o.addProperty("transformed", c.isTransformed());
        o.addProperty("split", c.isSplitCard());
        o.addProperty("flipCard", c.isFlipCard());
        o.addProperty("canAttack", c.isCanAttack());
        o.addProperty("canBlock", c.isCanBlock());
        o.addProperty("controlledByOwner", c.isControlledByOwner());
        o.add("targets", ids(c.getTargets()));
        o.addProperty("parentId", str(c.getParentId()));
        o.addProperty("pairedCard", str(c.getPairedCard()));

        // playable info lives on the GameView, the Swing client copies it onto each card too
        PlayableObjectStats stats = canPlay == null ? null : canPlay.getStats(c.getId());
        int playableAmount = stats == null ? 0 : stats.getPlayableAmount();
        o.addProperty("playable", playableAmount > 0);
        o.addProperty("playableAmount", playableAmount);
        if (playableAmount > 0) {
            o.add("playableAbilities", strings(stats.getPlayableAbilityNames()));
        }

        if (depth < 2) {
            if (c.getSecondCardFace() != null) {
                o.add("secondFace", card(c.getSecondCardFace(), null, depth + 1));
            }
            if (source != null) {
                o.add("sourceCard", card(source, null, depth + 1));
            }
        }

        if (c instanceof PermanentView) {
            PermanentView p = (PermanentView) c;
            o.addProperty("permanent", true);
            o.addProperty("tapped", p.isTapped());
            o.addProperty("damage", p.getDamage());
            o.addProperty("summoningSick", p.hasSummoningSickness());
            o.addProperty("phasedIn", p.isPhasedIn());
            o.addProperty("flipped", p.isFlipped());
            o.addProperty("copy", p.isCopy());
            o.addProperty("controlled", p.isControlled());
            o.addProperty("ownerName", p.getNameOwner());
            o.addProperty("controllerName", p.getNameController());
            o.addProperty("attachedTo", str(p.getAttachedTo()));
            o.addProperty("attachedToPermanent", p.isAttachedToPermanent());
            o.add("attachments", ids(p.getAttachments()));
            o.addProperty("morphed", p.isMorphed());
            o.addProperty("disguised", p.isDisguised());
            o.addProperty("manifested", p.isManifested());
            o.addProperty("cloaked", p.isCloaked());
        }
        return o;
    }

    // ---------------------------------------------------------------- prompts

    static JsonObject gameMessage(GameClientMessage m) {
        JsonObject o = new JsonObject();
        o.add("game", game(m.getGameView()));
        o.addProperty("message", m.getMessage());
        o.addProperty("required", m.isFlag());
        o.addProperty("min", m.getMin());
        o.addProperty("max", m.getMax());
        o.add("targets", ids(m.getTargets()));
        PlayableObjectsList canPlay = m.getGameView() == null ? null : m.getGameView().getCanPlayObjects();
        if (m.getCardsView1() != null) {
            o.add("cards1", cards(m.getCardsView1(), canPlay));
        }
        if (m.getCardsView2() != null) {
            o.add("cards2", cards(m.getCardsView2(), canPlay));
        }
        o.add("options", options(m.getOptions()));
        if (m.getChoice() != null) {
            o.add("choice", choice(m.getChoice()));
        }
        if (m.getMessages() != null) {
            JsonArray list = new JsonArray();
            for (MultiAmountMessage mm : m.getMessages()) {
                JsonObject e = new JsonObject();
                e.addProperty("message", mm.message);
                e.addProperty("min", mm.min);
                e.addProperty("max", mm.max);
                e.addProperty("defaultValue", mm.defaultValue);
                list.add(e);
            }
            o.add("multiAmount", list);
        }
        return o;
    }

    static JsonObject abilityPicker(AbilityPickerView v) {
        JsonObject o = new JsonObject();
        o.add("game", game(v.getGameView()));
        o.addProperty("message", v.getMessage());
        JsonArray choices = new JsonArray();
        for (Map.Entry<UUID, String> e : v.getChoices().entrySet()) {
            JsonObject c = new JsonObject();
            c.addProperty("id", str(e.getKey()));
            c.addProperty("text", e.getValue());
            choices.add(c);
        }
        o.add("abilities", choices);
        return o;
    }

    private static JsonObject choice(Choice c) {
        JsonObject o = new JsonObject();
        o.addProperty("message", c.getMessage());
        o.addProperty("subMessage", c.getSubMessage());
        o.addProperty("required", c.isRequired());
        o.addProperty("keyChoice", c.isKeyChoice());
        o.addProperty("manaColorChoice", c.isManaColorChoice());
        o.addProperty("searchEnabled", c.isSearchEnabled());
        o.addProperty("specialEnabled", c.isSpecialEnabled());
        o.addProperty("specialText", c.getSpecialText());
        JsonArray items = new JsonArray();
        if (c.isKeyChoice()) {
            for (Map.Entry<String, String> e : c.getKeyChoices().entrySet()) {
                JsonObject item = new JsonObject();
                item.addProperty("key", e.getKey());
                item.addProperty("text", e.getValue());
                items.add(item);
            }
        } else if (c.getChoices() != null) {
            for (String s : c.getChoices()) {
                JsonObject item = new JsonObject();
                item.addProperty("key", s);
                item.addProperty("text", s);
                items.add(item);
            }
        }
        o.add("items", items);
        return o;
    }

    /**
     * Options are a loose map on the XMage side; only plain values are forwarded
     * (strings, numbers, booleans, ids and collections of them).
     */
    private static JsonObject options(Map<String, Serializable> options) {
        JsonObject o = new JsonObject();
        if (options == null) {
            return o;
        }
        for (Map.Entry<String, Serializable> e : options.entrySet()) {
            JsonElement value = plain(e.getValue());
            if (value != null) {
                o.add(e.getKey(), value);
            }
        }
        return o;
    }

    private static JsonElement plain(Object v) {
        if (v instanceof String) {
            return new JsonPrimitive((String) v);
        } else if (v instanceof Number) {
            return new JsonPrimitive((Number) v);
        } else if (v instanceof Boolean) {
            return new JsonPrimitive((Boolean) v);
        } else if (v instanceof UUID || v instanceof Enum) {
            return new JsonPrimitive(v.toString());
        } else if (v instanceof Collection) {
            JsonArray list = new JsonArray();
            for (Object item : (Collection<?>) v) {
                JsonElement e = plain(item);
                if (e != null) {
                    list.add(e);
                }
            }
            return list;
        }
        return null;
    }

    // ---------------------------------------------------------------- lobby / chat

    static JsonObject table(TableView t) {
        JsonObject o = new JsonObject();
        o.addProperty("id", str(t.getTableId()));
        o.addProperty("name", t.getTableName());
        o.addProperty("controllerName", t.getControllerName());
        o.addProperty("gameType", t.getGameType());
        o.addProperty("deckType", t.getDeckType());
        o.addProperty("state", t.getTableState() == null ? null : t.getTableState().name());
        o.addProperty("stateText", t.getTableStateText());
        o.addProperty("info", t.getAdditionalInfoShort());
        o.addProperty("passworded", t.isPassworded());
        JsonArray seats = new JsonArray();
        for (SeatView s : t.getSeats()) {
            JsonObject seat = new JsonObject();
            seat.addProperty("playerId", str(s.getPlayerId()));
            seat.addProperty("playerName", s.getPlayerName());
            seat.addProperty("playerType", s.getPlayerType() == null ? null : s.getPlayerType().toString());
            seats.add(seat);
        }
        o.add("seats", seats);
        o.add("games", ids(t.getGames()));
        return o;
    }

    static JsonObject chat(ChatMessage m) {
        JsonObject o = new JsonObject();
        o.addProperty("username", m.getUsername());
        o.addProperty("time", m.getTime() == null ? null : m.getTime().getTime());
        o.addProperty("turnInfo", m.getTurnInfo());
        o.addProperty("message", m.getMessage());
        o.addProperty("color", m.getColor() == null ? null : m.getColor().name());
        o.addProperty("messageType", m.getMessageType() == null ? null : m.getMessageType().name());
        return o;
    }

    static JsonObject tableMessage(TableClientMessage m) {
        JsonObject o = new JsonObject();
        o.addProperty("roomId", str(m.getRoomId()));
        o.addProperty("tableId", str(m.getCurrentTableId()));
        o.addProperty("parentTableId", str(m.getParentTableId()));
        o.addProperty("gameId", str(m.getGameId()));
        o.addProperty("playerId", str(m.getPlayerId()));
        o.addProperty("flag", m.getFlag());
        return o;
    }

    static JsonObject gameEnd(GameEndView v) {
        JsonObject o = new JsonObject();
        o.addProperty("won", v.hasWon());
        o.addProperty("gameInfo", v.getGameInfo());
        o.addProperty("matchInfo", v.getMatchInfo());
        o.addProperty("additionalInfo", v.getAdditionalInfo());
        o.addProperty("wins", v.getWins());
        o.addProperty("loses", v.getLoses());
        o.addProperty("winsNeeded", v.getWinsNeeded());
        return o;
    }

    static JsonObject userRequest(UserRequestMessage m) {
        JsonObject o = new JsonObject();
        o.addProperty("title", m.getTitle());
        o.addProperty("message", m.getMessage());
        o.addProperty("gameId", str(m.getGameId()));
        o.addProperty("relatedUserId", str(m.getRelatedUserId()));
        JsonArray buttons = new JsonArray();
        addButton(buttons, m.getButton1Text(), m.getButton1Action());
        addButton(buttons, m.getButton2Text(), m.getButton2Action());
        addButton(buttons, m.getButton3Text(), m.getButton3Action());
        o.add("buttons", buttons);
        return o;
    }

    private static void addButton(JsonArray buttons, String text, Enum<?> action) {
        if (text == null) {
            return;
        }
        JsonObject b = new JsonObject();
        b.addProperty("text", text);
        b.addProperty("action", action == null ? null : action.name());
        buttons.add(b);
    }

    // ---------------------------------------------------------------- helpers

    private static JsonArray counters(List<CounterView> counters) {
        JsonArray list = new JsonArray();
        if (counters != null) {
            for (CounterView c : counters) {
                JsonObject o = new JsonObject();
                o.addProperty("name", c.getName());
                o.addProperty("count", c.getCount());
                list.add(o);
            }
        }
        return list;
    }

    /**
     * Rule texts refer to their own card with a placeholder, the Swing client fills it in while rendering
     */
    private static JsonArray rules(List<String> rules, String cardName) {
        JsonArray list = new JsonArray();
        if (rules != null) {
            String name = cardName == null ? "this" : cardName;
            for (String rule : rules) {
                list.add(rule == null ? "" : rule.replace("{this}", name).replace("{source}", name));
            }
        }
        return list;
    }

    static JsonArray ids(Collection<UUID> ids) {
        JsonArray list = new JsonArray();
        if (ids != null) {
            for (UUID id : ids) {
                list.add(str(id));
            }
        }
        return list;
    }

    private static JsonArray strings(Collection<String> values) {
        JsonArray list = new JsonArray();
        if (values != null) {
            for (String s : values) {
                list.add(s);
            }
        }
        return list;
    }

    private static JsonArray enums(Collection<? extends Enum<?>> values) {
        JsonArray list = new JsonArray();
        if (values != null) {
            for (Enum<?> e : values) {
                list.add(e.name());
            }
        }
        return list;
    }

    static String str(UUID id) {
        return id == null ? null : id.toString();
    }
}
