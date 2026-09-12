package com.redivue.model;

import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class RedisConnection {
    private String host;
    private int port;
    private String password;
    private int db = 0;

    /** How to authenticate to this Redis server. Defaults to PASSWORD. */
    private AuthType authType = AuthType.PASSWORD;

    /** Redis 6+ ACL username (used when authType = USERNAME_PASSWORD). */
    private String username;

    /** Full redis:// or rediss:// URI (used when authType = URL). */
    private String url;

    /** Use TLS/SSL for host-based connections (PASSWORD, USERNAME_PASSWORD). */
    private boolean useTls = false;

    // --- Sentinel fields (authType = SENTINEL) ---
    /** Sentinel master name (e.g. "mymaster"). */
    private String masterName;
    /** Comma-separated sentinel nodes: "host1:26379,host2:26379". */
    private String sentinelNodes;
    /** Password for the sentinel nodes themselves (not the Redis master). */
    private String sentinelPassword;

    // --- Cluster fields (authType = CLUSTER) ---
    /** Comma-separated cluster seed nodes: "host1:6379,host2:6379". */
    private String clusterNodes;

    // --- Socket fields (authType = SOCKET) ---
    /** Unix domain socket path (e.g. "/var/run/redis/redis.sock"). */
    private String socketPath;

    // --- SSH Tunnel fields ---
    private boolean sshEnabled = false;
    private String sshHost;
    private int sshPort = 22;
    private String sshUser;
    /** SSH password auth (used when sshPrivateKey is blank). */
    private String sshPassword;
    /** PEM-encoded private key for SSH key auth. */
    private String sshPrivateKey;
    private String sshPrivateKeyPassphrase;

    // --- TLS Certificate fields (used when useTls = true) ---
    /** Skip server certificate verification (insecure, for self-signed). */
    private boolean tlsSkipVerify = false;
    /** PEM-encoded CA certificate for custom trust root. */
    private String tlsCaCert;
    /** PEM-encoded client certificate for mutual TLS. */
    private String tlsClientCert;
    /** PEM-encoded private key for the client certificate. */
    private String tlsClientKey;

    public RedisConnection(String host, int port, String password) {
        this.host = host;
        this.port = port;
        this.password = password;
    }
}
