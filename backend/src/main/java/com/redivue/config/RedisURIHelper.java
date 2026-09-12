package com.redivue.config;

import com.redivue.model.AuthType;
import com.redivue.model.RedisConnection;
import io.lettuce.core.ClientOptions;
import io.lettuce.core.RedisClient;
import io.lettuce.core.RedisURI;
import io.lettuce.core.cluster.ClusterClientOptions;
import io.lettuce.core.cluster.RedisClusterClient;
import io.lettuce.core.cluster.api.StatefulRedisClusterConnection;
import io.lettuce.core.resource.ClientResources;
import io.lettuce.core.resource.DnsResolvers;
import lombok.extern.slf4j.Slf4j;

import java.net.InetAddress;
import java.util.ArrayList;
import java.util.List;

@Slf4j
public final class RedisURIHelper {

    private RedisURIHelper() {}

    /**
     * Creates the appropriate holder (standalone or cluster) and connects.
     * Callers should use try-with-resources on the returned holder.
     * SSH tunnel resolution must be done before calling this (see SshTunnelPool).
     */
    public static RedisConnectionHolder connect(RedisConnection conn) {
        AuthType type = conn.getAuthType() != null ? conn.getAuthType() : AuthType.PASSWORD;
        if (type == AuthType.CLUSTER) {
            List<RedisURI> seeds = parseClusterNodes(conn);
            ClientResources resources = buildClusterResources(seeds);
            RedisClusterClient c = RedisClusterClient.create(resources, seeds);
            if (TlsHelper.needsCustomTls(conn)) {
                try {
                    c.setOptions(ClusterClientOptions.builder()
                        .sslOptions(TlsHelper.buildSslOptions(conn)).build());
                } catch (Exception e) {
                    c.shutdown();
                    resources.shutdown();
                    throw new RuntimeException("Failed to configure TLS for cluster: " + e.getMessage(), e);
                }
            }
            try {
                StatefulRedisClusterConnection<String, String> cc = c.connect();
                return new RedisConnectionHolder(c, cc, resources);
            } catch (Exception e) {
                c.shutdown();
                resources.shutdown();
                throw e;
            }
        }
        RedisURI uri = build(conn);
        RedisClient c = RedisClient.create(uri);
        if (TlsHelper.needsCustomTls(conn)) {
            try {
                c.setOptions(TlsHelper.buildClientOptions(conn));
            } catch (Exception e) {
                c.shutdown();
                throw new RuntimeException("Failed to configure TLS: " + e.getMessage(), e);
            }
        }
        try {
            return new RedisConnectionHolder(c, c.connect());
        } catch (Exception e) {
            c.shutdown();
            throw e;
        }
    }

    /** Builds a RedisURI for non-cluster auth types. */
    public static RedisURI build(RedisConnection conn) {
        AuthType type = conn.getAuthType() != null ? conn.getAuthType() : AuthType.PASSWORD;
        return switch (type) {
            case URL -> {
                if (conn.getUrl() == null || conn.getUrl().isBlank())
                    throw new IllegalArgumentException("URL auth type requires a redis:// URI");
                yield RedisURI.create(conn.getUrl());
            }
            case USERNAME_PASSWORD -> {
                RedisURI.Builder b = RedisURI.Builder.redis(conn.getHost(), conn.getPort());
                if (conn.isUseTls()) b.withSsl(true);
                if (conn.getUsername() != null && conn.getPassword() != null) {
                    b.withAuthentication(conn.getUsername(), conn.getPassword().toCharArray());
                } else if (conn.getPassword() != null && !conn.getPassword().isBlank()) {
                    b.withPassword(conn.getPassword().toCharArray());
                }
                if (conn.getDb() > 0) b.withDatabase(conn.getDb());
                yield b.build();
            }
            case SENTINEL -> {
                if (conn.getMasterName() == null || conn.getMasterName().isBlank())
                    throw new IllegalArgumentException("Sentinel auth requires a master name");
                if (conn.getSentinelNodes() == null || conn.getSentinelNodes().isBlank())
                    throw new IllegalArgumentException("Sentinel auth requires sentinel node addresses");
                RedisURI.Builder b = RedisURI.builder().withSentinelMasterId(conn.getMasterName());
                if (conn.getDb() > 0) b.withDatabase(conn.getDb());
                if (conn.getPassword() != null && !conn.getPassword().isBlank())
                    b.withPassword(conn.getPassword().toCharArray());
                for (String node : conn.getSentinelNodes().split(",")) {
                    String[] parts = node.trim().split(":");
                    String h = parts[0].trim();
                    int p = parts.length > 1 ? Integer.parseInt(parts[1].trim()) : 26379;
                    b.withSentinel(h, p);
                }
                yield b.build();
            }
            case SOCKET -> {
                if (conn.getSocketPath() == null || conn.getSocketPath().isBlank())
                    throw new IllegalArgumentException("Socket auth requires a socket file path");
                yield RedisURI.create("redis-socket://" + conn.getSocketPath()
                        + (conn.getDb() > 0 ? "/" + conn.getDb() : ""));
            }
            case CLUSTER ->
                throw new IllegalArgumentException("Use RedisURIHelper.connect() for cluster connections");
            default -> {
                RedisURI.Builder b = RedisURI.Builder.redis(conn.getHost(), conn.getPort());
                if (conn.isUseTls()) b.withSsl(true);
                if (conn.getPassword() != null && !conn.getPassword().isBlank())
                    b.withPassword(conn.getPassword().toCharArray());
                if (conn.getDb() > 0) b.withDatabase(conn.getDb());
                yield b.build();
            }
        };
    }

    /** Build a simple URI without TLS — used by SSE endpoints (GET query params). */
    public static RedisURI buildSimple(String host, int port, String password, int db) {
        RedisURI.Builder builder = RedisURI.Builder.redis(host, port);
        if (password != null && !password.isBlank()) {
            builder.withPassword(password.toCharArray());
        }
        if (db > 0) builder.withDatabase(db);
        return builder.build();
    }

    private static List<RedisURI> parseClusterNodes(RedisConnection conn) {
        if (conn.getClusterNodes() == null || conn.getClusterNodes().isBlank())
            throw new IllegalArgumentException("Cluster auth requires at least one seed node");
        List<RedisURI> uris = new ArrayList<>();
        for (String node : conn.getClusterNodes().split(",")) {
            String[] parts = node.trim().split(":");
            String host = parts[0].trim();
            int port = parts.length > 1 ? Integer.parseInt(parts[1].trim()) : 6379;
            RedisURI.Builder b = RedisURI.Builder.redis(host, port);
            if (conn.isUseTls()) b.withSsl(true);
            if (conn.getPassword() != null && !conn.getPassword().isBlank())
                b.withPassword(conn.getPassword().toCharArray());
            uris.add(b.build());
        }
        return uris;
    }

    /**
     * When all seed nodes are localhost, build ClientResources that remaps any
     * private/Docker IP returned in cluster topology back to 127.0.0.1.
     * This allows Redis Cluster in Docker Desktop (Windows/Mac) to work
     * without host networking, since Docker internal IPs aren't reachable
     * from the host but the exposed ports on localhost are.
     */
    private static ClientResources buildClusterResources(List<RedisURI> seeds) {
        boolean allLocalhost = seeds.stream().allMatch(u ->
                u.getHost().equals("localhost") || u.getHost().equals("127.0.0.1"));
        if (!allLocalhost) {
            return ClientResources.create();
        }
        return ClientResources.builder()
                .dnsResolver(host -> {
                    // Remap Docker-internal private IPs to localhost so MOVED/ASK
                    // redirects land on the host-exposed ports.
                    if (isDockerPrivateIp(host)) {
                        return new InetAddress[]{InetAddress.getByName("127.0.0.1")};
                    }
                    return DnsResolvers.JVM_DEFAULT.resolve(host);
                })
                .build();
    }

    private static boolean isDockerPrivateIp(String host) {
        // Match typical Docker bridge ranges: 172.17-31.x.x and 10.x.x.x
        return host.matches("172\\.(1[7-9]|2[0-9]|3[01])\\.\\d+\\.\\d+")
                || host.matches("10\\.\\d+\\.\\d+\\.\\d+");
    }
}
