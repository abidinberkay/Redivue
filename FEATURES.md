# Redivue — Feature Roadmap

## Current Features ✅
- Multi-connection support with auto-selection
- Redis stats dashboard (memory, keys, clients, uptime, version, role)
- Stats auto-refresh (manual refresh button)
- Editable config from dashboard (maxmemory with presets, AOF toggle with explanation)
- Connection health indicator with live key-count badge in sidebar
- Keys browser with SCAN-based pagination and pattern search
- Type detection for all Redis types (string, hash, list, set, zset, stream)
- TTL display for all keys
- **Key SIZE column** (MEMORY USAGE per key, formatted B/KB/MB)
- **Tree View** (namespace grouping by `:` separator with expand/collapse)
- Value viewer for all data types
- Key rename from value view
- Activity log panel (recent mutations, undo support, old/new diff view)
- Per-connection state persistence across tab switches
- Connection localStorage persistence
- **Frontend TypeScript migration** (.jsx → .tsx, tsconfig, shared types in `src/types/index.ts`)
- **Modern feature-based folder structure** (`src/features/` per feature with co-located CSS, hooks, modals)
- **CLI with comprehensive Redis command support** (150+ commands across all categories: String, Key, Hash, List, Set, Sorted Set, Stream, Geo, HyperLogLog, Bit, Transaction, Pub/Sub, ACL, Server, Script)
- **Optimized key scanning with pipelining** (parallel TYPE/TTL/MEMORY USAGE queries reduce latency)
- **Value Formatters** (JSON tree, HEX dump, Binary, Timestamp, GZIP/Deflate/ZSTD/LZ4/Snappy decompression)
- **Bulk Import** (run Redis commands from .txt/.redis/.cli file with progress tracking)
- **SSH Tunnel** (password + private-key/PEM auth, tunnel pooling with 10-min idle eviction)
- **TLS Client Certificates** (system CA, skip-verify, or custom CA; mutual TLS with client cert + key)
- **Connection list Export/Import** (JSON file; native "Save As" picker on Chrome/Edge with download fallback elsewhere; credentials encrypted in the file)
- **Resizable sidebar** (drag-to-resize connection list panel, width persisted in localStorage)

---

## Tier 1 — Essential Features (High value, Medium effort) ✅ DONE

### 1. Key CRUD Operations ✅
**What:** Create, update, delete keys and values directly from UI

**Subtasks:**
- [x] Delete key with confirmation dialog
- [x] Edit string value (textarea, save to Redis)
- [x] Add new key form (choose type, set value, TTL)
- [x] Hash field operations (add, delete, edit field)
- [x] List operations (push to head/tail, remove by index, edit element)
- [x] Set operations (add member, remove member)
- [x] Sorted set operations (add member with score, update score, remove)
- [x] Refresh data after each operation

**Backend endpoints needed:**
- `DELETE /api/redis/{id}/key` — delete a key
- `POST /api/redis/{id}/key/set-string` — set string value
- `POST /api/redis/{id}/key/set-ttl` — set/update TTL
- `POST /api/redis/{id}/key/hash-field` — HSET/HDEL field
- `POST /api/redis/{id}/key/list-op` — LPUSH/RPUSH/LREM element
- `POST /api/redis/{id}/key/set-op` — SADD/SREM member
- `POST /api/redis/{id}/key/zset-op` — ZADD/ZREM/update score

---

### 2. TTL Management ✅
**What:** Visual TTL management, set/remove/update expiry on any key

**Subtasks:**
- [x] TTL editor popup/modal (input seconds or timestamp)
- [x] Quick actions: remove TTL (-1), set common durations (1h, 1d, 7d, etc.)
- [x] Live countdown display (update every second)
- [x] Bulk TTL update for multiple keys
- [x] TTL persistence check (warn if expiring soon)

**Backend endpoints needed:**
- `POST /api/redis/{id}/key/ttl` — EXPIRE/PEXPIRE/PERSIST

---

### 3. CLI Console ✅
**What:** Run raw Redis commands directly, see formatted responses

**Subtasks:**
- [x] Command input with syntax highlighting
- [x] Command history (up/down arrow navigation)
- [x] Response formatter (JSON, table, raw text based on command)
- [x] Autocomplete Redis commands (150+ commands across all Redis data types)
- [x] Error handling and display
- [x] Multi-line command support
- [x] Response export (copy all to clipboard)
- [x] **Command history & favorites** (save frequently used commands)
- [x] **Comprehensive command help** (syntax + description for all 150+ commands)
- [x] **Dangerous command confirmation** (FLUSHDB, FLUSHALL, SHUTDOWN, SCRIPT FLUSH ask twice)

**Frontend:** New tab or modal with command input + result panel

**Backend endpoint:**
- `POST /api/redis/{id}/cli` — execute raw command(s)

**Command Coverage (150+ Redis commands):**
String, Key, Hash, List, Set, Sorted Set, HyperLogLog, Geo, Stream, Bit, Script, Transaction, Pub/Sub, ACL, Server commands

---

### 4. Connections localStorage Persistence ✅
**What:** Save connections to browser storage so they're not lost on page refresh

**Subtasks:**
- [x] Save connections to localStorage when added
- [x] Load connections from localStorage on app startup
- [x] Update localStorage when connection is deleted
- [x] Add "clear all saved connections" button with confirmation
- [x] Encrypt passwords before storing (XOR cipher + base64)

**Frontend only:** No backend changes needed. Passwords encrypted automatically on save, decrypted on load.

---

## Tier 2 — Powerful Features (High value, High effort) ✅ DONE (4/4 + Bulk Ops)

### 5. Real-time Monitor ✅
**What:** Live stream of all Redis commands being executed (MONITOR + slow query log)

**Subtasks:**
- [x] MONITOR stream display (real-time command log)
- [x] Filter commands by pattern/type
- [x] Command latency visualization
- [x] Pause/resume monitoring
- [x] Clear log
- [x] Export log (monitor log as .txt, slow log as .csv)
- [x] Slow Log viewer (SLOWLOG GET) with duration coloring
- [x] Auto-stop options (by time or entry count)
- [x] Slow log stats (entries, avg/min/max latency, top commands by total time)

**Frontend:** New tab with split view (MONITOR + SLOWLOG)

**Backend endpoints:**
- `GET /api/redis/{id}/monitor/stream` — Server-Sent Events (SSE) for real-time stream
- `GET /api/redis/{id}/slowlog` — SLOWLOG GET + formatting

---

### 6. Memory Analysis ✅
**What:** Understand which keys consume most memory, optimize storage

**Subtasks:**
- [x] Per-key memory usage with MEMORY USAGE command
- [x] Top-N memory consumers table (sortable)
- [x] Memory distribution visualization (colored bar chart by type)
- [x] Memory breakdown by type (strings, hashes, lists, etc.)
- [x] Smart recommendations (large keys, TTL warnings, dominance alerts)
- [x] TTL distribution visualization (bucketed chips)
- [x] Namespace drill-down grouping
- [x] CSV/JSON export

**Frontend:** MemoryView.tsx tab — pattern search, type breakdown cards with bar chart, TTL distribution, namespace view, sortable/filterable key table, recommendations panel

**Backend endpoints:**
- `POST /api/redis/{id}/memory/analyze` — MEMORY USAGE pipeline, returns key details + byType aggregate

---

### 7. Pub/Sub ✅
**What:** Subscribe to Redis channels and see real-time messages

**Subtasks:**
- [x] Channel subscription form (enter channel name)
- [x] Real-time message stream display (SSE)
- [x] Message count per channel (Channel Statistics)
- [x] Publish message to channel from UI
- [x] Pattern subscribe (PSUBSCRIBE)
- [x] Unsubscribe / auto-unsubscribe on disconnect
- [x] Message export/logging

**Plus extras:**
- [x] JSON syntax highlighting for messages (keys, strings, numbers, booleans colored)
- [x] Real-time message rate counter (msg/s from 5-sec window)
- [x] Channel discovery panel (PUBSUB CHANNELS + NUMSUB)
- [x] Auto-reconnect on disconnect (max 5 retries)
- [x] Publish history (localStorage)
- [x] Sticky bottom / auto-scroll toggle

**Frontend:** New PubSubView tab with publisher + subscriber panels

**Backend:**
- `GET /api/redis/{id}/pubsub/stream` — SSE subscription stream
- `POST /api/redis/{id}/publish` — publish message
- `GET /api/redis/{id}/pubsub/channels` — discover active channels

---

### 8. Bulk Operations ✅
**What:** Operate on multiple keys at once (delete by pattern, export, etc.)

**Subtasks:**
- [x] Delete selected keys (checkbox-based bulk delete with confirmation)
- [x] TTL update for selected keys (bulk TTL)
- [x] Rename single key (from value view)
- [x] Delete keys matching pattern (with confirmation)
- [x] Export keys to JSON
- [x] Export keys to CSV
- [x] Copy key(s) to another database / connection
- [x] Data backup/snapshot before bulk ops

**Frontend:** Bulk ops dialog, triggered from keys browser

**Backend endpoints:**
- `POST /api/redis/{id}/bulk/delete` — delete by pattern
- `POST /api/redis/{id}/bulk/export` — export keys as JSON/CSV
- `POST /api/redis/{id}/bulk/ttl` — update TTL for pattern
- `POST /api/redis/{id}/bulk/copy` — copy to another DB/connection

---

## Tier 3 — Nice to Have ✅ DONE

### 9. Database Selector ✅ DONE
**What:** Switch between Redis databases (0-15) in the same connection

**Subtasks:**
- [x] Database dropdown in connection header (sidebar, per-connection)
- [x] Keys browser filters by selected database
- [x] Stats show database-specific info
- [x] Preserve selected database when switching connections (localStorage)
- [x] FLUSHDB confirmation

**Backend:** Minor changes to pass db parameter

---

### 10. Key Diff ✅ DONE
**What:** Compare the same key across different connections

**Subtasks:**
- [x] Select two connections
- [x] Enter same key name
- [x] Show diff view (side-by-side value comparison)
- [x] Highlight differences (LCS-based line diff, red/green coloring)
- [x] Sync option (copy from one to another)

**Frontend:** `KeyDiffView.tsx` tab in Dashboard — connection selector, key input, side-by-side panels with diff highlighting, TTL display, copy left↔right sync

**Backend endpoint:**
- `POST /api/redis/diff` — get value from two connections, return both

---

### 11. Search History & Favorites ✅ DONE
**What:** Quick access to frequently used patterns and keys

**Subtasks:**
- [x] Store recent search patterns
- [x] Dropdown with 10 last searches
- [x] Bookmark favorite keys (star icon)
- [x] Bookmarks sidebar / quick access panel (favorites dropdown)
- [x] Export/import bookmarks (JSON)

**Frontend:** localStorage for history/bookmarks — fully implemented in Keys Browser. Export as JSON, import merges with existing bookmarks.

---

### 12. Keyspace Notifications ✅ DONE
**What:** Real-time alerts when keys change or expire

**Subtasks:**
- [x] Check if notify-keyspace-events is enabled (CONFIG GET)
- [x] Enable notifications from UI (CONFIG SET notify-keyspace-events KEA)
- [x] Subscribe to keyevent pattern (PSUBSCRIBE __keyevent@{db}__:*)
- [x] Display event log with colored badges (write/delete/ttl/rename)
- [x] Filter by key name or event type
- [x] "Notifications" tab in Dashboard with info + requirement banners

**Frontend:** `KeyspaceView.tsx` — config check on mount, enable button, SSE stream, colored event log
**Backend endpoints:**
- `POST /api/redis/{id}/keyspace/check` — check config
- `POST /api/redis/{id}/keyspace/enable` — enable via CONFIG SET KEA
- `GET /api/redis/{id}/keyspace/stream` — SSE stream

---

## Tier 4 — RedisInsight Parity ✅ DONE

### 13. STREAM Data Type ✅ DONE
**What:** Full support for Redis Streams as a first-class key type

**Subtasks:**
- [x] Stream detection in keys browser
- [x] XADD — add entries
- [x] XRANGE / XREVRANGE — list entries (first 500, UI limit; use CLI for larger streams)
- [x] XDEL — delete entries
- [x] Consumer groups viewer (XINFO GROUPS / XINFO CONSUMERS)
- [x] Stream CLI commands (XADD, XLEN, XDEL, XRANGE, XREVRANGE, XINFO, XGROUP, XACK)

**Frontend:** Stream view in KeyDetail
**Backend:** Stream endpoints under `/api/redis/{id}/key/stream/**`

---

### 14. Tree View ✅ DONE
**What:** Namespace-grouped view of the keys browser (`:` separator, like a folder tree)

**Subtasks:**
- [x] Group keys by `:` separator (`user:1:profile` → `user` > `1` > `profile`)
- [x] List/Tree view toggle
- [x] Expand/Collapse all
- [x] Favorite star + key detail open from tree nodes

**Frontend:** Tree mode toggle in the keys browser

---

### 15. Value Formatters ✅ DONE
**What:** Format selector in the key detail value viewer

**Subtasks:**
- [x] JSON formatter (pretty-print tree view)
- [x] HEX formatter (hex dump with offset + ASCII)
- [x] Binary formatter (bit string)
- [x] Timestamp formatter (unix → ISO/local/UTC table)
- [x] Decompression: GZIP, Deflate (browser native), ZSTD (fzstd), LZ4 (lz4js), Snappy (snappyjs)
- [x] CLI JSON hint (warns on unquoted `{`/`[` in commands)

**Frontend:** Formatter selector in `KeyDetail` value viewer

---

### 16. Key SIZE Column ✅ DONE
**What:** Per-key memory usage (MEMORY USAGE) shown in the keys browser

**Subtasks:**
- [x] Backend: `KeyInfo.memoryBytes`, pipelined into the scan (0 extra round-trips)
- [x] Frontend: `formatSize()` util (B/KB/MB), Size column in table + tree view
- [x] Null case shows "—"

**Backend:** `RedisService.scanKeys()` pipeline extended with memoryUsage futures

---

### 17. Bulk Import ✅ DONE
**What:** Run Redis commands from an uploaded file

**Subtasks:**
- [x] File upload (.txt/.redis/.cli), reuses CLI dispatch logic (skips `#` comments and blank lines)
- [x] Command preview before running
- [x] Progress tracking during execution

**Frontend:** MigrationView "⬆ Bulk Import" mode
**Backend:** `POST /api/redis/{id}/bulk/import-commands`

---

### 18. SSH Tunnel ✅ DONE
**What:** Connect to Redis instances reachable only through a bastion/jump host

**Subtasks:**
- [x] Password auth + private key (PEM) auth
- [x] Tunnel pooling with 10-minute idle eviction (`@Scheduled`)
- [x] Wired into RedisService, MonitorService, PubSubService, KeyspaceService
- [x] ConnectionForm SSH Tunnel toggle section (PASSWORD/ACL auth types)
- [x] End-to-end test (2026-08-23): docker ssh-tunnel container + redis-primary, private key
      (ed25519) auth — tunnel opened, key scan through the tunnel worked

**Backend:** `SshTunnelHelper` (JSch), `SshTunnelPool`
**Known limitation:** Password auth only works if the server offers plain "password" auth.
Most PAM-based sshd (Ubuntu/Debian defaults) only offer "keyboard-interactive", which
JSch's `session.setPassword()` doesn't support. A fix was attempted (UserInfo/UIKeyboardInteractive
callback) but reverted — out of scope for now. **Key auth is the recommended method.**

---

### 19. TLS Client Certificates ✅ DONE
**What:** Full TLS support — system CA, skip-verify, custom CA, and mutual TLS

**Subtasks:**
- [x] System CA (default), Skip verification, Custom CA cert modes
- [x] Client cert + key (mutual TLS) — PEM written to a temp file, `SslOptions.keyManager(...)`
- [x] Works for both standalone `RedisClient` and `RedisClusterClient`
- [x] ConnectionForm "TLS Certificates" section (shown when `useTls=true`)

**Backend:** `TlsHelper.buildSslOptions()` / `buildClientOptions()`, applied automatically in `RedisURIHelper.connect()`
**Tested:** against `docker redis-tls` (port 6381) with a custom CA cert

---

### 20. Connection List Export/Import ✅ DONE
**What:** Move the saved connection list between machines as a JSON file

**Subtasks:**
- [x] Export all connections to a single JSON file
- [x] Secrets (password, sentinelPassword, sshPassword, sshPrivateKey, sshPrivateKeyPassphrase,
      tlsClientKey) are stripped from the file by default — "Include passwords & secrets" checkbox
      is an explicit opt-in, since the file lands on disk in plaintext (the app's XOR+base64
      "encryption" is trivially reversible, not real protection)
- [x] Native "Save As" file picker on Chrome/Edge (`showSaveFilePicker`) — falls back to a normal download on Firefox/Safari
- [x] Import merges into the existing list, reassigning IDs to avoid collisions; malformed entries
      (missing host/port) are skipped with an "N imported, M skipped" status message

**Frontend:** Export/Import buttons (⬇/⬆) in the sidebar connections header
**Tested (2026-08-23):** export → secrets came back null by default; import → new connection added
with correct fields and a unique ID; malformed JSON file → clear error message shown

---

### 21. Resizable Sidebar ✅ DONE
**What:** Drag-to-resize the connections sidebar panel

**Subtasks:**
- [x] Drag handle between sidebar and dashboard area
- [x] Width clamped between 200px–560px
- [x] Width persisted to localStorage across reloads

**Frontend:** `App.tsx` — resize handle + `sidebarWidth` state

---

### 22. JSON (RedisJSON module) Data Type ✅ DONE
**What:** Full support for RedisJSON documents as a first-class key type

**Subtasks:**
- [x] `redis/redis-stack-server` Docker image (RedisJSON + RediSearch bundled, no manual module pull)
- [x] `TYPE` normalization: RedisJSON keys report `"ReJSON-RL"`, normalized to `"json"` everywhere
      (scanKeys, getKeyValue, scanAll) so the frontend's type-based routing matches
- [x] `JSON.GET` fetch wired into `getKeyValue()` (previously always returned `null` for JSON keys)
- [x] CLI support for `JSON.SET/GET/DEL/FORGET/TYPE/STRLEN/OBJLEN/ARRLEN/CLEAR/TOGGLE/NUMINCRBY/ARRAPPEND/OBJKEYS`
      via Lettuce's raw `dispatch()` API (`CommandArgs` + `ProtocolKeyword`) — Lettuce has no typed API for RedisJSON
- [x] Dedicated `POST /key/json-set` endpoint for writes (AddKeyModal + KeyDetail edit) — avoids
      routing the JSON payload through the CLI text tokenizer, which treated embedded `"` as token
      boundaries and corrupted nested-quote JSON
- [x] Nested tree view rendering (reuses the existing JSON formatter UI)
- [x] Bulk copy / migration / export-to-disk support JSON (and any future module type) via a
      type-agnostic `DUMP`/`RESTORE` fallback — see #24

**Frontend:** `AddKeyModal.tsx`, `KeyDetail.tsx`
**Backend:** `RedisService.java` (`dispatchRaw`/`protocolKeyword` helpers, `setJson()`, type normalization),
`JsonSetRequest.java`, `RedisController.java`
**Tested (2026-08-23):** create → keys browser shows "JSON" type badge → detail tree view
(colored, nested) renders correctly → edit with nested-quote JSON → delete. CLI `JSON.TYPE`/`JSON.DEL`
also verified directly.

---

### 23. Database Analysis History ✅ DONE
**What:** Save Memory Analysis snapshots and compare them over time

**Subtasks:**
- [x] "📌 Save Snapshot" — stores the current analysis (totalBytes, totalScanned, byType, pattern,
      timestamp) to localStorage, per connection+DB, last 30 kept (FIFO)
- [x] "🕐 History (n)" panel lists saved snapshots — each row shows delta vs. the previous
      snapshot (chronological) and delta vs. the current live analysis (increase red, decrease
      green, % + byte diff)
- [x] Delete individual snapshots or clear all history

**Frontend:** `MemoryView.tsx` (`loadHistory`/`saveHistory`/`fmtDelta` + History panel UI), `MemoryView.css`
**Backend:** none — fully client-side
**Tested (2026-08-23):** snapshot at 20 keys (2.3 KB) → added 20 more keys (7.8 KB) → re-analyzed →
History panel correctly showed "vs current analysis: +5.5 KB (+233.3%)" in red; delete and
clear-history also verified

---

### 24. Type-agnostic Bulk Copy / Migration / Export (DUMP/RESTORE) ✅ DONE
**What:** Bulk copy, cross-connection migration, and export/import-to-disk now handle **every**
key type — including JSON (`ReJSON-RL`) and any future module type — instead of failing with
`Unsupported type: ReJSON-RL`.

**How it works:**
- Known types (string/hash/list/set/zset/stream) keep their existing field-level reconstruction
  (version-agnostic, works across mismatched Redis versions).
- Any other type falls through to `DUMP` on the source + `RESTORE` on the target — an exact binary
  copy that preserves the on-the-wire encoding.
- Export-to-disk wraps the `DUMP` payload as base64 under a `__dump_b64__` marker in the JSON file;
  import detects the marker and `RESTORE`s it regardless of the declared type.
- `DUMP`/`RESTORE` payloads are not valid UTF-8, so a sibling **binary-codec** connection
  (`ByteArrayCodec`) is opened lazily on `RedisConnectionHolder` and closed with it.
- Clear error when the target can't accept the payload (older Redis, or missing the owning module).

**Backend:** `RedisConnectionHolder.binarySync()`, `RedisService` (`dumpRestore()`, `readValue`/`writeValue`
`__dump_b64__` handling, `copyOne` signature now takes the holders)
**Tested (2026-09-12, direct API calls against `redis-json`/`redis-primary` docker-compose services —
not yet exercised through the UI):** JSON copy 6382 db0→db1 (`{"type":"json","status":"ok"}`, value +
`ReJSON-RL` type verified) · mixed batch copy (JSON + string) · export-disk → import-disk round-trip
restores the JSON doc · string copy regression still `ok` cross-connection (6382→6379) · JSON →
non-module Redis (6379) returns `"RESTORE failed … missing the module"` instead of a silent failure.

---

## Implementation Status

**✅ Completed — All features done:**
- **Tier 1:** Key CRUD, TTL Management, CLI Console, localStorage Persistence (+ password encryption)
- **Tier 2:** Real-time Monitor (unlimited mode), Memory Analysis, Pub/Sub, Bulk Operations
- **Tier 3:** Database Selector, Key Diff, Search History & Favorites, Keyspace Notifications
- **Tier 4 (RedisInsight Parity):** STREAM type, Tree View, Value Formatters, Key SIZE column, Bulk Import, SSH Tunnel, TLS Client Certificates, Connection Export/Import, Resizable Sidebar, JSON (RedisJSON), Database Analysis History, Type-agnostic Bulk Copy/Migration/Export (DUMP/RESTORE)
- **Bonus:** Frontend TypeScript migration, feature-based structure, SSE streaming

**🎉 All Features Complete!** — remaining work is open-source prep (DEPLOYMENT.md, README rewrite, OSV-Scanner) and optional advanced features — see TODO.txt

---

## Backend Optimizations

### Key Scanning Pipelining ✅
**What:** Parallel TYPE/TTL queries for key scanning

**How it works:**
- Before: SCAN → TYPE key1 → TYPE key2 → ... → TTL key1 → TTL key2 → ... (serial, 200+ roundtrips for 100 keys)
- After: SCAN → [batch all TYPE + TTL commands] → collect all responses (pipelined, 2 roundtrips)
- **Result:** 50–100× latency reduction for large key scans, zero user-facing API changes

**Implementation:**
- `RedisConnectionHolder.java`: Added `setAutoFlushCommands()` and `flushCommands()` methods
- `RedisService.scanKeys()`: Uses `LettuceFutures.awaitAll()` to batch async commands

---

## Notes
- All endpoints follow pattern: `POST /api/redis/{connectionId}/<endpoint>`
- All endpoints receive full `ConnBody` in body for stateless operation (host, port, password, db, authType, username, url, useTls, masterName, sentinelNodes, clusterNodes, socketPath)
- Error responses should be clear (invalid key, type mismatch, Redis error, etc.)
- All mutations (create/update/delete) should refresh the UI immediately
- SSE endpoints (Monitor, Pub/Sub, Keyspace) use session tokens — POST to `/{id}/session` first, then pass `sessionToken` in GET query params
- Frontend is now TypeScript (.tsx) — do not add new .jsx files
- Frontend uses feature-based structure: `src/features/<feature>/` with co-located CSS, hooks, and modals
- CLI supports 150+ Redis commands with help text, autocomplete, favorites, and dangerous command confirmation

---

## Auth Type Support Matrix

| Feature | PASSWORD | ACL | URL | Sentinel | Cluster | Socket |
|---------|----------|-----|-----|----------|---------|--------|
| Stats, Keys, CLI, Config, Migration | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Monitor (real-time stream) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Pub/Sub | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Keyspace Notifications | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| TLS/SSL | ✅ | ✅ | via URI | ❌ | ✅ | N/A |

Monitor limitations: uses raw TCP socket (MONITOR cmd); TLS requires SSLSocket, Sentinel requires master discovery, Cluster is per-node.
