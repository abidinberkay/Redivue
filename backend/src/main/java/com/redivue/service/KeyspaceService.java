package com.redivue.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.redivue.config.RedisURIHelper;
import com.redivue.model.AuthType;
import com.redivue.model.RedisConnection;
import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisURI;
import io.lettuce.core.pubsub.RedisPubSubListener;
import io.lettuce.core.pubsub.StatefulRedisPubSubConnection;
import io.lettuce.core.pubsub.api.async.RedisPubSubAsyncCommands;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
@Slf4j
public class KeyspaceService {

    @Autowired(required = false)
    private SshTunnelPool sshTunnelPool;

    private final ObjectMapper mapper = new ObjectMapper();

    private final ExecutorService executor = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "keyspace-worker");
        t.setDaemon(true);
        return t;
    });

    /**
     * Subscribe to keyevent notifications via PSUBSCRIBE __keyevent@{db}__:*
     * Supports all auth types except Cluster.
     */
    public void startListen(RedisConnection conn, int timeoutSeconds, SseEmitter emitter) {
        final RedisConnection effectiveConn = (conn.isSshEnabled() && sshTunnelPool != null)
            ? sshTunnelPool.resolve(conn) : conn;
        if (effectiveConn.getAuthType() == AuthType.CLUSTER) {
            sendEvent(emitter, "keyspace-error", "Keyspace notifications are not supported for Redis Cluster connections.");
            try { emitter.complete(); } catch (Exception ignored) {}
            return;
        }

        int db = effectiveConn.getDb();
        AtomicBoolean stopped = new AtomicBoolean(false);
        emitter.onCompletion(() -> stopped.set(true));
        emitter.onTimeout(() -> stopped.set(true));
        emitter.onError(e -> stopped.set(true));

        executor.submit(() -> {
            RedisClient client = null;
            StatefulRedisPubSubConnection<String, String> pubSubConn = null;
            try {
                RedisURI uri = RedisURIHelper.build(effectiveConn);
                client = RedisClient.create(uri);
                pubSubConn = client.connectPubSub();

                pubSubConn.addListener(new RedisPubSubListener<>() {
                    @Override public void message(String channel, String message) {}

                    @Override public void message(String pattern, String channel, String message) {
                        String event = channel.contains(":") ? channel.substring(channel.lastIndexOf(':') + 1) : channel;
                        int dbIndex = parseDb(channel);
                        sendKeyspaceEvent(emitter, stopped, message, event, dbIndex);
                    }

                    @Override public void subscribed(String channel, long count) {}
                    @Override public void psubscribed(String pattern, long count) {
                        sendEvent(emitter, "started", "ok");
                    }
                    @Override public void unsubscribed(String channel, long count) {}
                    @Override public void punsubscribed(String pattern, long count) {}
                });

                RedisPubSubAsyncCommands<String, String> async = pubSubConn.async();
                async.psubscribe("__keyevent@" + db + "__:*");

                long deadline = timeoutSeconds > 0
                        ? System.currentTimeMillis() + timeoutSeconds * 1000L
                        : Long.MAX_VALUE;

                while (!stopped.get() && System.currentTimeMillis() < deadline) {
                    try {
                        synchronized (emitter) {
                            emitter.send(SseEmitter.event().comment("ping"));
                        }
                        Thread.sleep(1000);
                    } catch (Exception ex) {
                        break;
                    }
                }

                if (!stopped.get() && timeoutSeconds > 0) {
                    sendEvent(emitter, "timeout", String.valueOf(timeoutSeconds));
                }

            } catch (Exception e) {
                log.debug("Keyspace stream ended: {}", e.getMessage());
                if (!stopped.get()) {
                    sendEvent(emitter, "keyspace-error", e.getMessage() != null ? e.getMessage() : "Stream error");
                }
            } finally {
                if (pubSubConn != null) { try { pubSubConn.close(); } catch (Exception ignored) {} }
                if (client != null) { try { client.shutdown(); } catch (Exception ignored) {} }
                try { emitter.complete(); } catch (Exception ignored) {}
            }
        });
    }

    // --- helpers ---

    private void sendKeyspaceEvent(SseEmitter emitter, AtomicBoolean stopped, String key, String event, int db) {
        if (stopped.get()) return;
        try {
            Map<String, Object> payload = new HashMap<>();
            payload.put("key", key);
            payload.put("event", event);
            payload.put("db", db);
            payload.put("ts", System.currentTimeMillis());
            String json = mapper.writeValueAsString(payload);
            synchronized (emitter) {
                emitter.send(SseEmitter.event().name("keyspace").data(json));
            }
        } catch (Exception e) {
            log.debug("SSE send failed (client likely disconnected): {}", e.getMessage());
        }
    }

    private void sendEvent(SseEmitter emitter, String event, String data) {
        try {
            synchronized (emitter) {
                emitter.send(SseEmitter.event().name(event).data(data));
            }
        } catch (Exception e) {
            log.debug("SSE send failed (client likely disconnected): {}", e.getMessage());
        }
    }

    private int parseDb(String channel) {
        try {
            int at = channel.indexOf('@');
            int underscore = channel.indexOf("__:", at);
            if (at >= 0 && underscore > at) {
                return Integer.parseInt(channel.substring(at + 1, underscore));
            }
        } catch (Exception ignored) {}
        return 0;
    }
}
