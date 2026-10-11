package dev.mtgui.gateway;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import io.javalin.http.Context;
import org.apache.log4j.Logger;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Card art for the browser: fetched once from Scryfall, then served from a local disk cache.
 * <p>
 * Scryfall rate-limits its API, so requests go out one at a time with a small pause;
 * the browser only ever talks to the gateway.
 */
final class CardImages {

    private static final Logger logger = Logger.getLogger(CardImages.class);
    private static final String API = "https://api.scryfall.com";
    private static final long PAUSE_MS = 110;

    private final Path cacheDir;
    private final HttpClient http = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private final Set<String> missing = ConcurrentHashMap.newKeySet();
    private final Object throttle = new Object();
    private long lastRequest = 0;

    // XMage's own token / emblem art table: "SET/Name" or "SET/Name/imageNumber" -> image link
    private final Map<String, String> tokenLinks = new HashMap<>();
    private final Map<String, String> tokenLinksByName = new HashMap<>();

    CardImages(Path cacheDir) throws IOException {
        this.cacheDir = cacheDir;
        Files.createDirectories(cacheDir);
        try (InputStream in = CardImages.class.getResourceAsStream("/token-images.tsv")) {
            if (in == null) {
                logger.warn("token-images.tsv is missing (scripts/sync-token-images.sh creates it), tokens will be looked up by name");
                return;
            }
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String line;
            while ((line = reader.readLine()) != null) {
                String[] parts = line.split("\t");
                if (parts.length != 2) {
                    continue;
                }
                String key = parts[0].toLowerCase(Locale.ENGLISH);
                tokenLinks.put(key, parts[1]);
                String[] path = key.split("/");
                if (path.length >= 2) {
                    tokenLinksByName.putIfAbsent(path[1], parts[1]);
                }
            }
        }
    }

    private String knownTokenLink(String set, String name, String imageNumber) {
        String key = set + "/" + name.toLowerCase(Locale.ENGLISH);
        String link = imageNumber.isEmpty() || imageNumber.equals("0") ? null : tokenLinks.get(key + "/" + imageNumber);
        if (link == null) {
            link = tokenLinks.get(key);
        }
        if (link == null) {
            link = tokenLinks.get(key + "/1");
        }
        if (link == null) {
            // same token from any other set is better than a drawn placeholder
            link = tokenLinksByName.get(name.toLowerCase(Locale.ENGLISH));
        }
        if (link != null && link.contains("api.scryfall.com") && !link.contains("version=")) {
            link += (link.contains("?") ? "&" : "?") + "version=normal";
        }
        return link;
    }

    /**
     * GET /img/card?set=&number=&name=&token=&back=
     * (for tokens: name = XMage's image name, number = its image number)
     */
    void handle(Context ctx) {
        String set = clean(ctx.queryParam("set")).toLowerCase(Locale.ENGLISH);
        String number = clean(ctx.queryParam("number"));
        String name = ctx.queryParam("name") == null ? "" : ctx.queryParam("name").trim();
        boolean token = "1".equals(ctx.queryParam("token"));
        boolean back = "1".equals(ctx.queryParam("back"));

        String key = (token ? "token_" + set + "_" + slug(name) + "_" + slug(number) : set + "_" + slug(number) + "_" + slug(name))
                + (back ? "_back" : "");
        Path file = cacheDir.resolve(key + ".jpg");
        try {
            if (!Files.exists(file)) {
                if (missing.contains(key) || !download(file, set, number, name, token, back)) {
                    missing.add(key);
                    ctx.status(404);
                    return;
                }
            }
            ctx.contentType("image/jpeg");
            ctx.header("Cache-Control", "public, max-age=31536000, immutable");
            ctx.result(Files.newInputStream(file));
        } catch (IOException e) {
            logger.warn("Image error for " + key + ": " + e);
            ctx.status(502);
        }
    }

    private boolean download(Path file, String set, String number, String name, boolean token, boolean back) throws IOException {
        String face = back ? "&face=back" : "";
        if (token) {
            String known = knownTokenLink(set, name, number);
            if (known != null && fetchImage(known, file)) {
                return true;
            }
            String url = tokenImageUrl(name, set);
            return url != null && fetchImage(url, file);
        }
        if (!set.isEmpty() && !number.isEmpty()
                && fetchImage(API + "/cards/" + enc(set) + "/" + enc(number) + "?format=image&version=normal" + face, file)) {
            return true;
        }
        // XMage and Scryfall disagree on some set codes / collector numbers: fall back to the name
        return !name.isEmpty()
                && fetchImage(API + "/cards/named?exact=" + enc(name) + "&format=image&version=normal" + face, file);
    }

    private String tokenImageUrl(String name, String set) throws IOException {
        if (name.isEmpty()) {
            return null;
        }
        String base = "!\"" + name.replace("\"", "") + "\" (is:token or t:emblem)";
        String[] queries = set.isEmpty()
                ? new String[]{base}
                : new String[]{base + " set:t" + set, base};
        for (String query : queries) {
            HttpResponse<String> response = send(API + "/cards/search?unique=prints&q=" + enc(query),
                    HttpResponse.BodyHandlers.ofString());
            if (response == null || response.statusCode() != 200) {
                continue;
            }
            JsonArray data = JsonParser.parseString(response.body()).getAsJsonObject().getAsJsonArray("data");
            if (data == null || data.isEmpty()) {
                continue;
            }
            JsonObject card = data.get(0).getAsJsonObject();
            JsonObject uris = card.getAsJsonObject("image_uris");
            if (uris == null && card.has("card_faces")) {
                uris = card.getAsJsonArray("card_faces").get(0).getAsJsonObject().getAsJsonObject("image_uris");
            }
            if (uris != null && uris.has("normal")) {
                return uris.get("normal").getAsString();
            }
        }
        return null;
    }

    private boolean fetchImage(String url, Path file) throws IOException {
        Path tmp = Files.createTempFile(cacheDir, "dl", ".tmp");
        try {
            HttpResponse<Path> response = send(url, HttpResponse.BodyHandlers.ofFile(tmp));
            if (response == null || response.statusCode() != 200) {
                return false;
            }
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
            return true;
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    private <T> HttpResponse<T> send(String url, HttpResponse.BodyHandler<T> handler) throws IOException {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(20))
                .header("User-Agent", "mtg-ui-gateway/0.1")
                .header("Accept", "*/*")
                .build();
        synchronized (throttle) {
            long wait = lastRequest + PAUSE_MS - System.currentTimeMillis();
            try {
                if (wait > 0) {
                    Thread.sleep(wait);
                }
                return http.send(request, handler);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            } finally {
                lastRequest = System.currentTimeMillis();
            }
        }
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }

    private static String slug(String value) {
        return value.toLowerCase(Locale.ENGLISH).replaceAll("[^a-z0-9]+", "-");
    }

    private static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
