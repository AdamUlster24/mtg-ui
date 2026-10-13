package dev.mtgui.gateway;

import mage.cards.decks.DeckCardInfo;
import mage.cards.decks.DeckCardLists;
import mage.cards.repository.CardInfo;
import mage.cards.repository.CardRepository;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses a pasted decklist (Moxfield / Archidekt / MTGA / plain "1 Card Name" text) into XMage's
 * DeckCardLists, resolving names against the XMage card database.
 * <p>
 * XMage keeps commanders in the sideboard, so anything in a "Commander" section (or named
 * explicitly by the caller) ends up there and everything else goes to the main deck.
 */
final class DeckText {

    // "1 Sol Ring", "1x Sol Ring", "1 Sol Ring (C21) 263", "1 Sol Ring [C21]", optional trailing foil/etched marks
    private static final Pattern LINE = Pattern.compile(
            "^(?:(\\d+)\\s*x?\\s+)?(.+?)(?:\\s+[(\\[]([A-Za-z0-9]{2,6})[)\\]](?:\\s+(\\S+))?)?(?:\\s+\\*\\w+\\*)*$");

    static final class Result {
        final DeckCardLists deck = new DeckCardLists();
        final List<String> errors = new ArrayList<>();
        /** things the player should know that are not problems, e.g. a card listed under another name */
        final List<String> notes = new ArrayList<>();
        int mainCount;
        final List<String> commanders = new ArrayList<>();
    }

    private DeckText() {
    }

    static Result parse(String text, String commanderNames) {
        return parse(text, commanderNames, false);
    }

    /**
     * @param withSideboard a regular (non-Commander) deck: the "Sideboard" section is a real sideboard
     */
    static Result parse(String text, String commanderNames, boolean withSideboard) {
        Result result = new Result();
        List<String> wantedCommanders = new ArrayList<>();
        if (commanderNames != null) {
            for (String name : commanderNames.split("[\\n;]")) {
                if (!name.trim().isEmpty()) {
                    wantedCommanders.add(normalize(name));
                }
            }
        }

        boolean commanderSection = false;
        boolean skipSection = false;
        boolean headers = false;
        // cards of the main deck listed after the last blank line: MTGO-style exports put the commander there
        List<DeckCardInfo> tail = new ArrayList<>();
        for (String raw : (text == null ? "" : text).split("\\r?\\n")) {
            String line = raw.trim();
            if (line.isEmpty()) {
                if (result.mainCount > 0) {
                    tail = new ArrayList<>();
                }
                continue;
            }
            if (line.startsWith("//") || line.startsWith("#")) {
                continue;
            }

            String header = line.toLowerCase(Locale.ENGLISH).replaceAll("[:\\s]+$", "").replaceAll("\\s*\\(\\d+\\)$", "");
            if (header.equals("commander") || header.equals("commanders")) {
                headers = true;
                commanderSection = true;
                skipSection = false;
                continue;
            }
            if (header.equals("deck") || header.equals("mainboard") || header.equals("main") || header.equals("companion")) {
                headers = true;
                commanderSection = false;
                skipSection = false;
                continue;
            }
            if (header.equals("sideboard") && withSideboard) {
                headers = true;
                // XMage keeps commanders and sideboard cards in the same list
                commanderSection = true;
                skipSection = false;
                continue;
            }
            if (header.equals("sideboard") || header.equals("maybeboard") || header.equals("considering") || header.equals("tokens")) {
                headers = true;
                // commander decks have no sideboard and XMage uses that zone for the commander
                commanderSection = false;
                skipSection = true;
                continue;
            }
            if (skipSection) {
                continue;
            }

            Matcher m = LINE.matcher(line);
            if (!m.matches()) {
                result.errors.add("Can't read line: " + line);
                continue;
            }
            int amount = m.group(1) == null ? 1 : Integer.parseInt(m.group(1));
            String name = m.group(2).trim();
            String set = m.group(3);
            String number = m.group(4);

            CardInfo info = find(name, set, number);
            if (info == null) {
                // printed under another name (Universes Beyond and Secret Lair reskins): XMage knows the original
                String real = realName(name);
                info = real == null ? null : find(real, null, null);
                if (info != null) {
                    result.notes.add(name + " is " + info.getName());
                }
            }
            if (info == null) {
                result.errors.add("Unknown card: " + name);
                continue;
            }

            boolean isCommander = commanderSection || wantedCommanders.contains(normalize(info.getName()))
                    || wantedCommanders.contains(normalize(name));
            DeckCardInfo card = new DeckCardInfo(info.getName(), info.getCardNumber(), info.getSetCode(), amount);
            if (isCommander) {
                result.deck.getSideboard().add(card);
                result.commanders.add(info.getName());
            } else {
                result.deck.getCards().add(card);
                result.mainCount += amount;
                tail.add(card);
            }
        }

        // no commander named anywhere: one or two cards set apart at the end of the list are the commander
        int tailCount = tail.stream().mapToInt(DeckCardInfo::getAmount).sum();
        if (!withSideboard && !headers && wantedCommanders.isEmpty() && result.commanders.isEmpty()
                && tailCount >= 1 && tailCount <= 2 && tailCount < result.mainCount) {
            for (DeckCardInfo card : tail) {
                result.deck.getCards().remove(card);
                result.deck.getSideboard().add(card);
                result.commanders.add(card.getCardName());
            }
            result.mainCount -= tailCount;
        }

        for (String wanted : wantedCommanders) {
            if (result.commanders.stream().noneMatch(c -> normalize(c).equals(wanted))) {
                // commander not part of the pasted list: add it
                CardInfo info = find(wanted, null, null);
                if (info == null) {
                    result.errors.add("Unknown commander: " + wanted);
                } else {
                    result.deck.getSideboard().add(new DeckCardInfo(info.getName(), info.getCardNumber(), info.getSetCode(), 1));
                    result.commanders.add(info.getName());
                }
            }
        }
        return result;
    }

    private static CardInfo find(String name, String set, String number) {
        CardRepository repo = CardRepository.instance;
        CardInfo info = lookup(repo, name, set, number);
        if (info == null && name.contains("/")) {
            // "Front // Back" for double faced cards: XMage knows them by the front face,
            // real split cards are stored as "Left // Right"
            String normalized = name.replaceAll("\\s*/+\\s*", " // ");
            info = lookup(repo, normalized, set, number);
            if (info == null) {
                info = lookup(repo, normalized.substring(0, normalized.indexOf(" // ")), set, number);
            }
        }
        return info;
    }

    private static final Map<String, String> REAL_NAMES = new ConcurrentHashMap<>();
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    /** Asks Scryfall which card is printed under this name; null when it knows none or can't be reached */
    private static String realName(String name) {
        String found = REAL_NAMES.computeIfAbsent(normalize(name), key -> {
            try {
                HttpRequest request = HttpRequest.newBuilder(URI.create("https://api.scryfall.com/cards/named?exact=" + URLEncoder.encode(name, StandardCharsets.UTF_8)))
                        .timeout(Duration.ofSeconds(8))
                        .header("User-Agent", "mtg-ui-gateway/0.1")
                        .header("Accept", "application/json")
                        .build();
                HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() != 200) {
                    return "";
                }
                JsonObject card = JsonParser.parseString(response.body()).getAsJsonObject();
                String real = card.has("name") ? card.get("name").getAsString() : "";
                return normalize(real).equals(key) ? "" : real;
            } catch (Exception e) {
                if (e instanceof InterruptedException) {
                    Thread.currentThread().interrupt();
                }
                return "";
            }
        });
        return found.isEmpty() ? null : found;
    }

    private static CardInfo lookup(CardRepository repo, String name, String set, String number) {
        if (set != null) {
            CardInfo info = repo.findCardWithPreferredSetAndNumber(name, set.toUpperCase(Locale.ENGLISH), number);
            if (info != null) {
                return info;
            }
        }
        return repo.findPreferredCoreExpansionCard(name);
    }

    private static String normalize(String name) {
        return name.trim().toLowerCase(Locale.ENGLISH);
    }
}
