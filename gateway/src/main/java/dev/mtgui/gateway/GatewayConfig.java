package dev.mtgui.gateway;

import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Gateway settings, all from environment variables (see README)
 */
final class GatewayConfig {

    final int port = Integer.parseInt(env("GATEWAY_PORT", "8080"));
    // shared secret the browser must send before anything else; empty = open access
    final String password = env("GATEWAY_PASSWORD", "");
    // true: start the XMage server inside this process; false: connect to one that is already running
    final boolean embeddedServer = Boolean.parseBoolean(env("XMAGE_EMBEDDED", "true"));
    final String xmageHost = env("XMAGE_HOST", "127.0.0.1");
    final int xmagePort = Integer.parseInt(env("XMAGE_PORT", "17171"));
    final String defaultGameType = env("XMAGE_GAME_TYPE", "Commander Two Player Duel");
    final String defaultDeckType = env("XMAGE_DECK_TYPE", "Variant Magic - Commander");
    // built web client (vite build output); skipped if missing, e.g. while using the vite dev server
    final Path webDist = Paths.get(env("WEB_DIST", "../web/dist")).toAbsolutePath().normalize();
    final Path imageCache = Paths.get(env("IMAGE_CACHE", "imgcache")).toAbsolutePath().normalize();
    final long sessionTimeoutMs = Long.parseLong(env("SESSION_TIMEOUT_MINUTES", "30")) * 60_000L;

    private static String env(String key, String fallback) {
        String value = System.getenv(key);
        return value == null || value.isEmpty() ? fallback : value;
    }
}
