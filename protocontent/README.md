# protocontent

A Cloudflare Worker that lets coding agents publish files (HTML, folders) to per-session URLs, with live-updating session index pages and a remote MCP fallback.

One Worker serves three hostnames, dispatched by the request `Host` header:

| Host | Purpose |
| --- | --- |
| `api.protocontent.com` | Control API (bearer auth). The bridge calls this. |
| `mcp.protocontent.com` | Remote MCP endpoint (Streamable HTTP, fallback). |
| `*.protocontent.com` | Public content serving — the subdomain label **is** the `spaceId`. |

Stack: **Workers + R2 + D1 + Durable Objects + Cron Triggers**, plus the Cloudflare **Agents SDK** (`agents` / `McpAgent`) for the remote MCP endpoint.

---

## Manual Cloudflare steps (one-time)

These three steps require a human and cannot be scripted:

1. **Create a Cloudflare account** at <https://dash.cloudflare.com/sign-up>.
2. **Add the `protocontent.com` zone to Cloudflare** and **update your registrar's nameservers** to the ones Cloudflare assigns. The wildcard subdomain serving (`*.protocontent.com`) requires the zone to be active on Cloudflare.
3. **Authenticate Wrangler** locally:
   ```sh
   wrangler login
   ```

---

## Resource setup

From this directory (`protocontent/`):

```sh
# 1. Install dependencies.
npm install

# 2. Create the R2 bucket for blob storage.
wrangler r2 bucket create protocontent-blobs

# 3. Create the D1 database, then paste the returned database_id into
#    wrangler.jsonc (the "database_id" field, currently a placeholder).
wrangler d1 create protocontent

# 4. Apply the schema to the remote D1 database.
wrangler d1 execute protocontent --remote --file=schema.sql

# 5. Deploy the Worker.
wrangler deploy
```

### Custom Domains / routes

After the zone is active, add the three hostnames so they all route to this one
Worker. The easiest path is **Workers & Pages → your Worker → Settings → Domains
& Routes → Add Custom Domain** for each of:

- `api.protocontent.com`
- `mcp.protocontent.com`
- `*.protocontent.com`  — the **wildcard**. This requires the zone on Cloudflare
  plus a wildcard route or wildcard Custom Domain. It is what makes
  `<spaceId>.protocontent.com` resolve to the Worker for public content.

Alternatively, uncomment and fill in the `routes` block in `wrangler.jsonc`.

> Note: wildcard subdomain serving only works because the zone is on Cloudflare
> and a wildcard route/custom domain is configured. Without it, individual space
> subdomains will not resolve.

---

## What to fill in before deploy

- `wrangler.jsonc` → `d1_databases[0].database_id` — paste the id from
  `wrangler d1 create protocontent`.
- The three Custom Domains / routes (above).

---

## HTTP API (host = `api.protocontent.com`)

All endpoints are JSON. Auth is `Authorization: Bearer <token>` except project minting.
Only the SHA-256 hash of each token is stored in D1.

| Method & path | Auth | Description |
| --- | --- | --- |
| `POST /v1/projects` | no | Mint an anonymous project + token → `{ token, projectId }`. |
| `POST /v1/publish` | yes | Publish files to a space. Returns `{ url, spaceUrl, markdown, editToken, expiresAt, version }`. |
| `GET /v1/spaces/:spaceId/list` | yes | `{ artifacts:[{name,url,expiresAt,version}] }`. |
| `GET /v1/spaces/:spaceId/artifacts/:name/history` | yes | `{ versions:[{version,at,url}] }`. |
| `POST /v1/spaces/:spaceId/artifacts/:name/unpublish` | yes | Delete rows + R2 objects → `{ ok:true }`. |
| `POST /v1/spaces/:spaceId/artifacts/:name/keep` | yes | Clear expiry → `{ expiresAt:null }`. |

`/v1/publish` body:

```jsonc
{
  "spaceId": "abc123",          // optional; generated if omitted
  "spaceLabel": "My session",   // optional display label
  "name": "dashboard",          // artifact name (slugified to a path segment)
  "entry": "index.html",        // optional; defaults to index.html for folders
  "ttl": "7d",                  // 1h|6h|1d|3d|7d|30d, default 7d
  "files": [
    { "relPath": "index.html", "contentBase64": "...", "contentType": "text/html" }
  ]
}
```

Single file → `files` length 1. Folder → many files; `entry` selects the page
served at `/:name`.

---

## Content serving (host = `*.protocontent.com`, label = spaceId)

- `GET /` — first-party **live session index page**. Lists artifacts and opens a
  WebSocket to `wss://<host>/__live`; on any message it re-fetches `GET /__list`
  and re-renders. `X-Robots-Tag: noindex`.
- `GET /__list` — JSON `{ artifacts:[{name,url,updatedAt}] }`.
- `GET /__live` — WebSocket upgrade, routed to the `Space` Durable Object.
- `GET /:name` and `GET /:name/*assets` — serve file bytes from R2 (latest
  version, or `?v=` for a specific one). Untrusted-content responses carry a
  restrictive `Content-Security-Policy` header, `X-Content-Type-Options: nosniff`,
  and `X-Robots-Tag: noindex`.
- Unknown → `404`; expired → `410`.

---

## Remote MCP (host = `mcp.protocontent.com`) — fallback, degraded

Uses `McpAgent.serve()` (Streamable HTTP). **Not** `serveSSE()` (cloudflare/agents#660:
SSE doesn't propagate the session id/headers). The MCP session maps to one space.

Tools (inline content only — no local file reading): `publish_html`, `list`,
`history`, `unpublish`, `keep`. Connect at `https://mcp.protocontent.com/mcp`.

---

## Architecture notes

- **Serving is stateless** in the Worker (R2 + D1). The `Space` Durable Object
  does **live WebSocket fanout only** — it broadcasts `{"type":"changed"}` to
  connected viewers when the publish path POSTs `/notify` to it.
- **Cron** (`0 * * * *`) runs `scheduled`, which deletes expired artifacts, their
  file rows, and their R2 objects.
- The `bridge/` subdirectory is a separate component and is not part of this
  Worker build.
