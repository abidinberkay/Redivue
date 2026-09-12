package com.redivue.service;

import com.redivue.config.SshTunnelHelper;
import com.redivue.config.SshTunnelSession;
import com.redivue.model.RedisConnection;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;

/**
 * Caches open SSH tunnels keyed by (sshHost:sshPort:sshUser@targetHost:targetPort).
 * Re-uses existing sessions instead of reconnecting on every API call.
 * Idle tunnels are evicted after 10 minutes.
 */
@Component
@Slf4j
public class SshTunnelPool {

    private record TunnelEntry(SshTunnelSession tunnel, long lastUsed) {}

    private final ConcurrentHashMap<String, TunnelEntry> pool = new ConcurrentHashMap<>();

    /**
     * Returns the local port for the tunnel to conn's host:port.
     * Opens a new tunnel if none is cached or the cached one is disconnected.
     */
    public int getOrOpen(RedisConnection conn) {
        String key = tunnelKey(conn);
        TunnelEntry entry = pool.get(key);
        if (entry != null && entry.tunnel().getSession().isConnected()) {
            pool.put(key, new TunnelEntry(entry.tunnel(), System.currentTimeMillis()));
            return entry.tunnel().getLocalPort();
        }
        if (entry != null) {
            entry.tunnel().close();
        }
        try {
            SshTunnelSession ts = SshTunnelHelper.open(conn);
            pool.put(key, new TunnelEntry(ts, System.currentTimeMillis()));
            log.info("SSH tunnel opened: {} → 127.0.0.1:{}", key, ts.getLocalPort());
            return ts.getLocalPort();
        } catch (Exception e) {
            throw new RuntimeException("SSH tunnel failed: " + e.getMessage(), e);
        }
    }

    /**
     * If the connection has SSH enabled, returns a copy of it with host=127.0.0.1
     * and port set to the tunnel's local port; otherwise returns it unchanged.
     */
    public RedisConnection resolve(RedisConnection conn) {
        if (!conn.isSshEnabled()) return conn;
        int localPort = getOrOpen(conn);
        RedisConnection r = new RedisConnection();
        r.setHost("127.0.0.1");
        r.setPort(localPort);
        r.setPassword(conn.getPassword());
        r.setDb(conn.getDb());
        r.setAuthType(conn.getAuthType());
        r.setUsername(conn.getUsername());
        r.setUrl(conn.getUrl());
        r.setUseTls(conn.isUseTls());
        r.setMasterName(conn.getMasterName());
        r.setSentinelNodes(conn.getSentinelNodes());
        r.setSentinelPassword(conn.getSentinelPassword());
        r.setClusterNodes(conn.getClusterNodes());
        r.setSocketPath(conn.getSocketPath());
        r.setTlsSkipVerify(conn.isTlsSkipVerify());
        r.setTlsCaCert(conn.getTlsCaCert());
        r.setTlsClientCert(conn.getTlsClientCert());
        r.setTlsClientKey(conn.getTlsClientKey());
        // sshEnabled intentionally left false — resolved connection goes direct
        return r;
    }

    @Scheduled(fixedDelay = 120_000)
    void evict() {
        long cutoff = System.currentTimeMillis() - 600_000; // 10-min idle TTL
        pool.entrySet().removeIf(e -> {
            TunnelEntry entry = e.getValue();
            if (entry.lastUsed() < cutoff || !entry.tunnel().getSession().isConnected()) {
                entry.tunnel().close();
                log.debug("SSH tunnel evicted: {}", e.getKey());
                return true;
            }
            return false;
        });
    }

    private static String tunnelKey(RedisConnection conn) {
        return conn.getSshHost() + ":" + (conn.getSshPort() > 0 ? conn.getSshPort() : 22)
            + ":" + conn.getSshUser() + "@" + conn.getHost() + ":" + conn.getPort();
    }
}
