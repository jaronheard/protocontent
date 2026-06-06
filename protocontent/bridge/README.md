# protocontent

A co-located **stdio MCP server** that lets a coding agent publish local files to
[protocontent](https://protocontent.com) and get back a tappable, live-updating URL.

Because no MCP primitive lets a remote server read the client's disk (and Claude
Code doesn't echo the HTTP `Mcp-Session-Id`), protocontent runs as a tiny bridge
*next to the agent* — on your laptop or on a cloud agent VM. It reads the files you
want to publish from the local filesystem and uploads them to the protocontent HTTP
API, while holding a stable per-thread "space" id in memory.

Zero-config: on first run it mints an anonymous project token and caches it to
`~/.protocontent/config.json`.

## Install / add to your agent

It runs straight from npx — no global install needed.

### Claude Code

```bash
claude mcp add protocontent -- npx -y protocontent
```

To pass through a token or a custom API base:

```bash
claude mcp add protocontent \
  --env PROTOCONTENT_TOKEN=pc_live_xxx \
  --env PROTOCONTENT_API=https://api.protocontent.com \
  -- npx -y protocontent
```

### Raw MCP server JSON config

For any client that takes an MCP server config block (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "protocontent": {
      "command": "npx",
      "args": ["-y", "protocontent"],
      "env": {
        "PROTOCONTENT_TOKEN": "pc_live_xxx",
        "PROTOCONTENT_API": "https://api.protocontent.com"
      }
    }
  }
}
```

Both `env` entries are optional. Omit `PROTOCONTENT_TOKEN` to use a cached or
freshly-minted anonymous token; omit `PROTOCONTENT_API` to use the default
(`https://api.protocontent.com`).

This works exactly the same on a **cloud agent VM** — the bridge just needs to run in
the same place the files live, with network access to the protocontent API.

## Configuration

| Env var               | Default                          | Purpose                                                        |
| --------------------- | -------------------------------- | -------------------------------------------------------------- |
| `PROTOCONTENT_API`    | `https://api.protocontent.com`   | Base URL of the protocontent HTTP API.                         |
| `PROTOCONTENT_TOKEN`  | _(cached / minted)_              | Bearer token. Falls back to `~/.protocontent/config.json`, then to a freshly-minted anonymous project token. |
| `CLAUDE_SESSION_ID`   | _(unset → random)_               | When set, deterministically seeds this process's space id so it lines up with the agent thread. |

### Spaces

Each running bridge process owns one **space** — a DNS-safe id like
`amber-canyon-7f3` — generated once at startup and held in memory for the process
lifetime. When `CLAUDE_SESSION_ID` is present the id is derived deterministically
from it; otherwise it's random. A `spaceLabel` is derived from the current working
directory's basename. Everything you publish in a session lands in the same space,
served at `https://<spaceId>.protocontent.app`, which updates live.

### Keeping artifacts out of git

protocontent artifacts are **ephemeral** — you publish them to a URL, you don't
commit them. On startup the bridge makes a best-effort, idempotent check: if it's
running inside a git repo, it ensures `.protocontent/` is in your `.gitignore`.
Stage anything you publish under `.protocontent/` and it stays out of version
control automatically. Opt out with `PROTOCONTENT_NO_GITIGNORE=1`.

## Tools

| Tool             | Arguments                                  | What it does                                                                 |
| ---------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| `publish_html`   | `{ path?, content?, name?, ttl? }`         | Publish a single file (`path`) or inline `content` — exactly one of them.    |
| `publish_folder` | `{ dir, entry?, name?, ttl? }`             | Recursively publish a directory (skips `node_modules`, `.git`, dotfiles).    |
| `list`           | `{}`                                        | List artifacts in this space with URLs and versions.                        |
| `history`        | `{ name }`                                  | Show an artifact's version history.                                         |
| `unpublish`      | `{ name }`                                  | Stop an artifact's URL from serving content.                               |
| `keep`           | `{ name }`                                  | Remove the expiry so an artifact is kept permanently.                       |

Every publish returns a tappable markdown link, the live space URL, and the direct
artifact URL.

## Develop

```bash
npm install
npm run build      # tsc -> dist/
node dist/index.js # run the stdio server directly (it talks MCP over stdio)
```

Requires Node 18+ (uses the built-in global `fetch`).

## License

MIT
