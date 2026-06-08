# protocontent

**Your agent makes a file. You get a link.** Add protocontent to your coding agent, and every artifact it makes — a plan, an HTML prototype, a formatted brief, a mockup, a diagram — lands at a live, shareable, sandboxed URL the instant the file is written. Markdown renders as a styled page, HTML as you built it — not raw text in a diff viewer. Outside version control, never staged, never committed. Your laptop, your phone, anywhere.

Your agent already writes files. protocontent is the same primitive — _write a file_ — except it lands at a URL instead of in your repo. It's the home for everything an agent produces that isn't meant to be committed: plans, prototypes, dashboards, screenshots, generated images. HTML first (it's the richest format), content-agnostic by design. **Markdown (`.md`) files are rendered to a styled, readable page** instead of served as raw text.

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

Tell your coding agent:

> Add the protocontent MCP (`npx -y protocontent`) to this project's `.mcp.json`

That lands a project-scoped `.mcp.json` at the repo root. Commit it, and **every session that opens the repo gets the MCP** — your local agent, a teammate's checkout, and remote runs (e.g. Claude Code on the web) that clone the repo fresh. Per-machine MCP config doesn't travel; a committed `.mcp.json` does.

Prefer to run it by hand?

```bash
claude mcp add -s project protocontent -- npx -y protocontent   # this repo (committed, travels)
claude mcp add protocontent -- npx -y protocontent              # just this machine
```

…or add `npx -y protocontent` as a stdio MCP server in your agent's config. Zero config — it mints an anonymous project on first run and gives back a tappable link plus a live session URL.

Artifacts are **ephemeral** — published to a URL, not committed. The bridge keeps them out of git for you: on startup, if it's inside a git repo, it ensures `.protocontent/` is in your `.gitignore` (idempotent; opt out with `PROTOCONTENT_NO_GITIGNORE=1`). Stage anything you publish under `.protocontent/`.

## Use it in Claude Code (plugin)

For Claude Code, install the **plugin** — it bundles the MCP server plus a
`publishing-artifacts` skill and a conservative Stop hook, so your agent publishes
the right artifacts, shares the link on every publish, updates in place (same
`name` → same URL), and ends with **both** the session-index and per-artifact links:

```
/plugin marketplace add jaronheard/protocontent
/plugin install protocontent@protocontent
```

The Stop hook is fail-open and nudges at most once per turn; disable it with
`PROTOCONTENT_DISABLE_STOP_HOOK=1`. For non-Claude agents (Cursor, Codex, Aider, …),
copy the snippet in [`AGENTS.md`](AGENTS.md) into your project.

## Repo layout

```
protocontent/          Cloudflare Worker — src/, wrangler.jsonc, schema.sql
protocontent/bridge/   the npx stdio MCP bridge (published to npm as `protocontent`)
plugin/                Claude Code plugin — MCP + publishing-artifacts skill + Stop hook
AGENTS.md              portable "publish & share" snippet for non-Claude agents
*.html                 design docs (also live on protocontent.app)
```

## Self-host / deploy

See [`protocontent/README.md`](protocontent/README.md). In short: a Cloudflare account + `wrangler login`, create the R2 bucket and D1 database, apply `schema.sql`, add a proxied wildcard DNS record, then `wrangler deploy`.

## Status

Deployed on Cloudflare · bridge published to npm as [`protocontent`](https://www.npmjs.com/package/protocontent) · MIT licensed.

## License

MIT © Jaron Heard
