---
name: publishing-artifacts
description: >-
  Publish shareable HTML artifacts to protocontent and share their live links.
  Use whenever you create or update a self-contained, browser-openable artifact —
  an HTML report, plan, dashboard, prototype, diagram, generated doc, screenshot,
  or built static site — or when the user asks to share/publish/send a link to
  something you made. Also use at the end of a task to surface all published links.
---

# Publishing artifacts with protocontent

protocontent turns a local file or folder into a tappable, live-updating URL.
Each agent thread is one persistent "space"; everything you publish lands there
and the space page updates in real time as you republish.

## When to publish (and when not to)

**Publish:** HTML reports / plans / specs, dashboards, prototypes, generated
docs, charts/diagrams, screenshots, a built static site (a folder).

**Do NOT publish:** repo source code, anything meant to be committed, secrets,
or large binaries. When unsure, publish a *rendered report* view, not raw code.

## The workflow (every time)

1. **Publish** via `protocontent:publish_html` (a single file or inline content)
   or `protocontent:publish_folder` (a directory). Pick a stable, descriptive
   `name` (e.g. `auth-redesign-plan`).
2. **Share immediately:** put the returned markdown link in your reply to the user.
3. **Iterate = update in place:** when you revise, publish again with the SAME
   `name` — same URL, live update. Never mint `plan-v2` / `plan-final`. Use
   `keep` to persist an artifact past its default expiry.

## End-of-task summary (always BOTH kinds of link)

When you've published anything, end your turn with a **Published** section,
sourced from `protocontent:list`:

```
**Published**
- Session index (private, shows everything): <space ?k= link>
- <artifact-name>: <direct public link>
```

The session-index link is **private** (token-gated, `?k=`); the per-artifact
links are **public**. Label which is which so the user shares deliberately.
