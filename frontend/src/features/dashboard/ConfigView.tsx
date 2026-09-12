import { useState, useEffect, useRef } from 'react'
import type { ConnBody } from '../../types'

// Large map of Redis config key descriptions — kept here to stay co-located with ConfigView
const CONFIG_INFO: Record<string, { desc: string; example: string }> = {
  'maxmemory':{ desc: 'The maximum amount of RAM Redis is allowed to use. Once this limit is hit, Redis starts removing keys based on the eviction policy below. Set it to 0 to let Redis use as much memory as it wants (only safe if the machine is dedicated to Redis).', example: '512mb, 1gb, 2gb, 0 (unlimited)' },
  'maxmemory-policy':{ desc: 'Decides which keys Redis throws away when it runs out of memory. "noeviction" rejects new writes instead of deleting anything. The "lru" options remove the least recently used keys, "lfu" removes the least frequently used, and "ttl" removes keys closest to expiring. "volatile-*" only touch keys that have an expiry set; "allkeys-*" can remove any key.', example: 'noeviction, allkeys-lru, volatile-lru, allkeys-lfu, volatile-ttl, allkeys-random' },
  'maxmemory-samples':{ desc: 'When evicting keys, Redis does not scan everything (too slow). Instead it samples a few keys and removes the best candidate. This sets how many it samples — a higher number gives more accurate eviction but uses more CPU.', example: '5 (default), 10' },
  'save':{ desc: 'Schedules automatic RDB snapshots (point-in-time backups to disk). Format is "seconds changes" — e.g. "300 100" means save if at least 100 keys changed in 300 seconds. Leave empty to disable snapshots entirely.', example: '3600 1 300 100 60 10000' },
  'appendonly':{ desc: 'Turns on AOF (Append-Only File) persistence. When enabled, every write command is logged to disk, so after a crash Redis can replay the log and lose almost no data. Safer than snapshots alone, but adds disk activity.', example: 'yes, no' },
  'appendfsync':{ desc: 'How often the AOF log is physically flushed to disk. "everysec" flushes once per second (good balance, lose at most 1s of data). "always" flushes on every write (safest but slowest). "no" lets the operating system decide (fastest but riskiest).', example: 'everysec, always, no' },
  'bind':{ desc: 'Which network interfaces Redis listens on. "127.0.0.1" means only this machine can connect (safe default). "0.0.0.0" means anyone on the network can reach it — only do this with a password and firewall.', example: '127.0.0.1 -::1, 0.0.0.0' },
  'port':{ desc: 'The TCP port Redis listens on for client connections. Default is 6379. Set to 0 to disable TCP and only use a unix socket.', example: '6379' },
  'requirepass':{ desc: 'Sets a password that clients must provide (via AUTH) before running commands. Leave empty for no password. Use a long, random password if Redis is reachable from the network.', example: 'a-long-random-secret' },
  'maxclients':{ desc: 'The maximum number of clients that can be connected at the same time. New connections beyond this are rejected with an error.', example: '10000, 1000' },
  'loglevel':{ desc: 'How chatty the Redis log is. "debug" logs everything (development), "notice" is a sensible default, "warning" only logs important problems.', example: 'debug, verbose, notice, warning' },
  'databases':{ desc: 'How many separate logical databases Redis provides, numbered 0 to N-1. You switch between them with the SELECT command. Default is 16.', example: '16' },
  'hz':{ desc: 'How many times per second Redis runs background housekeeping (expiring keys, closing idle clients, etc.). Higher means more responsive cleanup but slightly more CPU usage when idle.', example: '10 (default), 100' },
  'slowlog-log-slower-than':{ desc: 'Commands that take longer than this many microseconds get recorded in the slow log so you can find performance problems. 0 logs every command, -1 turns the slow log off. (10000 microseconds = 10 milliseconds.)', example: '10000, 1000, 0, -1' },
  'slowlog-max-len':{ desc: 'The maximum number of entries kept in the slow log. When full, the oldest entry is dropped as new ones arrive.', example: '128, 1000' },
  'notify-keyspace-events':{ desc: 'Controls which key events Redis publishes over pub/sub. Built from flags: K=keyspace, E=keyevent, g=generic, x=expired, A=all. Empty disables notifications.', example: 'KEA, Ex, "" (off)' },
  'maxmemory-clients':{ desc: 'Limits how much memory client connection buffers can use in total.', example: '0 (no limit), 1gb, 5%' },
  'protected-mode':{ desc: 'A safety feature: when on, Redis refuses connections from other machines unless a password is set or a bind address is configured.', example: 'yes, no' },
  'tcp-keepalive':{ desc: 'How often (in seconds) Redis sends a keepalive ping to detect dead client connections and clean them up. 0 disables it.', example: '300, 0' },
  'timeout':{ desc: 'Disconnect a client after it has been idle (no commands) for this many seconds. 0 means never disconnect idle clients.', example: '0, 300, 3600' },
  'dir':{ desc: 'The working directory where Redis stores its RDB snapshot and AOF files.', example: '/var/lib/redis, ./' },
  'dbfilename':{ desc: 'The file name used for the RDB snapshot on disk.', example: 'dump.rdb' },
  'rdbcompression':{ desc: 'Whether to compress data inside RDB snapshots using LZF. Saves disk space at the cost of a little CPU.', example: 'yes, no' },
  'rdbchecksum':{ desc: 'Adds a checksum to the end of RDB files to detect corruption.', example: 'yes, no' },
  'replica-read-only':{ desc: 'When yes, replica (slave) instances reject write commands and only serve reads.', example: 'yes, no' },
  'lazyfree-lazy-eviction':{ desc: 'When evicting keys to free memory, delete them in a background thread instead of blocking the main one.', example: 'yes, no' },
  'lazyfree-lazy-expire':{ desc: 'When keys expire, free their memory in a background thread instead of blocking.', example: 'yes, no' },
  'activerehashing':{ desc: 'Lets Redis gradually reorganize its main hash table in the background to keep memory tidy.', example: 'yes, no' },
  'dynamic-hz':{ desc: 'When on, Redis automatically scales the housekeeping frequency (hz) based on how many clients are connected.', example: 'yes, no' },
  'aof-use-rdb-preamble':{ desc: 'When rewriting the AOF, Redis can store a compact RDB snapshot at the start. Makes AOF files smaller and faster to load.', example: 'yes, no' },
  'auto-aof-rewrite-percentage':{ desc: 'Redis automatically rewrites (compacts) the AOF when it grows this percent larger than after the last rewrite.', example: '100, 50, 0' },
  'auto-aof-rewrite-min-size':{ desc: 'The AOF will not be auto-rewritten until it reaches at least this size.', example: '64mb' },
  'hash-max-listpack-entries':{ desc: 'Small hashes are stored in a compact format. Once a hash has more fields than this, Redis switches to the normal format.', example: '128' },
  'hash-max-listpack-value':{ desc: 'Small hashes use the compact format only while every field value is shorter than this many bytes.', example: '64' },
  'set-max-intset-entries':{ desc: 'Sets containing only integers use a very compact format until they grow past this many members.', example: '512' },
  'zset-max-listpack-entries':{ desc: 'Small sorted sets use a compact format until they have more than this many members.', example: '128' },
  'zset-max-listpack-value':{ desc: 'Sorted sets use the compact format only while every member is shorter than this many bytes.', example: '64' },
  'io-threads':{ desc: 'Number of threads used to read and write data over the network.', example: '1, 4, 8' },
  'cluster-enabled':{ desc: 'Turns on Redis Cluster mode, where data is automatically sharded across multiple nodes.', example: 'yes, no' },
  'lua-time-limit':{ desc: 'Maximum time (milliseconds) a Lua script may run before Redis starts allowing SCRIPT KILL.', example: '5000' },
  'activedefrag':{ desc: 'Enables active memory defragmentation: Redis gradually compacts fragmented memory in the background.', example: 'yes, no' },
  'latency-monitor-threshold':{ desc: 'Events that take longer than this many milliseconds are recorded by the latency monitor. 0 disables it.', example: '0, 100' },
  'latency-tracking':{ desc: 'Enables detailed per-command latency tracking.', example: 'yes, no' },
  'jemalloc-bg-thread':{ desc: 'Allows jemalloc to run a background thread for memory maintenance.', example: 'yes, no' },
  'crash-log-enabled':{ desc: 'When yes, Redis writes a detailed crash log with stack traces when it encounters a fatal error.', example: 'yes, no' },
  'lfu-decay-time':{ desc: 'How quickly the access frequency of a key decays over time.', example: '1' },
  'lfu-log-factor':{ desc: 'Controls how fast the LFU counter grows.', example: '10' },
  'repl-backlog-size':{ desc: 'Size of the buffer that holds recent writes so a briefly-disconnected replica can catch up without a full resync.', example: '1mb, 10mb' },
  'repl-timeout':{ desc: 'How long (seconds) to wait before considering the master/replica link broken.', example: '60' },
  'acllog-max-len':{ desc: 'How many recent ACL security events Redis keeps in memory for inspection.', example: '128' },
  'client-query-buffer-limit':{ desc: 'Maximum size of the buffer used to hold a single client\'s incoming command before it is processed.', example: '1gb' },
  'shutdown-timeout':{ desc: 'Maximum time (seconds) Redis waits for replicas to sync before completing a SHUTDOWN SAVE.', example: '10' },
}

function ConfigInfoModal({ configKey, currentValue, onClose }: { configKey: string; currentValue: string; onClose: () => void }) {
  const info = CONFIG_INFO[configKey]
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box config-info-modal" onClick={e => e.stopPropagation()}>
        <div className="config-info-modal-header">
          <code className="config-info-modal-title">{configKey}</code>
          <button className="config-info-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="config-info-modal-body">
          {info ? (
            <p className="config-info-modal-desc">{info.desc}</p>
          ) : (
            <p className="config-info-modal-desc config-info-na">
              No simplified description is available for this parameter yet. See the official Redis documentation at <span className="config-info-link">redis.io/docs/management/config</span> for full details.
            </p>
          )}
          {info?.example && (
            <div className="config-info-modal-field">
              <span className="config-info-modal-label">Example values</span>
              <code className="config-info-modal-example">{info.example}</code>
            </div>
          )}
          <div className="config-info-modal-field">
            <span className="config-info-modal-label">Current value</span>
            <code className="config-info-modal-current">{currentValue !== '' ? currentValue : '(empty)'}</code>
          </div>
        </div>
        <div className="modal-actions" style={{ marginTop: 4 }}>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function ConfigRow({ k, v, connectionId, connBody, onSaved, onInfo, onLog }: {
  k: string; v: string; connectionId: string; connBody: ConnBody;
  onSaved: (key: string, val: string) => void;
  onInfo: (key: string) => void;
  onLog?: (entry: any) => void;
}) {
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState(v)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const info = CONFIG_INFO[k]

  const startEdit = () => { setInputVal(v); setSaveErr(''); setEditing(true) }
  const cancelEdit = () => { setEditing(false); setSaveErr('') }

  const save = async () => {
    setSaving(true); setSaveErr('')
    try {
      const res = await fetch(`/api/redis/${connectionId}/config/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connBody, param: k, value: inputVal }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Failed to save')
      }
      onSaved(k, inputVal)
      onLog?.({ label: `Config: ${k}`, detail: `${v || '(empty)'} → ${inputVal || '(empty)'}`, oldValue: v, newValue: inputVal })
      setEditing(false)
    } catch (e) {
      setSaveErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className="config-row">
      <td className="config-key">
        <span className="config-key-name">{k}</span>
        <button className="config-info-icon" onClick={() => onInfo(k)} title="What does this setting do?" aria-label={`Info about ${k}`}>i</button>
      </td>
      <td className="config-val-cell">
        {editing ? (
          <div className="config-edit-row">
            <input
              className="config-edit-input"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              placeholder={info?.example || ''}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancelEdit() }}
              autoFocus
            />
            <button className="config-save-btn" onClick={save} disabled={saving}>{saving ? '…' : 'Save'}</button>
            <button className="config-cancel-btn" onClick={cancelEdit}>Cancel</button>
            {saveErr && <span className="config-save-err" title={saveErr}>⚠ {saveErr}</span>}
          </div>
        ) : (
          <div className="config-val-row">
            <span className="config-val">{v !== '' ? v : <span className="config-empty">(empty)</span>}</span>
            <button className="config-edit-btn" onClick={startEdit}>Edit</button>
          </div>
        )}
      </td>
    </tr>
  )
}

export function ConfigView({ connectionId, connBody, active, onLog }: {
  connectionId: string; connBody: ConnBody; active: boolean; onLog?: (entry: any) => void
}) {
  const [config, setConfig] = useState<Record<string, string> | null>(null)
  const [loadingCfg, setLoadingCfg] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [infoKey, setInfoKey] = useState<string | null>(null)
  const loaded = useRef(false)

  useEffect(() => {
    if (!active || loaded.current) return
    loaded.current = true
    const load = async () => {
      setLoadingCfg(true)
      try {
        const res = await fetch(`/api/redis/${connectionId}/config/get`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(connBody),
        })
        if (!res.ok) throw new Error('Failed to load config')
        const data = await res.json()
        setConfig(data)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoadingCfg(false)
      }
    }
    load()
  }, [active])

  const handleSaved = (key: string, newVal: string) => {
    setConfig(prev => prev ? ({ ...prev, [key]: newVal }) : prev)
  }

  const filtered = config
    ? Object.entries(config).filter(([k, v]) =>
        k.toLowerCase().includes(search.toLowerCase()) ||
        (v && v.toLowerCase().includes(search.toLowerCase()))
      )
    : []

  return (
    <div className="config-view">
      <div className="config-view-header">
        <input
          className="config-search-input"
          placeholder="Filter configuration keys or values..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loadingCfg && <div className="config-loading">Loading configuration...</div>}
      {error && <div className="modal-error">{error}</div>}

      {config && (
        <div className="config-table-wrap">
          {filtered.length > 0 && (
            <>
              <div className="config-group-title">
                All Configuration
                {!search && <span className="config-count"> ({filtered.length})</span>}
              </div>
              <table className="config-table">
                <tbody>
                  {filtered.map(([k, v]) => (
                    <ConfigRow key={k} k={k} v={v} connectionId={connectionId} connBody={connBody} onSaved={handleSaved} onInfo={setInfoKey} onLog={onLog} />
                  ))}
                </tbody>
              </table>
            </>
          )}
          {filtered.length === 0 && search && (
            <div className="config-no-results">No configuration keys match &quot;{search}&quot;</div>
          )}
        </div>
      )}

      {infoKey && (
        <ConfigInfoModal
          configKey={infoKey}
          currentValue={config?.[infoKey] ?? ''}
          onClose={() => setInfoKey(null)}
        />
      )}
    </div>
  )
}
