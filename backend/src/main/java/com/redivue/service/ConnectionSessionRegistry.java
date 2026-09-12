package com.redivue.service;

import com.redivue.model.RedisConnection;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Component;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Stores connection credentials server-side keyed by a session token.
 * Enables SSE endpoints (which use HTTP GET) to carry full auth details
 * without exposing them in query params.
 */
@Component
public class ConnectionSessionRegistry {

    private record Entry(RedisConnection conn, long accessedAt) {}

    private final ConcurrentHashMap<String, Entry> map = new ConcurrentHashMap<>();

    private final ScheduledExecutorService cleaner = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "session-cleaner");
        t.setDaemon(true);
        return t;
    });

    @PostConstruct
    void startCleaner() {
        // Remove sessions idle for more than 30 minutes
        cleaner.scheduleAtFixedRate(() -> {
            long cutoff = System.currentTimeMillis() - 1_800_000L;
            map.entrySet().removeIf(e -> e.getValue().accessedAt() < cutoff);
        }, 5, 5, TimeUnit.MINUTES);
    }

    /** Store connection credentials and return an opaque token. */
    public String register(RedisConnection conn) {
        String token = UUID.randomUUID().toString();
        map.put(token, new Entry(conn, System.currentTimeMillis()));
        return token;
    }

    /** Look up a connection by token, refreshing its TTL. Returns null if not found. */
    public RedisConnection get(String token) {
        if (token == null) return null;
        Entry entry = map.get(token);
        if (entry == null) return null;
        map.put(token, new Entry(entry.conn(), System.currentTimeMillis()));
        return entry.conn();
    }
}
