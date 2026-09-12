package com.redivue.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.redivue.config.RedisConnectionHolder;
import com.redivue.config.RedisURIHelper;
import com.redivue.model.AuthType;
import com.redivue.model.RedisConnection;
import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisURI;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.pubsub.RedisPubSubListener;
import io.lettuce.core.pubsub.StatefulRedisPubSubConnection;
import io.lettuce.core.pubsub.api.async.RedisPubSubAsyncCommands;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
@Slf4j
public class PubSubService {

    @Autowired(required = false)
    private SshTunnelPool sshTunnelPool;

    private final ObjectMapper mapper = new ObjectMapper();

    private final ExecutorService executor = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "pubsub-worker");
        t.setDaemon(true);
        return t;
    });

    /** Subscribe to channels/patterns using a full RedisConnection (supports all auth types except Cluster). */
    public void startSubscribe(RedisConnection conn, List<String> channels, List<String> patterns,
                               int timeoutSeconds, SseEmitter emitter) {
        final RedisConnection effectiveConn = (conn.isSshEnabled() && sshTunnelPool != null)
            ? sshTunnelPool.resolve(conn) : conn;
        if (effectiveConn.getAuthType() == AuthType.CLUSTER) {
            sendEvent(emitter, "pubsub-error", "Pub/Sub is not supported for Redis Cluster connections in this version.");
            try { emitter.complete(); } catch (Exception ignored) {}
            return;
        }

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
                    @Override public void message(String channel, String message) {
                        sendMessage(emitter, channel, null, message);
                    }
                    @Override public void message(String pattern, String channel, String message) {
                        sendMessage(emitter, channel, pattern, message);
                    }
                    @Override public void subscribed(String channel, long count) {
                        sendEvent(emitter, "subscribed", channel);
                    }
                    @Override public void psubscribed(String pattern, long count) {
                        sendEvent(emitter, "subscribed", pattern);
                    }
                    @Override public void unsubscribed(String channel, long count) {}
                    @Override public void punsubscribed(String pattern, long count) {}
                });

                RedisPubSubAsyncCommands<String, String> async = pubSubConn.async();
                if (channels != null && !channels.isEmpty()) {
                    async.subscribe(channels.toArray(new String[0]));
                }
                if (patterns != null && !patterns.isEmpty()) {
                    async.psubscribe(patterns.toArray(new String[0]));
                }

                sendEvent(emitter, "started", "ok");

                long deadline = System.currentTimeMillis() + timeoutSeconds * 1000L;
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

                if (!stopped.get()) {
                    sendEvent(emitter, "timeout", String.valueOf(timeoutSeconds));
                }

            } catch (Exception e) {
                log.debug("Pub/Sub stream ended: {}", e.getMessage());
                if (!stopped.get()) {
                    sendEvent(emitter, "pubsub-error", e.getMessage() != null ? e.getMessage() : "Subscribe error");
                }
            } finally {
                if (pubSubConn != null) { try { pubSubConn.close(); } catch (Exception ignored) {} }
                if (client != null) { try { client.shutdown(); } catch (Exception ignored) {} }
                try { emitter.complete(); } catch (Exception ignored) {}
            }
        });
    }

    /** Returns active channels matching pattern with subscriber counts. */
    public List<Map<String, Object>> discoverChannels(RedisConnection conn, String pattern) {
        if (conn.isSshEnabled() && sshTunnelPool != null) conn = sshTunnelPool.resolve(conn);
        if (conn.getAuthType() == AuthType.CLUSTER) {
            throw new RuntimeException("Channel discovery is not supported for Redis Cluster connections.");
        }
        RedisClient client = null;
        StatefulRedisConnection<String, String> connection = null;
        try {
            RedisURI uri = RedisURIHelper.build(conn);
            client = RedisClient.create(uri);
            connection = client.connect();
            var sync = connection.sync();

            String pat = (pattern != null && !pattern.isBlank()) ? pattern : "*";
            List<String> channels = sync.pubsubChannels(pat);
            if (channels.isEmpty()) return List.of();

            Map<String, Long> numSub = sync.pubsubNumsub(channels.toArray(new String[0]));
            return channels.stream()
                    .map(ch -> Map.<String, Object>of("channel", ch, "subscribers", numSub.getOrDefault(ch, 0L)))
                    .sorted((a, b) -> Long.compare((Long) b.get("subscribers"), (Long) a.get("subscribers")))
                    .toList();
        } catch (Exception e) {
            throw new RuntimeException("Failed to discover channels: " + e.getMessage());
        } finally {
            if (connection != null) connection.close();
            if (client != null) client.shutdown();
        }
    }

    /** Publish a message to a channel. Returns the number of subscribers that received it. */
    public long publish(RedisConnection connection, String channel, String message) {
        if (connection.isSshEnabled() && sshTunnelPool != null) connection = sshTunnelPool.resolve(connection);
        try (RedisConnectionHolder h = RedisURIHelper.connect(connection)) {
            Long received = h.sync().publish(channel, message);
            return received != null ? received : 0L;
        } catch (Exception e) {
            throw new RuntimeException("Failed to publish: " + e.getMessage());
        }
    }

    // --- helpers ---

    private void sendMessage(SseEmitter emitter, String channel, String pattern, String message) {
        try {
            Map<String, Object> payload = new HashMap<>();
            payload.put("channel", channel);
            payload.put("pattern", pattern);
            payload.put("message", message);
            payload.put("ts", System.currentTimeMillis());
            String json = mapper.writeValueAsString(payload);
            synchronized (emitter) {
                emitter.send(SseEmitter.event().name("message").data(json));
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
}
