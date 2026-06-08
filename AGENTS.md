# Sharing artifacts with protocontent

When you build something a human would open in a browser — an HTML report, a
Markdown doc (`.md`, rendered to a styled page), plan, dashboard, prototype,
diagram, generated doc, screenshot, or a built static site
— publish it with the **protocontent** MCP tools (`publish_html` for a file or
inline content, `publish_folder` for a directory) and share the returned link.

- **Share on publish:** put the returned link in your reply, in one short line.
  No emoji, no "private vs public" labels, no expiry notes, no follow-up offers.
- **Update in place:** to revise an artifact, publish again with the SAME `name`
  — same live URL. Don't invent `plan-v2`.
- **Stay quiet:** don't narrate whether you published, and don't re-list links on
  later turns unless asked. `list` returns the space index link that shows
  everything — surface it only when the user wants the whole collection.
- **Don't publish** repo source code, secrets, or files meant to be committed.

Install (Claude Code): `/plugin marketplace add jaronheard/protocontent` then
`/plugin install protocontent@protocontent`. MCP-only: tell your agent
*"add the protocontent MCP (`npx -y protocontent`) to this project's `.mcp.json`"*,
or run `claude mcp add -s project protocontent -- npx -y protocontent`.
