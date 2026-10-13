package dev.mtgui.gateway;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import mage.players.net.SkipPrioritySteps;
import mage.players.net.UserData;
import mage.players.net.UserGroup;
import mage.players.net.UserSkipPrioritySteps;

/**
 * The player's XMage preferences (mage.players.net.UserData) as JSON and back.
 * The browser keeps them and sends them along; XMage applies them on the server.
 */
final class Settings {

    private Settings() {
    }

    /** XMage's defaults, in the shape the browser edits */
    /**
     * XMage's defaults, except where MTG Arena's behaviour is the better starting point:
     * a spell or ability passes priority by itself (Ctrl holds it), and on the opponent's turn
     * the game waits at the end step rather than in both main phases.
     */
    static JsonObject defaults() {
        JsonObject o = toJson(UserData.getDefaultUserDataView());
        o.addProperty("passPriorityCast", true);
        o.addProperty("passPriorityActivation", true);
        JsonObject theirs = o.getAsJsonObject("opponentTurn");
        theirs.addProperty("main1", false);
        theirs.addProperty("main2", false);
        theirs.addProperty("endOfTurn", true);
        return o;
    }

    /** What a player may change outside test mode: where the game stops, and trigger ordering */
    static JsonObject playerChoices(JsonObject json) {
        JsonObject o = new JsonObject();
        if (json != null) {
            for (String key : new String[]{"yourTurn", "opponentTurn", "autoOrderTrigger"}) {
                if (json.has(key)) {
                    o.add(key, json.get(key));
                }
            }
        }
        return o;
    }

    static JsonObject toJson(UserData data) {
        JsonObject o = new JsonObject();
        UserSkipPrioritySteps stops = data.getUserSkipPrioritySteps();
        o.add("yourTurn", steps(stops.getYourTurn()));
        o.add("opponentTurn", steps(stops.getOpponentTurn()));
        o.addProperty("stopOnDeclareAttackers", stops.isStopOnDeclareAttackers());
        o.addProperty("stopOnDeclareBlockersWithZeroPermanents", stops.isStopOnDeclareBlockersWithZeroPermanents());
        o.addProperty("stopOnDeclareBlockersWithAnyPermanents", stops.isStopOnDeclareBlockersWithAnyPermanents());
        o.addProperty("stopOnAllMainPhases", stops.isStopOnAllMainPhases());
        o.addProperty("stopOnAllEndPhases", stops.isStopOnAllEndPhases());
        o.addProperty("stopOnStackNewObjects", stops.isStopOnStackNewObjects());
        o.addProperty("confirmEmptyManaPool", data.confirmEmptyManaPool());
        o.addProperty("askMoveToGraveOrder", data.askMoveToGraveOrder());
        o.addProperty("manaPoolAutomatic", data.isManaPoolAutomatic());
        o.addProperty("manaPoolAutomaticRestricted", data.isManaPoolAutomaticRestricted());
        o.addProperty("passPriorityCast", data.isPassPriorityCast());
        o.addProperty("passPriorityActivation", data.isPassPriorityActivation());
        o.addProperty("autoOrderTrigger", data.isAutoOrderTrigger());
        o.addProperty("autoTargetLevel", data.getAutoTargetLevel());
        o.addProperty("useSameSettingsForReplacementEffects", data.isUseSameSettingsForReplacementEffects());
        o.addProperty("useFirstManaAbility", data.isUseFirstManaAbility());
        o.addProperty("allowRequestShowHandCards", data.isAllowRequestHandToAll());
        o.addProperty("flagName", data.getFlagName());
        o.addProperty("avatarId", data.getAvatarId());
        return o;
    }

    private static JsonObject steps(SkipPrioritySteps s) {
        JsonObject o = new JsonObject();
        o.addProperty("upkeep", s.isUpkeep());
        o.addProperty("draw", s.isDraw());
        o.addProperty("main1", s.isMain1());
        o.addProperty("beforeCombat", s.isBeforeCombat());
        o.addProperty("endOfCombat", s.isEndOfCombat());
        o.addProperty("main2", s.isMain2());
        o.addProperty("endOfTurn", s.isEndOfTurn());
        return o;
    }

    /** Missing or malformed entries keep XMage's default */
    static UserData fromJson(JsonObject json) {
        JsonObject d = defaults();
        JsonObject j = json == null ? new JsonObject() : json;
        UserSkipPrioritySteps stops = new UserSkipPrioritySteps();
        readSteps(stops.getYourTurn(), d.getAsJsonObject("yourTurn"));
        readSteps(stops.getOpponentTurn(), d.getAsJsonObject("opponentTurn"));
        readSteps(stops.getYourTurn(), j.has("yourTurn") && j.get("yourTurn").isJsonObject() ? j.getAsJsonObject("yourTurn") : null);
        readSteps(stops.getOpponentTurn(), j.has("opponentTurn") && j.get("opponentTurn").isJsonObject() ? j.getAsJsonObject("opponentTurn") : null);
        stops.setStopOnDeclareAttackersDuringSkipActions(bool(j, d, "stopOnDeclareAttackers"));
        stops.setStopOnDeclareBlockersWithZeroPermanents(bool(j, d, "stopOnDeclareBlockersWithZeroPermanents"));
        stops.setStopOnDeclareBlockersWithAnyPermanents(bool(j, d, "stopOnDeclareBlockersWithAnyPermanents"));
        stops.setStopOnAllMainPhases(bool(j, d, "stopOnAllMainPhases"));
        stops.setStopOnAllEndPhases(bool(j, d, "stopOnAllEndPhases"));
        stops.setStopOnStackNewObjects(bool(j, d, "stopOnStackNewObjects"));
        JsonElement level = j.get("autoTargetLevel");
        JsonElement avatar = j.get("avatarId");
        JsonElement flag = j.get("flagName");
        return new UserData(
                UserGroup.PLAYER,
                avatar != null && avatar.isJsonPrimitive() ? avatar.getAsInt() : 0,
                bool(j, d, "allowRequestShowHandCards"),
                bool(j, d, "confirmEmptyManaPool"),
                stops,
                flag != null && flag.isJsonPrimitive() ? flag.getAsString() : d.get("flagName").getAsString(),
                bool(j, d, "askMoveToGraveOrder"),
                bool(j, d, "manaPoolAutomatic"),
                bool(j, d, "manaPoolAutomaticRestricted"),
                bool(j, d, "passPriorityCast"),
                bool(j, d, "passPriorityActivation"),
                bool(j, d, "autoOrderTrigger"),
                level != null && level.isJsonPrimitive() ? Math.max(0, Math.min(2, level.getAsInt())) : d.get("autoTargetLevel").getAsInt(),
                bool(j, d, "useSameSettingsForReplacementEffects"),
                bool(j, d, "useFirstManaAbility"),
                ""
        );
    }

    private static void readSteps(SkipPrioritySteps target, JsonObject j) {
        if (j == null) {
            return;
        }
        target.setUpkeep(flag(j, "upkeep", target.isUpkeep()));
        target.setDraw(flag(j, "draw", target.isDraw()));
        target.setMain1(flag(j, "main1", target.isMain1()));
        target.setBeforeCombat(flag(j, "beforeCombat", target.isBeforeCombat()));
        target.setEndOfCombat(flag(j, "endOfCombat", target.isEndOfCombat()));
        target.setMain2(flag(j, "main2", target.isMain2()));
        target.setEndOfTurn(flag(j, "endOfTurn", target.isEndOfTurn()));
    }

    private static boolean flag(JsonObject j, String key, boolean fallback) {
        JsonElement e = j.get(key);
        return e != null && e.isJsonPrimitive() && e.getAsJsonPrimitive().isBoolean() ? e.getAsBoolean() : fallback;
    }

    private static boolean bool(JsonObject j, JsonObject defaults, String key) {
        return flag(j, key, defaults.get(key).getAsBoolean());
    }
}
