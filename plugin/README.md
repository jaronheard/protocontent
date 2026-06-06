# protocontent — Claude Code plugin

Bundles everything an agent needs to publish browser-openable artifacts to
[protocontent](https://protocontent.com) and reliably share their live links:

- **MCP server** (`npx -y protocontent`) — the `publish_html`, `publish_folder`,
  `list`, `history`, `keep`, `unpublish` tools.
- **Skill** `publishing-artifacts` — when/what to publish, the same-name
  update-in-place rule, and the dual-link (index + per-artifact) end-of-task format.
- **Stop hook** — a conservative, fail-open nudge: if you published this turn but
  didn't share a link, it asks once for the index + artifact links. Disable with
  `PROTOCONTENT_DISABLE_STOP_HOOK=1`.

## Install

```
/plugin marketplace add jaronheard/protocontent
/plugin install protocontent@protocontent
```

## Layers, by who controls execution

Reliability tracks who controls execution — the model (probabilistic) vs. the
harness (deterministic). Each critical behavior is covered by both a smart layer
(MCP instructions + skill judgment) and a deterministic one (the Stop hook).
