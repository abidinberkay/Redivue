# Security Policy

## Reporting a Vulnerability

Please report security issues privately — **do not open a public GitHub issue**.

Use GitHub's **"Report a vulnerability"** button under this repo's Security tab (Private
vulnerability reporting) to open a draft security advisory visible only to the maintainer.
Include steps to reproduce and, if relevant, which feature/endpoint is affected. Expect an
initial response within a few days.

## Supported Versions

Redivue does not maintain long-term release branches — only the latest commit on `main` receives
security fixes. There is no LTS branch.

## Threat Model — Read This Before Deploying

Redivue is a **local admin/dev tool**, not a multi-tenant service. It is designed to be run on
your own machine (or a trusted internal network) to manage Redis instances you already control.
It has no concept of "users" of its own.

**No application-level authentication.** There is no login screen and no API key on
`/api/redis/**` — every endpoint is reachable by anyone who can reach the port. This is
intentional (same trust model as `redis-cli` or RedisInsight run locally), not an oversight:
you supply your own Redis credentials per-connection, and Redis's own auth (PASSWORD/ACL) is
what actually gates access to your data.

**Do not expose Redivue's port to an untrusted network.** Anyone who can reach it can:
- Connect to and run arbitrary commands (including `FLUSHALL`, `CONFIG SET`, etc.) against
  **any host:port they choose** via the CLI Console and connection endpoints — Redivue will
  happily act as an open pivot into whatever TCP services are reachable from the server it
  runs on.
- Read/write the local export/import file store (`java.io.tmpdir/redivue-exports`).

If you need shared or remote access, put Redivue behind a reverse proxy that adds its own
authentication (HTTP basic auth, an OAuth proxy, a VPN, etc.) — do not rely on anything in this
app for that. Binding to `127.0.0.1` only (not `0.0.0.0`) is the simplest safe default for a
single-user local install.

## Known Limitations (by design, not bugs)

- **Connection passwords are obfuscated, not encrypted.** The frontend stores saved connections
  (including passwords) in browser `localStorage` using XOR + base64. This is **trivially
  reversible** — it deters casual shoulder-surfing (e.g. someone glancing at exported JSON) but
  provides no real protection against anyone with access to the browser profile or DevTools.
  Treat `localStorage` on the machine you run Redivue in as equivalent in sensitivity to a
  plaintext credentials file.
- **The CLI Console runs whatever command you type**, with no allow-list — this is the entire
  point of the feature (a `redis-cli` replacement), not a vulnerability. Dangerous commands
  (`FLUSHDB`, `FLUSHALL`, `SHUTDOWN`, `SCRIPT FLUSH`) require confirming twice in the UI, but the
  backend does not block anything server-side.
- **TLS/mTLS client certificates**: the PEM-encoded client key you paste into the connection form
  is written to a short-lived OS temp file (owner-read/write permissions only) so Lettuce can
  load it, then deleted when the JVM exits. On a shared multi-user host, another local user could
  in principle still race to read it before the process exits; don't run Redivue as a shared
  service on a multi-tenant box with other untrusted local users.
- **SSH Tunnel password auth** only works against servers offering plain "password" SSH auth.
  Most PAM-based `sshd` setups (Ubuntu/Debian defaults) offer "keyboard-interactive" instead,
  which isn't supported — use key-based auth, which is also the generally more secure option.
- **Sentinel node password** isn't configurable (a Lettuce `RedisURI.Builder` limitation) —
  only the Redis master's own password is used.
- **Export/import file IDs** are validated as UUIDs server-side specifically to prevent path
  traversal through the export directory; this was fixed in code, not just documented — flagging
  it here so it isn't silently re-broken by a future patch that starts trusting `fileId` again.

## Auth Type Notes

| Auth Type | Notes |
|---|---|
| PASSWORD | Standard `requirepass`. Sent over the connection you configure (plain TCP unless TLS is enabled). |
| USERNAME_PASSWORD (ACL) | Redis 6+ ACL user. Scope the ACL user's permissions in Redis itself — Redivue doesn't restrict what an authenticated connection can do. |
| URL | Full `redis://`/`rediss://` URI — credentials embedded in the URL are stored the same way as PASSWORD (obfuscated in localStorage, not encrypted). |
| SENTINEL | See Sentinel limitation above. |
| CLUSTER | Per-node auth via the cluster client; same password caveats apply. |
| SOCKET | Unix domain socket — no network exposure by definition, generally the safest local option. |

## Recommended Deployment Checklist

- Bind to `127.0.0.1` unless you've deliberately put an authenticating reverse proxy in front.
- Don't commit real connection passwords into an exported connections JSON file that lands in
  version control — the export feature strips secrets by default; keep it that way unless you
  have a specific reason to opt into "Include passwords & secrets".
- Keep Redis itself behind `requirepass`/ACLs — Redivue is a client, not a substitute for Redis's
  own access control.
- Only use self-signed certs / throwaway credentials against Redis instances you spin up for
  local testing — never against anything you'd call production.
