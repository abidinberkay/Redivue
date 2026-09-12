// Shared domain types for Redivue frontend.
// Phase 1 of the TS migration: central types used across components.

export type RedisType = 'string' | 'hash' | 'list' | 'set' | 'zset'

export type AuthType = 'PASSWORD' | 'USERNAME_PASSWORD' | 'URL' | 'SENTINEL' | 'CLUSTER' | 'SOCKET'

/** A configured Redis connection as held in app state. */
export interface Connection {
  id: number
  name?: string
  host: string
  port: number
  password: string | null
  /** Selected logical database (0-15). */
  db: number
  /** Auth method for this connection. Defaults to PASSWORD. */
  authType?: AuthType
  /** Redis 6+ ACL username (used when authType = USERNAME_PASSWORD). */
  username?: string | null
  /** Full redis:// or rediss:// URI (used when authType = URL). */
  url?: string | null
  /** Use TLS/SSL for host-based auth types (PASSWORD, USERNAME_PASSWORD, CLUSTER). */
  useTls?: boolean
  /** Sentinel master name (e.g. "mymaster"). Used when authType = SENTINEL. */
  masterName?: string | null
  /** Comma-separated sentinel node addresses "host:26379,host2:26379". */
  sentinelNodes?: string | null
  /** Password for the Redis master behind sentinel. */
  sentinelPassword?: string | null
  /** Comma-separated cluster seed nodes "host1:6379,host2:6379". */
  clusterNodes?: string | null
  /** Unix domain socket path "/var/run/redis/redis.sock". */
  socketPath?: string | null
  // --- SSH Tunnel ---
  sshEnabled?: boolean
  sshHost?: string | null
  sshPort?: number | null
  sshUser?: string | null
  sshPassword?: string | null
  sshPrivateKey?: string | null
  sshPrivateKeyPassphrase?: string | null
  // --- TLS Certificates ---
  /** Skip server cert verification (insecure, for self-signed). */
  tlsSkipVerify?: boolean
  /** PEM-encoded CA certificate for custom trust root. */
  tlsCaCert?: string | null
  /** PEM-encoded client certificate for mutual TLS. */
  tlsClientCert?: string | null
  /** PEM-encoded private key for the client certificate. */
  tlsClientKey?: string | null
  connected?: boolean
  stats?: RedisStats | null
}

/** The slim shape persisted to localStorage. */
export type StoredConnection = Pick<
  Connection,
  'id' | 'name' | 'host' | 'port' | 'password' | 'db' | 'authType' | 'username' | 'url' | 'useTls'
  | 'masterName' | 'sentinelNodes' | 'sentinelPassword' | 'clusterNodes' | 'socketPath'
  | 'sshEnabled' | 'sshHost' | 'sshPort' | 'sshUser' | 'sshPassword' | 'sshPrivateKey' | 'sshPrivateKeyPassphrase'
  | 'tlsSkipVerify' | 'tlsCaCert' | 'tlsClientCert' | 'tlsClientKey'
>

export type HealthStatus = 'ok' | 'error' | 'checking'

export interface HealthInfo {
  status: HealthStatus
  keyCount: number | null
}

/**
 * Connection details sent in the body of every stateless API request.
 * The backend uses these to open the right connection + database.
 */
export interface ConnBody {
  host: string
  port: number
  password: string | null
  db: number
  authType?: AuthType
  username?: string | null
  url?: string | null
  useTls?: boolean
  masterName?: string | null
  sentinelNodes?: string | null
  sentinelPassword?: string | null
  clusterNodes?: string | null
  socketPath?: string | null
  // SSH Tunnel
  sshEnabled?: boolean
  sshHost?: string | null
  sshPort?: number | null
  sshUser?: string | null
  sshPassword?: string | null
  sshPrivateKey?: string | null
  sshPrivateKeyPassphrase?: string | null
  // TLS Certificates
  tlsSkipVerify?: boolean
  tlsCaCert?: string | null
  tlsClientCert?: string | null
  tlsClientKey?: string | null
}

/** Server stats returned by POST /api/redis/{id}/stats. */
export interface RedisStats {
  memoryUsed: string
  usedMemoryPeak: string
  maxMemory: string
  memFragmentationRatio: number | string
  totalKeys: number
  opsPerSec: number
  hitRate: string
  redisVersion: string
  role: string
  uptime: string
  connectedClients: number
  totalConnectionsReceived: number
  totalCommandsProcessed: number
  rdbLastBgsaveStatus: string
  aofEnabled: boolean
}

/** A single key as returned by a SCAN page. */
export interface KeyItem {
  key: string
  type: RedisType
  ttl: number
  memoryBytes?: number
}

/** Result of POST /api/redis/{id}/keys/scan. */
export interface ScanResult {
  keys: KeyItem[]
  nextCursor: string
  done: boolean
}

/** A single key with its memory footprint (from memory analysis). */
export interface MemoryKeyItem {
  key: string
  type: RedisType
  ttl: number
  memoryBytes: number
}

/** Result of POST /api/redis/{id}/memory/analyze. */
export interface MemoryAnalyzeResult {
  totalBytes: number
  totalScanned: number
  byType: Record<string, number>
  keys: MemoryKeyItem[]
}

/** Build the full connection body for API requests from a Connection object. */
export function connBody(conn: Connection): ConnBody {
  return {
    host: conn.host,
    port: conn.port,
    password: conn.password,
    db: conn.db ?? 0,
    authType: conn.authType ?? 'PASSWORD',
    username: conn.username ?? null,
    url: conn.url ?? null,
    useTls: conn.useTls ?? false,
    masterName: conn.masterName ?? null,
    sentinelNodes: conn.sentinelNodes ?? null,
    sentinelPassword: conn.sentinelPassword ?? null,
    clusterNodes: conn.clusterNodes ?? null,
    socketPath: conn.socketPath ?? null,
    sshEnabled: conn.sshEnabled ?? false,
    sshHost: conn.sshHost ?? null,
    sshPort: conn.sshPort ?? null,
    sshUser: conn.sshUser ?? null,
    sshPassword: conn.sshPassword ?? null,
    sshPrivateKey: conn.sshPrivateKey ?? null,
    sshPrivateKeyPassphrase: conn.sshPrivateKeyPassphrase ?? null,
    tlsSkipVerify: conn.tlsSkipVerify ?? false,
    tlsCaCert: conn.tlsCaCert ?? null,
    tlsClientCert: conn.tlsClientCert ?? null,
    tlsClientKey: conn.tlsClientKey ?? null,
  }
}

/**
 * Register connection credentials server-side and return a session token.
 * Used by SSE endpoints (Monitor, Pub/Sub, Keyspace) which can only use GET params.
 */
export async function registerSession(connectionId: number, conn: Connection): Promise<string> {
  const res = await fetch(`/api/redis/${connectionId}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(connBody(conn)),
  })
  const data = await res.json()
  return data.sessionToken as string
}
