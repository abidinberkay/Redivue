package com.redivue.model;

public enum AuthType {
    PASSWORD,          // password only (legacy / default)
    USERNAME_PASSWORD, // Redis 6+ ACL: AUTH username password
    URL,               // full redis:// or rediss:// URI
    SENTINEL,          // Redis Sentinel HA (discovers master from sentinel nodes)
    CLUSTER,           // Redis Cluster (sharded, connects via seed nodes)
    SOCKET             // Unix domain socket (local only, not supported on Windows)
}
