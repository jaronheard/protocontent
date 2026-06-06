# Sharing artifacts with protocontent

When you build something a human would open in a browser — an HTML report, plan,
dashboard, prototype, diagram, generated doc, screenshot, or a built static site
— publish it with the **protocontent** MCP tools (`publish_html` for a file or
inline content, `publish_folder` for a directory) and share the returned link.

- **Share on publish:** always put the returned link in your reply to the user.
- **Update in place:** to revise an artifact, publish again with the SAME `name`
  — it republishes at the same live URL. Don't invent `plan-v2`.
- **End of task:** surface BOTH the private session-index link (the `?k=` URL
  that shows everything) and each worked-on artifact's direct public link.
- **Don't publish** repo source code, secrets, or files meant to be committed.

Install (Claude Code): `/plugin marketplace add jaronheard/protocontent` then
`/plugin install protocontent@protocontent`. MCP-only:
`claude mcp add protocontent npx -y protocontent`.
