# Hello, World! 👋

Welcome to a **test Markdown file** published with [protocontent](https://github.com/jaronheard/protocontent) — the missing _publish & share_ verb for your coding agent. This page exists to show off how Markdown gets rendered into a clean, readable page.

> "Your agent already writes files. protocontent is the same primitive — _write a file_ — except it lands at a URL instead of in your repo."

---

## Text formatting

You can write **bold**, _italic_, **_bold italic_**, ~~strikethrough~~, and `inline code`. You can even combine them: a `const greeting = "hi"` here, **bold with `code`** there.

Footnotes work too.[^1]

[^1]: This is a footnote — handy for asides without breaking your reading flow.

## Links

- A plain link: [protocontent on npm](https://www.npmjs.com/package/protocontent)
- A reference-style link: [the original blog post][html-post]
- An autolink: <https://protocontent.app>
- A relative link to a sibling doc: [README](../README.md)

[html-post]: https://claude.com/blog/using-claude-code-the-unreasonable-effectiveness-of-html

## Lists

### Unordered

- Plans
- Prototypes
- Dashboards
  - Nested item one
  - Nested item two
- Generated images

### Ordered

1. Write a file
2. Publish it to a URL
3. Share the link
4. Watch it update live

### Task list

- [x] Create a markdown file
- [x] Add varied formatting
- [ ] Touch grass

## Code blocks

Inline: run `npx -y protocontent` to start the bridge.

```bash
# Add the protocontent MCP to a project
claude mcp add -s project protocontent -- npx -y protocontent
```

```javascript
// A tiny greeting
function hello(name = "world") {
  return `Hello, ${name}!`;
}

console.log(hello("protocontent"));
```

```python
# The same idea, in Python
def hello(name="world"):
    return f"Hello, {name}!"

print(hello("protocontent"))
```

## Table

| Format    | Syntax            | Renders as        |
| --------- | ----------------- | ----------------- |
| Bold      | `**text**`        | **text**          |
| Italic    | `_text_`          | _text_            |
| Code      | `` `text` ``      | `text`            |
| Strike    | `~~text~~`        | ~~text~~          |
| Link      | `[text](url)`     | [text](https://example.com) |

## Blockquote with nesting

> Top-level quote.
>
> > A nested quote inside it.
> >
> > — someone, probably

## Images

![A scenic placeholder](https://placehold.co/600x200/png?text=Hello+protocontent)

## Horizontal rule

Above this line is content. Below it, more content.

---

## A bit of everything

Here's a paragraph that mixes a [link](https://protocontent.app), some **emphasis**, a touch of `code`, and a trailing emoji to round things out. ✨

That's the tour — if you can read this on a styled page, Markdown rendering is working. 🎉
