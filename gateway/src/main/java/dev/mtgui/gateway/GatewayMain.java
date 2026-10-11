package dev.mtgui.gateway;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import io.javalin.Javalin;
import io.javalin.http.staticfiles.Location;
import io.javalin.websocket.WsContext;
import org.apache.log4j.Logger;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Browser gateway for XMage.
 * <p>
 * Browser (JSON over websocket) <-> this process <-> XMage server (its normal client protocol).
 * The XMage server is unmodified; by default it is started inside this JVM.
 */
public final class GatewayMain {

    private static final Logger logger = Logger.getLogger(GatewayMain.class);
    private static final String SESSION_ATTR = "session";
    private static final int PING_SECS = 20; // same as the Swing client

    private final GatewayConfig config = new GatewayConfig();
    private final Map<String, ClientSession> sessions = new ConcurrentHashMap<>();

    public static void main(String[] args) throws Exception {
        System.setProperty("java.awt.headless", "true");
        new GatewayMain().start(args);
    }

    private void start(String[] args) throws Exception {
        if (config.embeddedServer) {
            logger.info("Starting embedded XMage server...");
            mage.server.Main.main(args);
            waitForServer();
        }

        CardImages images = new CardImages(config.imageCache);

        Javalin app = Javalin.create(cfg -> {
            cfg.showJavalinBanner = false;
            cfg.jetty.modifyWebSocketServletFactory(factory -> {
                factory.setIdleTimeout(Duration.ofMinutes(5));
                factory.setMaxTextMessageSize(4 * 1024 * 1024);
            });
            if (Files.isDirectory(config.webDist)) {
                cfg.staticFiles.add(config.webDist.toString(), Location.EXTERNAL);
                cfg.spaRoot.addFile("/", config.webDist.resolve("index.html").toString(), Location.EXTERNAL);
            } else {
                logger.warn("Web client build not found at " + config.webDist + " (fine with the vite dev server)");
            }
        });

        app.get("/api/health", ctx -> ctx.result("ok"));
        app.get("/img/card", images::handle);

        app.ws("/ws", ws -> {
            ws.onMessage(ctx -> onMessage(ctx, ctx.message()));
            ws.onClose(ctx -> {
                ClientSession session = ctx.attribute(SESSION_ATTR);
                if (session != null) {
                    session.detach(ctx);
                }
            });
            ws.onError(ctx -> logger.debug("Websocket error: " + ctx.error()));
        });

        ScheduledExecutorService housekeeping = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "gateway-housekeeping");
            t.setDaemon(true);
            return t;
        });
        housekeeping.scheduleAtFixedRate(this::housekeeping, PING_SECS, PING_SECS, TimeUnit.SECONDS);

        app.start(config.port);
        logger.info("Gateway ready: http://localhost:" + config.port
                + (config.password.isEmpty() ? " (no GATEWAY_PASSWORD set: anyone who can reach this port can play)" : ""));
    }

    private void onMessage(WsContext ctx, String text) {
        JsonObject msg;
        try {
            msg = JsonParser.parseString(text).getAsJsonObject();
        } catch (RuntimeException e) {
            return;
        }
        JsonElement cmdElement = msg.get("cmd");
        String cmd = cmdElement == null || cmdElement.isJsonNull() ? "" : cmdElement.getAsString();
        if (cmd.equals("keepalive")) {
            return;
        }

        ClientSession session = ctx.attribute(SESSION_ATTR);
        if (session == null) {
            // first message: authenticate and attach to a new or a still living session
            if (!cmd.equals("hello")) {
                reject(ctx, msg, "Say hello first");
                return;
            }
            if (!config.password.isEmpty() && !sameText(config.password, text(msg, "password"))) {
                reject(ctx, msg, "Wrong password");
                return;
            }
            String token = text(msg, "token");
            session = token == null ? null : sessions.get(token);
            if (session == null) {
                session = new ClientSession(config);
                sessions.put(session.token, session);
            }
            session.attach(ctx);
            ctx.attribute(SESSION_ATTR, session);
            msg.addProperty("cmd", "resume");
        }
        session.handle(msg);
    }

    private static void reject(WsContext ctx, JsonObject msg, String error) {
        JsonObject o = new JsonObject();
        o.addProperty("type", "reply");
        o.add("id", msg.get("id"));
        o.addProperty("ok", false);
        o.addProperty("error", error);
        ctx.send(o.toString());
    }

    private void housekeeping() {
        try {
            long now = System.currentTimeMillis();
            for (ClientSession session : sessions.values()) {
                long detachedAt = session.detachedAt();
                if (detachedAt > 0 && now - detachedAt > config.sessionTimeoutMs) {
                    sessions.remove(session.token);
                    session.close();
                } else {
                    session.ping();
                }
            }
        } catch (Throwable t) {
            logger.error("Housekeeping error", t);
        }
    }

    private void waitForServer() throws InterruptedException {
        for (int i = 0; i < 600; i++) {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(config.xmageHost, config.xmagePort), 500);
                return;
            } catch (Exception e) {
                Thread.sleep(500);
            }
        }
        throw new IllegalStateException("XMage server did not start on " + config.xmageHost + ":" + config.xmagePort);
    }

    private static String text(JsonObject o, String key) {
        JsonElement e = o.get(key);
        return e == null || e.isJsonNull() ? null : e.getAsString();
    }

    private static boolean sameText(String expected, String actual) {
        return actual != null && MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8));
    }
}
