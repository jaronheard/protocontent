# protocontent

**Publish the HTML (and other files) your coding agent makes to a shareable, sandboxed URL — and watch a whole session's artifacts on one live page, from any device.**

Your agent already writes files. protocontent is the same primitive — _write a file_ — except it lands at a URL instead of in your repo. It's the home for everything an agent produces that isn't meant to be committed: plans, prototypes, dashboards, screenshots, generated images. HTML first (it's the richest format), content-agnostic by design.

Built because [Thariq Shihipar's "The Unreasonable Effectiveness of HTML"](https://claude.com/blog/using-claude-code-the-unreasonable-effectiveness-of-html) nails _generate HTML_ but leaves "upload it somewhere and share the link" as a manual gap. **protocontent is that missing verb.**

## See it live

The design docs are hosted on protocontent itself (dogfooding):

- 📂 **Session page:** https://protocontent-plans-vd7.protocontent.app/
- 📐 [Architecture plan](https://protocontent-plans-vd7.protocontent.app/architecture-plan.html)
- 📋 [Product spec](https://protocontent-plans-vd7.protocontent.app/product-spec.html)
- 🗺️ [Roadmap / next steps](https://protocontent-plans-vd7.protocontent.app/next-steps.html)

## How it works

- An **`npx protocontent` stdio MCP bridge** runs alongside your agent (laptop _or_ cloud VM), reads a file/folder path, and uploads the bytes.
- A **Cloudflare Worker** stores it (R2 blobs + D1 metadata) and serves it on a per-session subdomain of the isolated content domain `*.protocontent.app`.
- A **Durable Object** pushes live updates over WebSocket, so the session page refreshes the moment the agent publishes.
- The control plane (`api.` / `mcp.protocontent.com`) is a **separate registrable domain** from content (`*.protocontent.app`) — so untrusted agent HTML can't touch your session or cookies.

Tools: `publish_html`, `publish_folder`, `list`, `history`, `keep`, `unpublish`.

## Install (any MCP agent)

```bash
claude mcp add protocontent -- npx -y protocontent
```

…or add `npx -y protocontent` as a stdio MCP server in your agent's config. Zero config — it mints an anonymous project on first run and gives back a tappable link plus a live session URL.

## Repo layout

```
protocontent/          Cloudflare Worker — src/, wrangler.jsonc, schema.sql
protocontent/bridge/   the npx stdio MCP bridge (published to npm as `protocontent`)
*.html                 design docs (also live on protocontent.app)
```

## Self-host / deploy

See [`protocontent/README.md`](protocontent/README.md). In short: a Cloudflare account + `wrangler login`, create the R2 bucket and D1 database, apply `schema.sql`, add a proxied wildcard DNS record, then `wrangler deploy`.

## Status

Deployed on Cloudflare · bridge published to npm as [`protocontent`](https://www.npmjs.com/package/protocontent) · MIT licensed.

## License

MIT © Jaron Heard
