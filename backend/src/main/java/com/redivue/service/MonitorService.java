package com.redivue.service;

import com.redivue.config.RedisConnectionHolder;
import com.redivue.config.RedisURIHelper;
import com.redivue.model.AuthType;
import com.redivue.model.RedisConnection;
import com.redivue.model.SlowLogEntry;
import io.lettuce.core.RedisURI;
import io.lettuce.core.api.sync.RedisCommands;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Collectors;

@Service
@Slf4j
public class MonitorService {

    @Autowired(required = false)
    private SshTunnelPool sshTunnelPool;

    private final ExecutorService executor = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "monitor-worker");
        t.setDaemon(true);
        return t;
    });

    public void startMonitor(RedisConnection conn, int timeoutSeconds, SseEmitter emitter) {
        // Resolve SSH tunnel before extracting host/port
        if (conn.isSshEnabled() && sshTunnelPool != null) {
            conn = sshTunnelPool.resolve(conn);
        }
        AuthType type = conn.getAuthType() != null ? conn.getAuthType() : AuthType.PASSWORD;

        // Resolve TCP host/port/credentials from the connection
        final String host;
        final int port;
        final String password;
        final String username;

        switch (type) {
            case URL -> {
                RedisURI uri = RedisURI.create(conn.getUrl());
                if (uri.isSsl()) {
                    safeSend(emitter, "fatal-error", "MONITOR over TLS is not supported. Use a non-TLS connection to this Redis for monitoring.");
                    completeQuietly(emitter);
                    return;
                }
                host = uri.getHost();
                port = uri.getPort();
                password = uri.getPassword() != null ? new String(uri.getPassword()) : null;
                username = uri.getUsername();
            }
            case SENTINEL -> {
                safeSend(emitter, "fatal-error", "MONITOR with Sentinel: add a direct Password connection to the master Redis instead.");
                completeQuietly(emitter);
                return;
            }
            case CLUSTER -> {
                safeSend(emitter, "fatal-error", "MONITOR is not available for Redis Cluster connections.");
                completeQuietly(emitter);
                return;
            }
            case SOCKET -> {
                safeSend(emitter, "fatal-error", "MONITOR is not supported over Unix domain sockets.");
                completeQuietly(emitter);
                return;
            }
            default -> {
                if (conn.isUseTls()) {
                    safeSend(emitter, "fatal-error", "MONITOR over TLS is not supported. Disable TLS or use a Redis URL without rediss://.");
                    completeQuietly(emitter);
                    return;
                }
                host = conn.getHost();
                port = conn.getPort();
                password = conn.getPassword();
                username = type == AuthType.USERNAME_PASSWORD ? conn.getUsername() : null;
            }
        }

        AtomicBoolean stopped = new AtomicBoolean(false);
        emitter.onCompletion(() -> stopped.set(true));
        emitter.onTimeout(() -> stopped.set(true));
        emitter.onError(e -> stopped.set(true));

        executor.submit(() -> {
            Socket socket = null;
            try {
                socket = new Socket();
                socket.connect(new InetSocketAddress(host, port), 5000);
                socket.setSoTimeout(500);

                OutputStream os = socket.getOutputStream();
                BufferedReader reader = new BufferedReader(
                        new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));

                if (password != null && !password.isBlank()) {
                    if (username != null && !username.isBlank()) {
                        sendRaw(os, "AUTH", username, password);
                    } else {
                        sendRaw(os, "AUTH", password);
                    }
                    String authLine = reader.readLine();
                    if (authLine == null || !authLine.toLowerCase().startsWith("+ok")) {
                        safeSend(emitter, "fatal-error", "Authentication failed");
                        emitter.complete();
                        return;
                    }
                }

                sendRaw(os, "MONITOR");
                String okLine = reader.readLine();
                if (okLine == null || !okLine.toLowerCase().startsWith("+ok")) {
                    safeSend(emitter, "fatal-error", "MONITOR command rejected");
                    emitter.complete();
                    return;
                }

                safeSend(emitter, "started", "ok");

                long deadline = timeoutSeconds > 0 ? System.currentTimeMillis() + timeoutSeconds * 1000L : Long.MAX_VALUE;

                while (!stopped.get() && System.currentTimeMillis() < deadline) {
                    try {
                        String line = reader.readLine();
                        if (line == null) break;
                        if (line.startsWith("+")) {
                            safeSend(emitter, "monitor", line.substring(1));
                        }
                    } catch (SocketTimeoutException e) {
                        try {
                            emitter.send(SseEmitter.event().comment("ping"));
                        } catch (Exception ex) {
                            break;
                        }
                    }
                }

                if (!stopped.get() && timeoutSeconds > 0) {
                    safeSend(emitter, "timeout", String.valueOf(timeoutSeconds));
                }

            } catch (Exception e) {
                if (!stopped.get()) {
                    safeSend(emitter, "monitor-error", e.getMessage() != null ? e.getMessage() : "Stream error");
                }
            } finally {
                if (socket != null) {
                    try { socket.close(); } catch (Exception ignored) {}
                }
                try { emitter.complete(); } catch (Exception ignored) {}
            }
        });
    }

    public List<SlowLogEntry> getSlowLog(RedisConnection connection, int count) {
        if (connection.isSshEnabled() && sshTunnelPool != null) {
            connection = sshTunnelPool.resolve(connection);
        }
        try (RedisConnectionHolder h = RedisURIHelper.connect(connection)) {
            RedisCommands<String, String> commands = h.sync();
            List<Object> raw = commands.slowlogGet(count);
            List<SlowLogEntry> entries = new ArrayList<>();
            for (Object item : raw) {
                if (item instanceof List<?> entry) {
                    try {
                        long id  = toLong(entry.get(0));
                        long ts  = toLong(entry.get(1));
                        long dur = toLong(entry.get(2));
                        List<String> cmd = toStringList(entry.get(3));
                        String addr = entry.size() > 4 ? String.valueOf(entry.get(4)) : "";
                        String name = entry.size() > 5 ? String.valueOf(entry.get(5)) : "";
                        entries.add(SlowLogEntry.builder()
                                .id(id).timestamp(ts).durationMicros(dur)
                                .command(cmd).clientAddr(addr).clientName(name)
                                .build());
                    } catch (Exception e) {
                        log.warn("Could not parse slowlog entry: {}", e.getMessage());
                    }
                }
            }
            return entries;
        } catch (Exception e) {
            throw new RuntimeException("Failed to get slow log: " + e.getMessage());
        }
    }

    // --- helpers ---

    private void sendRaw(OutputStream os, String... args) throws Exception {
        StringBuilder sb = new StringBuilder();
        sb.append('*').append(args.length).append("\r\n");
        for (String arg : args) {
            byte[] bytes = arg.getBytes(StandardCharsets.UTF_8);
            sb.append('$').append(bytes.length).append("\r\n").append(arg).append("\r\n");
        }
        os.write(sb.toString().getBytes(StandardCharsets.UTF_8));
        os.flush();
    }

    private void safeSend(SseEmitter emitter, String event, String data) {
        try {
            emitter.send(SseEmitter.event().name(event).data(data));
        } catch (Exception ignored) {}
    }

    private void completeQuietly(SseEmitter emitter) {
        try { emitter.complete(); } catch (Exception ignored) {}
    }

    private long toLong(Object o) {
        if (o instanceof Long l) return l;
        if (o instanceof Integer i) return i.longValue();
        return Long.parseLong(String.valueOf(o));
    }

    @SuppressWarnings("unchecked")
    private List<String> toStringList(Object o) {
        if (o instanceof List<?> list) {
            return list.stream().map(String::valueOf).collect(Collectors.toList());
        }
        return List.of(String.valueOf(o));
    }
}
