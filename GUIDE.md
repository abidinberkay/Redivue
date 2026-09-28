# User Guide

A practical, feature-by-feature walkthrough of what Redivue does and how to use it. For
install/quick start, see [README.md](README.md). For production deployment, see
[DEPLOYMENT.md](DEPLOYMENT.md). For the threat model, see [SECURITY.md](SECURITY.md) — read that
one before pointing Redivue at anything beyond `localhost`.

Redivue has no login screen: once it's running, everything below happens inside one connection
you add yourself. Nothing here requires a Redivue "account" — connections and preferences live in
your browser.

## Table of contents

- [Adding a connection](#adding-a-connection)
- [Stats](#stats) — dashboard + live config editing
- [Keys](#keys) — browse, search, edit, bulk operations
- [CLI](#cli) — full command console
- [Monitor](#monitor) — live command stream + slow log
- [Memory](#memory) — per-key and per-type memory breakdown
- [Pub/Sub](#pubsub)
- [Diff](#diff) — compare a key across two connections
- [Notifications](#notifications) — keyspace event stream
- [Migration](#migration) — copy/export/import keys
- [Activity log & undo](#activity-log--undo)
- [Managing your connection list](#managing-your-connection-list)

---

## Adding a connection

Click **Add Connection** in the sidebar. Pick an auth type based on what you're connecting to:

| Auth Type | When to use it |
|---|---|
| **Password** | Plain `requirepass` — the common case for a single-password Redis |
| **ACL** | Redis 6+ with `--aclfile` users — enter the ACL username too |
| **URL** | Managed Redis (ElastiCache, Redis Cloud, Upstash, etc.) — paste `redis://` or `rediss://` |
| **Sentinel** | Give the master name and your sentinel nodes; Redivue follows failover automatically |
| **Cluster** | Give one or more seed nodes; Redivue discovers the rest of the cluster |
| **Unix socket** | Redis running on the same host as Redivue — give the socket path |

Below the main fields, two collapsible sections add on top of any auth type:

- **SSH Tunnel** — for a Redis reachable only through a bastion host. Password or private-key
  (PEM) auth; Redivue keeps the tunnel open and pools it for ~10 minutes of idle time so repeated
  requests don't reconnect every time. Note: only *key-based* SSH auth works against the
  PAM/keyboard-interactive `sshd` most distros ship by default — password auth needs a server
  explicitly configured for plain password SSH.
- **TLS** — system CA, skip-verify (self-signed, e.g. local testing), a custom CA cert, or full
  mutual TLS (client cert + key) for servers that require it.

Once connected, the sidebar shows a live key-count badge next to the connection name — a quick
signal the connection is healthy without opening it.

## Stats

The landing tab for any connection: memory used, total keys, connected clients, uptime, Redis
version, role (master/replica), memory fragmentation ratio, AOF status, and last `BGSAVE` result.
Hit **Refresh** to re-pull it — there's no auto-polling, so long-running dashboards don't hammer
your Redis with stats calls.

The **Config** tab next to it lets you change two of the settings people actually touch day to
day without leaving the browser: `maxmemory` (with common presets, e.g. 256MB/1GB/2GB) and the
AOF persistence toggle, with an inline explanation of what turning it on/off means. Everything
else is deliberately left to `redis.cli CONFIG SET` or your own config file — Redivue isn't trying
to be a full `redis.conf` editor.

## Keys

The main workspace. A few things that aren't obvious from a first look:

- **Pattern search** uses real Redis glob patterns (`user:*`, `session:??`, `[abc]*`), not
  substring matching — the same syntax as `SCAN MATCH`.
- **Tree view** groups keys by `:` the way most people namespace them (`user:1:profile` becomes
  `user` → `1` → `profile` in a collapsible tree) — toggle it next to the search bar when you'd
  rather browse than search.
- **The size column** is real `MEMORY USAGE`, not an estimate — useful for spotting the handful of
  oversized keys in a database without running Memory Analysis.
- **Value viewer formatters**: open any key and switch the formatter — JSON tree (collapsible),
  HEX dump, Binary, Unix Timestamp (renders as a date), or decompress the raw bytes as
  GZIP/Deflate/ZSTD/LZ4/Snappy if that's how your app stores it. RedisJSON keys (module) get their
  own native tree editor.
- **Per-type editing**: every Redis type has its own inline editor — hash field add/edit/delete,
  list push/remove/reorder, set add/remove member, sorted set add/remove with score adjustment,
  stream entry add/delete with consumer-group info.
- **TTL**: click a key's TTL to open quick actions (remove it, or set a common duration) with a
  live countdown, or select several keys and set/clear TTL on all of them at once.
- **Bulk operations**: select keys (or target everything matching the current search pattern) and
  delete, set TTL, or export to JSON/CSV in one action.
- **Search history & bookmarks**: your last 10 search patterns are one click away in the search
  dropdown; star any key to pin it in a bookmarks panel, and export/import your bookmark list as
  JSON if you're moving between machines.
- **Database selector**: switch between DB 0–15 from the connection header — the key list,
  search, and stats all follow the selected database. `FLUSHDB` (from the CLI or elsewhere) always
  confirms before running.

## CLI

A full `redis-cli` replacement in the browser — 150+ commands across every category (String, Key,
Hash, List, Set, Sorted Set, Stream, Geo, HyperLogLog, Bit, Transaction, Pub/Sub, ACL, Server,
Scripting), with autocomplete and inline syntax help as you type, up/down history, and a
**Favorites** list for commands you run often. Multi-line input is supported for anything that
needs it (`EVAL` scripts, etc.).

Destructive commands (`FLUSHDB`, `FLUSHALL`, `SHUTDOWN`, `SCRIPT FLUSH`) require confirming
**twice** before they run — the one safety net the CLI has, since otherwise it executes exactly
what you type with no allow-list (see [SECURITY.md](SECURITY.md) for why that's by design, not an
oversight).

**Bulk import**: drop in a `.txt`/`.redis`/`.cli` file of one command per line and Redivue runs it
top to bottom with a progress bar — handy for loading fixture data or replaying an exported
command log.

## Monitor

A live view of `MONITOR` — every command hitting the server, as it happens — with pattern
filtering and latency-based coloring so slow commands stand out in the stream. Turn it off when
you're done; like real `MONITOR`, watching a busy production Redis has a real (if usually small)
performance cost.

The **slow log viewer** on the same tab reads Redis's own slow log (`SLOWLOG GET`) instead of
watching live traffic — average/min/max latency and the worst offenders, without needing to leave
Monitor running.

## Memory

Runs a scan across the selected database and breaks down where memory actually goes: top-N
largest keys, a per-type breakdown (string vs hash vs list vs...), TTL distribution (how many keys
never expire vs. expire soon), and a handful of automatic recommendations (large keys worth a
second look, keys with no TTL that probably should have one). Each analysis is saved to a small
local history so you can compare a database's memory shape over time, not just see a single
snapshot.

## Pub/Sub

Publish messages to any channel and subscribe to others in the same view — channel discovery
(`PUBSUB CHANNELS`) so you can see what's actually active without guessing channel names, a live
message-rate counter, and automatic JSON syntax highlighting for messages that are JSON.

## Diff

Compare the same key across two different connections (or the same connection, two databases) —
useful for "does staging actually match prod for this key" questions. Shows a side-by-side value
diff with line-level highlighting (LCS-based), TTL for both sides, and a one-click sync button to
copy the value in either direction once you've confirmed which side is right.

## Notifications

Redis's keyspace notifications (`notify-keyspace-events`), made visible. The tab checks whether
notifications are enabled and offers a one-click **Enable** (`CONFIG SET notify-keyspace-events
KEA`) if not — note this is a server-wide setting with a small perf cost, so it's your call whether
to turn it on. Once enabled, every key event (set, delete, expire, rename, ...) streams in live
with a colored badge per event type, filterable by key name or event type.

## Migration

Copy or move keys between connections or databases — including across totally different Redis
versions or configurations, since it falls back to a type-agnostic `DUMP`/`RESTORE` for anything
the typed copy path doesn't handle (custom module types, edge-case encodings). Same tab handles
disk export/import if you want a portable snapshot of a key set rather than a live connection-to-
connection copy.

## Activity log & undo

Every mutation you make (through the UI, not raw CLI commands) is recorded in the sidebar's
activity log — what changed, the old and new value, and an **undo** button for anything you want
to walk back. It's a session log, not a durable audit trail — it resets when you reload the page.

## Managing your connection list

Connections live in your browser's `localStorage`, obfuscated (not encrypted — see
[SECURITY.md](SECURITY.md#known-limitations-by-design-not-bugs) for exactly what that means)
rather than on any Redivue server. To move your connection list to another machine, or back it up:
export it as JSON from the sidebar (native "Save As" picker on Chrome/Edge, plain download
elsewhere) — passwords/secrets are stripped by default, with an explicit opt-in checkbox if you
really want them included in the file. Import merges the file into whatever's already saved,
it doesn't replace it.
