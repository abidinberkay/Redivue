# Contributing to Redivue

Architecture notes, conventions, and known quirks for anyone working on the codebase.

## Architecture

### Tech Stack
- **Backend:** Spring Boot 3, Java 21, Maven, Lettuce (async Redis client), SSE for real-time streams
- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS + Material Design 3 tokens, Radix UI primitives via a shadcn-style `src/components/ui/` set, axios for HTTP, EventSource for SSE streams
- **Database:** Redis (multiple connections supported)
- **DevOps:** `Dockerfile` builds the backend (frontend baked in); no bundled Redis test infra — bring your own Redis

### Project Structure
```
redivue/
├── backend/
│   ├── src/main/java/com/redivue/
│   │   ├── RedivueApplication.java          # Main Spring Boot app
│   │   ├── config/WebConfig.java            # CORS, static resource config
│   │   ├── controller/RedisController.java  # All API endpoints
│   │   ├── service/
│   │   │   ├── RedisService.java            # Core Redis operations
│   │   │   ├── MonitorService.java          # MONITOR + SLOWLOG streaming (SSE)
│   │   │   ├── PubSubService.java           # Pub/Sub subscribe/publish (SSE)
│   │   │   └── KeyspaceService.java         # Keyspace notifications (SSE)
│   │   └── model/                           # Request/response DTOs
│   ├── pom.xml                              # Maven build — also builds frontend
│   └── target/                              # Maven build output
├── frontend/                                # React 18 + Vite
│   ├── src/
│   │   ├── App.tsx                          # Root component, sidebar, connection management
│   │   ├── types/index.ts                   # Shared TypeScript types
│   │   ├── utils/encryption.ts              # Password encryption (XOR + base64)
│   │   ├── components/ui/                   # shadcn-style Radix UI primitives (button, dialog, table, ...)
│   │   └── features/
│   │       ├── dashboard/                   # Stats, Config, Activity, Dashboard tabs
│   │       ├── keys/                        # Keys Browser, KeyDetail, modals
│   │       ├── cli/                         # CLI Console (single + multi-pane)
│   │       ├── monitor/                     # Real-time MONITOR + SLOWLOG
│   │       ├── memory/                      # Memory Analysis
│   │       ├── pubsub/                      # Pub/Sub publisher + subscriber
│   │       ├── keydiff/                     # Key Diff (side-by-side comparison)
│   │       ├── migration/                   # Data Migration
│   │       ├── keyspace/                    # Keyspace Notifications
│   │       └── connections/                 # Connection form
│   ├── vite.config.ts                       # outDir → ../backend/src/main/resources/static
│   └── package.json
├── Dockerfile
├── FEATURES.md                              # Feature roadmap (detailed)
├── README.md
├── SECURITY.md
├── TODO.txt
└── CONTRIBUTING.md (this file)
```

### Frontend-Backend Communication
- **URL:** Frontend dev server proxies to `http://localhost:8080`
- **Port:** Dev server runs on 3000 (via Vite), prod on 8080
- **Request pattern:** `POST /api/redis/{connectionId}/<endpoint>`
- **Body:** Always includes `{ host, port, password, db }` for stateless operation
- **Streaming:** SSE (EventSource) for Monitor, PubSub, Keyspace — never WebSocket

## Development Workflow

### Running Locally

**Option 1: Full build (production-like)**
```bash
cd backend
mvn clean install
mvn spring-boot:run
# Then open http://localhost:8080
```

**Option 2: Dev mode with hot reload**
```bash
# Terminal 1: Backend
cd backend && mvn spring-boot:run

# Terminal 2: Frontend with live reload
cd frontend && npm install && npm run dev
# Then open http://localhost:3000 (or address from terminal)
```

**Testing with Redis:** Redivue is stateless and connects to whatever Redis instance you point
it at — bring your own (a local `redis-server`, a quick `docker run -p 6379:6379 redis:7-alpine`,
or an existing instance) and add it from the dashboard with its host/port/password.

### Build & Deploy
```bash
cd backend
mvn clean package
java -jar target/redivue-backend-1.0.0-SNAPSHOT.jar
# Opens at http://localhost:8080 (includes built frontend)
```

## Key Components & Patterns

### Backend (Java)

**RedisConnectionHolder (`config/RedisConnectionHolder.java`)**
- AutoCloseable wrapper for both `RedisClient` (standalone/sentinel/socket) and `RedisClusterClient`
- `sync()` / `async()` return `RedisCommands` via unsafe cast for cluster (safe at runtime)
- All RedisService methods use `try (RedisConnectionHolder h = RedisURIHelper.connect(req)) { ... }`

**RedisURIHelper (`config/RedisURIHelper.java`)**
- `connect(RedisConnection)` factory — returns `RedisConnectionHolder` for any auth type
- `build(RedisConnection)` — builds `RedisURI` for standalone, URL, Sentinel, Socket
- Cluster type handled only via `connect()` (uses `RedisClusterClient.create(seeds)`)

**ConnectionSessionRegistry (`service/ConnectionSessionRegistry.java`)**
- Server-side token → RedisConnection store for SSE auth
- `register(conn)` → returns UUID token; `get(token)` → refreshes TTL, returns conn
- Background cleanup thread removes entries idle > 30 min

**RedisService (`service/RedisService.java`)**
- Core Redis operations using Lettuce; all ~30 methods use try-with-resources with `RedisConnectionHolder`
- Two-connection methods (copyKey, bulk copy): `try (holder src = ...; holder dst = connectTarget(...)) { ... }`

**RedisController (`controller/RedisController.java`)**
- REST API endpoints for all frontend needs
- All endpoints follow: `POST /api/redis/{id}/<operation>`
- Body includes full `ConnBody` (host, port, password, db, authType, username, url, useTls, masterName, sentinelNodes, clusterNodes, socketPath)
- SSE endpoints accept optional `sessionToken` query param (host/port/password params also accepted for fallback)
- Key endpoints:
  - `/stats` — memory, keys, clients, uptime, version, role
  - `/key/**` — CRUD operations (create, read, update, delete keys)
  - `/keys/**` — SCAN, bulk delete, copy, export
  - `/cli` — raw command execution
  - `/config/**` — CONFIG GET/SET operations
  - `/monitor/**` — real-time MONITOR + SLOWLOG (SSE)
  - `/memory/analyze` — memory usage analysis
  - `/pubsub/**` — Pub/Sub subscribe/publish/discover (SSE)
  - `/keyspace/**` — keyspace notifications check/enable/stream (SSE)
  - `/bulk/**` — bulk TTL, delete, copy operations
  - `/diff` — key diff between two connections
  - `/session` — register connection, get sessionToken for SSE

**WebConfig (`config/WebConfig.java`)**
- CORS configuration (allows localhost)
- Static resource serving (built frontend from `/static`)

### Frontend (React + TypeScript)

**App.tsx — Root component**
- Manages connections (localStorage key: `redivue_connections`, passwords encrypted)
- Sidebar with connection list, health indicators, per-connection DB selector
- Renders Dashboard per connection

**Dashboard (`features/dashboard/index.tsx`)**
- Tab bar: Stats, Keys, CLI, Monitor, Config, Migration, Memory, Pub/Sub, Diff, Notifications
- Shared activity log panel (recent mutations, undo support)

**SSE pattern (Monitor / PubSub / Keyspace):**
1. Call `await registerSession(connection.id, connection)` → get `sessionToken`
2. Pass `?sessionToken=...` in EventSource GET URL (no host/port/password in URL)
3. Backend `resolveConnection()` looks up token from `ConnectionSessionRegistry`

**Key feature components:**
- `features/connections/ConnectionForm` — Add/test/delete connections; 6 auth types with conditional fields and hint boxes
- `features/dashboard/StatsView` — Redis stats display
- `features/dashboard/ConfigView` — maxmemory + AOF config editor
- `features/keys/` — SCAN browser, KeyDetail (string/hash/list/set/zset/stream), bulk ops modals, favorites + search history
  - Stream support: XADD/XDEL entries, consumer groups viewer (XINFO GROUPS/CONSUMERS)
- `features/cli/CliConsole` — Command input, history, autocomplete, favorites
- `features/monitor/MonitorView` — Real-time MONITOR + SLOWLOG (SSE, unlimited option)
- `features/memory/MemoryView` — Memory usage analysis, recommendations
- `features/pubsub/PubSubView` — Pub/Sub subscribe/publish, channel discovery
- `features/keydiff/KeyDiffView` — Side-by-side key diff, batch copy
- `features/migration/MigrationView` — Bulk key migration between connections
- `features/keyspace/KeyspaceView` — Keyspace notifications (requires Redis config)

**Storage:**
- `localStorage` key `redivue_connections` — connections (passwords encrypted)
- `localStorage` key `redivue_history_{id}` — per-connection search history
- `localStorage` key `redivue_favorites_{id}` — per-connection favorite keys

## Conventions

### Naming & Structure
- **Request/Response DTOs:** Match operation name, e.g., `KeyScanRequest`, `KeyScanResult`
- **Frontend components:** PascalCase, one component per file
- **API endpoints:** lowercase with hyphens, e.g., `/stats`, `/set-string`, `/list-op`
- **Methods:** camelCase, action-verb first (getStat, setKey, deleteConnection)

### Error Handling
- **Frontend:** Try/catch in async calls, display user-friendly error messages
- **Backend:** Return error messages in response (no 5xx exceptions exposed)
- Always validate input on both sides (type, length, port range)

### State Management
- **Connections:** localStorage (persisted across sessions)
- **Active connection:** React state in the root component
- **Tab-specific state:** Managed within each tab component
- **Activity log:** React state with undo support

## Common Tasks

### Adding a New Redis Operation
1. **Backend:**
   - Add request/response DTOs in `model/`
   - Add method in `RedisService.java` to execute operation
   - Add endpoint in `RedisController.java` (POST /api/redis/{id}/new-operation)
   - Ensure error handling and validation
2. **Frontend:**
   - Create or update component with input form
   - Make axios POST to `/api/redis/{connectionId}/new-operation`
   - Handle response, show error toast on failure
   - Refresh UI after mutation (or show optimistic update)

### Testing an Endpoint
```bash
curl -X POST http://localhost:8080/api/redis/test \
  -H "Content-Type: application/json" \
  -d '{"host":"localhost","port":6379,"password":null}'
```

### Debugging
- **Frontend:** Browser DevTools (Network tab for API calls)
- **Backend:** Spring logs to console, check `/api/redis/{id}/stats` response
- **Redis:** Use `redis-cli` directly or the dashboard's CLI Console tab

## Known Issues & Quirks

- Activity log undo is session-only (by design, not persisted to localStorage)
- Config editing supports only maxmemory and AOF (expandable in future)
- Password encryption is XOR+base64 — obfuscation, not real encryption; see SECURITY.md
- Stream browser: loads first 500 entries (limit for UI performance); large streams need CLI pagination
- Stream consumer groups: CLI syntax for XGROUP CREATE is `XGROUP CREATE key group $ MKSTREAM`
- Keyspace Notifications require `notify-keyspace-events KEA` in Redis config
- Monitor tab: does NOT support TLS, Sentinel, or Cluster (raw TCP socket limitation — returns clear error SSE event)
- Pub/Sub + Keyspace: Cluster not supported (returns clear error SSE event)
- Sentinel password: Lettuce `RedisURI.Builder` has no `withSentinelPassword()` — sentinel-node auth is not configurable
- SSE session tokens: 30-min idle TTL — if a tab is left open that long, the stream fails on reconnect (clear + restart stream)
- Auth type fields beyond the main password (e.g. `sentinelPassword`) are encrypted in localStorage the same way (XOR+base64)

## Code Quality Notes

- No long docstrings; add comments only for non-obvious WHY
- Prefer simple, readable code over premature abstraction
- Integration tests hit real Redis, never mocked
- Backend test suite (`backend/src/test/`): `RedisServiceIntegrationTest` (Testcontainers, redis:7-alpine, skips without Docker), `RedisURIHelperTest` + `TlsHelperTest` (pure unit). Run: `mvn test -Dexec.skip=true`
- Frontend has no automated tests yet — SSE services (Monitor/PubSub/Keyspace) + controller not covered — manual testing
- Type annotations required in Java, use JSDoc sparingly in frontend
- Follow existing style (review recent commits for current patterns)

## Useful Commands

```bash
# Build everything
mvn clean install -DskipTests

# Run backend tests (skips the npm frontend build; integration tests need Docker running)
cd backend && mvn test -Dexec.skip=true

# Run backend only
mvn spring-boot:run

# Run frontend dev server (from frontend/)
npm run dev

# Build frontend + pack into JAR
mvn clean package

# View frontend dist output
ls -la backend/target/classes/static/
```

## Notes for Contributors

- When adding new tabs, update `features/dashboard/index.tsx` TABS array
- Keep API endpoints stateless (client sends full connection body — all auth fields — each time)
- For new SSE endpoints: use `registerSession` + session token pattern (see SSE pattern section above)
- Project is fully TypeScript on the frontend — don't add new `.jsx` files
- Real-time features use SSE (EventSource), not WebSocket
- Test with multiple Redis instances (spin up throwaway ones with `docker run`, or point at real ones)
- Prefer compact one-line comments over multi-paragraph docstrings
- Before merging: verify features work in the actual app, not just in tests
- Auth types to keep in mind: PASSWORD, USERNAME_PASSWORD, URL, SENTINEL, CLUSTER, SOCKET — the backend uses `RedisURIHelper.connect()` for all of them
