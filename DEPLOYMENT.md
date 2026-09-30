# Deployment Guide

This covers running Redivue somewhere other than your own laptop — a home server, a VPS, or an
internal box your team reaches over the network. For "try it locally in 30 seconds," use the
Docker one-liner in the [README](README.md#quick-start) instead; this guide is for a setup meant
to stay up.

**Read [SECURITY.md](SECURITY.md) first.** Redivue has no login screen and no API key — anyone
who can reach its port can run arbitrary Redis commands through it. Everything below exists to
put something in front of it that does have auth, or to keep it off any network but your own.

## Which setup do I need?

| Situation | What to do |
|---|---|
| Just you, one machine | `docker run -p 127.0.0.1:8080:8080 ...` — bind to loopback only, skip everything below |
| Just you, reachable over Tailscale/VPN/SSH tunnel | Same as above; the VPN is your auth layer |
| A team, on a shared internal server | This guide's Compose + nginx + TLS setup, **plus** basic auth or an OAuth proxy in front (see below) |
| Exposed to the public internet | Same as "a team," and think hard about whether it needs to be — Redivue is an admin tool, not a public-facing app |

## Production Compose setup

[`deploy/docker-compose.prod.yml`](deploy/docker-compose.prod.yml) runs two containers: the
Redivue app (not published on the host — only reachable through nginx) and an nginx reverse
proxy that terminates TLS, redirects HTTP → HTTPS, and rate-limits the API
([`deploy/nginx.conf`](deploy/nginx.conf): 60 req/s general, 10 req/min on destructive bulk
operations).

```bash
git clone https://github.com/abidinberkay/Redivue.git
cd Redivue

# 1. TLS certificate — pick one:
bash deploy/generate-certs.sh                    # self-signed, fine for an internal/VPN-only box
# — or, for a real domain —
certbot certonly --standalone -d your.domain.com
cp /etc/letsencrypt/live/your.domain.com/fullchain.pem deploy/ssl/cert.pem
cp /etc/letsencrypt/live/your.domain.com/privkey.pem    deploy/ssl/key.pem

# 2. Tell Redivue which hostname(s) it is served under (see "Allowed hosts" below)
export REDIVUE_ALLOWED_HOSTS=your.domain.com      # or your server IP; comma-separate several

# 3. Build and start
docker compose -f deploy/docker-compose.prod.yml up -d --build

# 4. Open
https://your-server-ip-or-domain
```

Self-signed certs trigger a browser warning (click through "Advanced" → "Proceed") — expected,
not a bug. Let's Encrypt needs port 80 reachable from the internet for the initial `certbot`
challenge; renew the same way and re-copy the two files (a cron job or `certbot renew --deploy-hook`
that restarts the nginx container works).

Redis itself is **not** part of this Compose file — point Redivue at Redis instances you already
run, the same as in the Quick Start. If your Redis also runs in Docker, put it on the same
`redivue-net` network (or any network reachable from the `redivue` container) and use its
container/service name as the host.

### Putting auth in front

Nginx here handles TLS and rate limiting, not authentication — add one of:

- **HTTP basic auth** — simplest option, add to the `location /` block in `nginx.conf`:
  ```nginx
  auth_basic           "Redivue";
  auth_basic_user_file /etc/nginx/.htpasswd;
  ```
  generate the file with `htpasswd -c deploy/nginx/.htpasswd youruser`, mount it into the nginx
  container alongside `nginx.conf`.
- **An OAuth proxy** (e.g. oauth2-proxy, Authelia) in front of nginx, if you want SSO / your
  team's existing identity provider.
- **A VPN or SSH tunnel** instead of exposing 80/443 at all — often the least work and the
  smallest attack surface for a small team.

## Environment variables

Redivue itself has no required configuration — no database URL, no API keys, nothing to set to
get it running. What you can override, using standard Spring Boot environment-variable mapping
(`SERVER_PORT` overrides `server.port`, etc. — see
[`backend/src/main/resources/application.yml`](backend/src/main/resources/application.yml) for
the defaults):

| Variable | Default | Purpose |
|---|---|---|
| `SERVER_PORT` | `8080` | Port the backend (and served frontend) listens on inside the container |
| `LOGGING_LEVEL_COM_REDIVUE` | `DEBUG` | App log verbosity — drop to `INFO` for a quieter production log |
| `JAVA_OPTS` / `JAVA_TOOL_OPTIONS` | *(none)* | JVM flags, e.g. `-Xmx512m` to cap heap on a small VPS |

Set them the normal Compose way:

```yaml
services:
  redivue:
    environment:
      - LOGGING_LEVEL_COM_REDIVUE=INFO
      - JAVA_TOOL_OPTIONS=-Xmx512m
```

### Allowed hosts

Redivue only answers requests whose `Host` header is `localhost`, `127.0.0.1` or `[::1]`, plus
whatever you list in `REDIVUE_ALLOWED_HOSTS` (comma-separated, ports ignored). This blocks
DNS-rebinding attacks, where a malicious web page points its own domain at `127.0.0.1` to talk to
a local Redivue. Anything served under another name — a domain, a LAN IP, a Tailscale name — needs
that name listed, or the browser gets `403 Host ... is not allowed`:

```yaml
services:
  redivue:
    environment:
      - REDIVUE_ALLOWED_HOSTS=redivue.internal.example,10.0.0.5
```

`REDIVUE_ALLOWED_HOSTS=*` turns the check off; only do that when something in front of Redivue
already restricts who can reach it.

Apart from that there's nothing to configure server-side — every Redis connection (host, auth, TLS certs,
SSH tunnel keys) is supplied per-connection from the browser at request time and lives in that
browser's `localStorage`, not in any server config. That also means **SSH private keys pasted
into the connection form are a per-connection, per-user thing, not a deployment concern** —
there's no server-side key file to manage or rotate. See the
[Auth Type Notes table in SECURITY.md](SECURITY.md#auth-type-notes) for how each connection type
(including SSH tunneling) handles its credentials.

## Redis compatibility

Redivue works against any Redis reachable over TCP or a Unix socket; specific features have their
own floor:

| Feature | Requires |
|---|---|
| Core key browsing/CRUD, CLI, Monitor, Pub/Sub, Memory Analysis | Redis 2.8+ |
| Streams (`XADD`/consumer groups) | Redis 5.0+ |
| ACL auth (username + password) | Redis 6.0+ |
| RedisJSON value formatting | The `RedisJSON` module loaded on the server (Redis Stack, or self-managed module) |
| Sentinel / Cluster connection types | Whatever Redis version your Sentinel/Cluster deployment runs |

Managed Redis (ElastiCache, Redis Cloud, Azure Cache, Upstash, etc.) generally works fine through
the **URL** connection type (`rediss://` for TLS) — just confirm the provider allows the commands
a given feature needs (e.g. some managed tiers restrict `MONITOR` or `CONFIG`).

## Updating

```bash
git pull
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

This rebuilds the Redivue image from source and restarts just that container — nginx and your
TLS certs are untouched. Nothing persists inside the `redivue` container itself (connections live
in the browser, not the server), so there's no volume or migration step to worry about.

## Health / monitoring

There's no `/actuator/health` endpoint (no Spring Actuator dependency) — `GET /` returning `200`
(the app's index page) is the health signal, and works fine as a Compose/orchestrator healthcheck
or an uptime-monitor target:

```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://localhost:8080/"]
  interval: 30s
  timeout: 5s
  retries: 3
```
