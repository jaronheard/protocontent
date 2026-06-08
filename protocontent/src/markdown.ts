// Server-side Markdown → HTML rendering for served `.md` artifacts.
//
// protocontent serves artifact bytes byte-for-byte (see serve.ts) and is
// otherwise format-agnostic: the browser renders whatever the Content-Type
// says. Markdown is the one common agent output the browser CANNOT render —
// `text/markdown` shows up as a wall of plain text. So when a served file is
// Markdown, serve.ts hands the source here and serves the returned HTML
// document instead (still under the artifact's sandbox CSP, opaque origin).
//
// SECURITY: this renderer is HTML-safe by construction. Every byte of source
// is HTML-escaped before any markup is emitted, and we NEVER pass raw inline
// HTML through. The artifact CSP allows `'unsafe-inline'` scripts from the
// artifact origin, so letting Markdown smuggle a `<script>` through would run
// it (sandboxed, but still). Escaping everything closes that door. Link/image
// URLs are scheme-filtered too (no `javascript:` / unknown schemes).
//
// The parser is intentionally small and dependency-free — it covers the
// CommonMark/GFM subset agents actually produce (headings, emphasis, code,
// lists, blockquotes, tables, rules, links/images, reference-style links, and
// footnotes), not every edge of the spec.

import { BRAND_BASE_CSS, FAVICON } from "./brand";

/** True when a Content-Type denotes Markdown (e.g. `text/markdown; charset=…`). */
export function isMarkdownContentType(contentType: string): boolean {
  return /^text\/(x-)?markdown\b/i.test(contentType);
}

/**
 * Render a full, self-contained HTML document for a Markdown source string.
 * `title` is used for the <title> (escaped); it's the artifact/file name.
 */
export function renderMarkdownDocument(source: string, title: string): string {
  const body = renderMarkdown(source);
  const safeTitle = escapeHtml(title || "Markdown");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${safeTitle}</title>
${FAVICON}
<style>${BRAND_BASE_CSS}${MARKDOWN_CSS}</style>
</head>
<body>
<main class="md glass">
${body}
</main>
</body>
</html>`;
}

// Markdown-specific typography, layered on top of BRAND_BASE_CSS so a rendered
// `.md` file feels like the same product as the index/landing pages.
const MARKDOWN_CSS = `
body{padding:24px 16px 64px;}
.md{
  max-width:780px;margin:0 auto;padding:clamp(22px,4vw,48px);
  font-size:16px;line-height:1.7;color:var(--ink);
  overflow-wrap:break-word;word-wrap:break-word;
}
.md > :first-child{margin-top:0;}
.md > :last-child{margin-bottom:0;}
.md h1,.md h2,.md h3,.md h4,.md h5,.md h6{
  line-height:1.25;font-weight:700;letter-spacing:-.01em;color:var(--ink);
  margin:1.6em 0 .6em;
}
.md h1{font-size:1.9em;letter-spacing:-.02em;}
.md h2{font-size:1.5em;padding-bottom:.3em;border-bottom:1px solid var(--edge);}
.md h3{font-size:1.25em;}
.md h4{font-size:1.05em;}
.md h5{font-size:.95em;color:var(--ink-soft);}
.md h6{font-size:.9em;color:var(--ink-faint);}
.md p{margin:0 0 1em;}
.md a{color:#0c7a73;font-weight:500;}
.md strong{font-weight:700;}
.md ul,.md ol{margin:0 0 1em;padding-left:1.6em;}
.md li{margin:.25em 0;}
.md li > ul,.md li > ol{margin:.25em 0;}
.md blockquote{
  margin:0 0 1em;padding:.4em 1.1em;color:var(--ink-soft);
  border-left:3px solid var(--aurora-1);
  background:rgba(255,255,255,.4);border-radius:0 10px 10px 0;
}
.md blockquote > :last-child{margin-bottom:0;}
.md hr{
  border:0;height:1px;margin:2em 0;
  background:linear-gradient(90deg,transparent,var(--edge),transparent);
}
.md code{
  font-family:var(--mono);font-size:.88em;
  background:rgba(15,43,42,.07);padding:.15em .4em;border-radius:6px;
}
.md pre{
  margin:0 0 1em;padding:14px 16px;overflow:auto;
  background:rgba(15,43,42,.05);border:1px solid var(--edge);border-radius:12px;
  line-height:1.55;
}
.md pre code{background:none;padding:0;font-size:.86em;}
.md img{max-width:100%;height:auto;border-radius:10px;}
.md table{
  border-collapse:collapse;margin:0 0 1em;width:100%;
  font-size:.95em;overflow:hidden;border-radius:10px;
  box-shadow:0 0 0 1px var(--edge);
}
.md th,.md td{padding:.5em .8em;text-align:left;border-bottom:1px solid var(--edge);}
.md th{font-weight:700;background:rgba(255,255,255,.5);}
.md tr:last-child td{border-bottom:0;}
.md del{color:var(--ink-faint);}
.md .task{list-style:none;margin-left:-1.4em;}
.md .task input{margin-right:.5em;}
.md sup.footnote-ref{font-size:.72em;line-height:0;white-space:nowrap;}
.md sup.footnote-ref a{font-weight:600;}
.md .footnotes{margin-top:2.6em;font-size:.9em;color:var(--ink-soft);}
.md .footnotes hr{margin:0 0 1.2em;}
.md .footnotes ol{padding-left:1.4em;}
.md .footnotes li{margin:.4em 0;}
.md .footnote-back{margin-left:.35em;font-weight:600;text-decoration:none;}
`;

// ---------------------------------------------------------------------------
// Block-level parser
// ---------------------------------------------------------------------------

/** Render a Markdown source string to a safe HTML fragment (no <html>/<body>). */
export function renderMarkdown(source: string): string {
  // Strip a leading UTF-8 BOM (common from Windows editors) so the first line
  // isn't prefixed with U+FEFF — which would otherwise defeat the heading /
  // list / fence checks. Normalize CRLF/CR to LF as well.
  // Reset per-render state, then lift link/footnote definitions out of the
  // source before block parsing so references can resolve against them.
  linkRefs = new Map();
  footnoteDefs = new Map();
  footnoteOrder = [];
  footnoteRefCounts = new Map();
  const rawLines = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const lines = extractDefinitions(rawLines);
  const body = parseBlocks(lines, 0, lines.length).html;
  return body + renderFootnotes();
}

interface BlockResult {
  html: string;
}

interface LinkRef {
  url: string;
  title?: string;
}

// Per-render parse state for link reference definitions and footnotes. It's
// safe to keep this at module scope: `renderMarkdown` runs synchronously to
// completion within a single JS isolate (no `await`), so renders never
// interleave. Each call resets all three before parsing.
let linkRefs = new Map<string, LinkRef>();
let footnoteDefs = new Map<string, string>();
let footnoteOrder: string[] = []; // footnote ids, in order of first reference
let footnoteRefCounts = new Map<string, number>(); // times each id is referenced

/**
 * Pull link reference definitions (`[label]: url "title"`) and footnote
 * definitions (`[^id]: text`) out of the source and into the shared maps,
 * returning the remaining lines for the block parser. Definitions inside fenced
 * code blocks are left untouched so code samples render verbatim.
 */
function extractDefinitions(lines: string[]): string[] {
  const out: string[] = [];
  let fenceMarker: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track fenced code regions so `[x]: …` lines inside code aren't stripped.
    const fence = line.match(/^\s{0,3}(```+|~~~+)/);
    if (fence) {
      const marker = fence[1][0];
      if (fenceMarker === null) fenceMarker = marker;
      else if (fenceMarker === marker && /^\s{0,3}(```+|~~~+)\s*$/.test(line)) fenceMarker = null;
      out.push(line);
      continue;
    }
    if (fenceMarker !== null) {
      out.push(line);
      continue;
    }

    // Footnote definition: `[^id]: text`, with indented continuation lines.
    // Checked before link definitions because `[^id]:` also matches as a label.
    const fn = line.match(/^\s{0,3}\[\^([^\]]+)\]:\s?(.*)$/);
    if (fn) {
      const id = fn[1].trim();
      const parts = [fn[2]];
      while (i + 1 < lines.length && lines[i + 1].trim() !== "" && /^\s{2,}\S/.test(lines[i + 1])) {
        parts.push(lines[i + 1].replace(/^\s+/, ""));
        i++;
      }
      if (!footnoteDefs.has(id)) footnoteDefs.set(id, parts.join("\n").trim());
      continue;
    }

    // Link reference definition: `[label]: url` with an optional title. The
    // first char of the label can't be `^` (that's a footnote, handled above).
    const ref = line.match(
      /^\s{0,3}\[([^\]^][^\]]*)\]:\s*(\S+)(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*$/,
    );
    if (ref) {
      const label = normalizeLabel(ref[1]);
      if (label && !linkRefs.has(label)) {
        linkRefs.set(label, { url: ref[2], title: ref[3] ?? ref[4] ?? ref[5] });
      }
      continue;
    }

    out.push(line);
  }

  return out;
}

/** Normalize a reference label for case/whitespace-insensitive matching. */
function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Sanitize a footnote id for safe use in `id`/`href` attributes. */
function footnoteSlug(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "fn";
}

/**
 * Render the collected footnote definitions as an ordered list at the foot of
 * the document, numbered by order of first reference (GFM). Returns "" when no
 * footnotes were referenced.
 */
function renderFootnotes(): string {
  if (footnoteOrder.length === 0) return "";
  // Snapshot the order: inline() below could, in pathological cases, reference
  // further footnotes; we render only those known when the body finished.
  const items = [...footnoteOrder].map((id) => {
    const slug = footnoteSlug(id);
    const body = inline(footnoteDefs.get(id) ?? "");
    // One back-arrow per reference site; number them when there's more than one.
    const count = footnoteRefCounts.get(id) ?? 1;
    const backs: string[] = [];
    for (let n = 1; n <= count; n++) {
      const refId = n === 1 ? `fnref-${slug}` : `fnref-${slug}-${n}`;
      const label = count === 1 ? "↩" : `↩<sup>${n}</sup>`;
      backs.push(`<a href="#${refId}" class="footnote-back" aria-label="Back to content">${label}</a>`);
    }
    return `<li id="fn-${slug}">${body} ${backs.join(" ")}</li>`;
  });
  return `\n<section class="footnotes">\n<hr>\n<ol>\n${items.join("\n")}\n</ol>\n</section>`;
}

/** Parse the block-level structure of `lines[start..end)`. */
function parseBlocks(lines: string[], start: number, end: number): BlockResult {
  const out: string[] = [];
  let i = start;

  while (i < end) {
    const line = lines[i];

    // Blank line — block separator.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block (``` or ~~~), preserving content verbatim (escaped).
    const fence = line.match(/^(\s{0,3})(```+|~~~+)\s*([^`]*)$/);
    if (fence) {
      const marker = fence[2][0];
      const lang = fence[3].trim().split(/\s+/)[0] || "";
      const buf: string[] = [];
      i++;
      while (i < end) {
        const close = lines[i].match(/^\s{0,3}(```+|~~~+)\s*$/);
        if (close && close[1][0] === marker) {
          i++;
          break;
        }
        buf.push(lines[i]);
        i++;
      }
      const cls = lang ? ` class="language-${escapeAttr(lang)}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // ATX heading (# .. ######).
    const heading = line.match(/^(\s{0,3})(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const level = heading[2].length;
      out.push(`<h${level}>${inline(heading[3])}</h${level}>`);
      i++;
      continue;
    }

    // Thematic break (---, ***, ___).
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // Blockquote — collect the contiguous `>` region and recurse on its body.
    if (/^\s{0,3}>/.test(line)) {
      const buf: string[] = [];
      while (i < end && /^\s{0,3}>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        i++;
      }
      const inner = parseBlocks(buf, 0, buf.length).html;
      out.push(`<blockquote>${inner}</blockquote>`);
      continue;
    }

    // List (ordered or unordered), possibly nested.
    if (isListItem(line)) {
      const consumed = parseList(lines, i, end);
      out.push(consumed.html);
      i = consumed.next;
      continue;
    }

    // Table (GFM): a header row followed by a delimiter row of dashes/colons.
    if (line.includes("|") && i + 1 < end && isTableDelimiter(lines[i + 1])) {
      const consumed = parseTable(lines, i, end);
      if (consumed) {
        out.push(consumed.html);
        i = consumed.next;
        continue;
      }
    }

    // Paragraph — accumulate until a blank line or the start of another block.
    const buf: string[] = [];
    while (i < end && lines[i].trim() !== "" && !startsNewBlock(lines, i, end)) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(buf.join("\n"))}</p>`);
  }

  return { html: out.join("\n") };
}

/**
 * Would `lines[i]` begin a new block that should interrupt an open paragraph?
 * (Used so a heading/list/fence on the next line ends the paragraph cleanly.)
 */
function startsNewBlock(lines: string[], i: number, end: number): boolean {
  const line = lines[i];
  if (/^(\s{0,3})(```+|~~~+)/.test(line)) return true;
  if (/^\s{0,3}#{1,6}\s+/.test(line)) return true;
  if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) return true;
  if (/^\s{0,3}>/.test(line)) return true;
  if (isListItem(line)) return true;
  if (line.includes("|") && i + 1 < end && isTableDelimiter(lines[i + 1])) return true;
  return false;
}

const LIST_ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

function isListItem(line: string): boolean {
  return LIST_ITEM_RE.test(line);
}

/** Is this an unordered marker (`-`, `*`, `+`) vs an ordered one (`1.`)? */
function isOrderedMarker(marker: string): boolean {
  return /\d/.test(marker);
}

interface ConsumeResult {
  html: string;
  next: number;
}

/**
 * Parse a list (and any nested sub-lists, by indentation) starting at `start`.
 * Items at a deeper indent than the list's base become nested lists, parsed
 * recursively. Item bodies run through the block parser so they can hold
 * paragraphs, code, nested lists, etc.
 */
function parseList(lines: string[], start: number, end: number): ConsumeResult {
  const first = lines[start].match(LIST_ITEM_RE)!;
  const baseIndent = first[1].length;
  const ordered = isOrderedMarker(first[2]);
  const startNum = ordered ? parseInt(first[2], 10) : 1;

  const items: string[] = [];
  let i = start;

  while (i < end) {
    const line = lines[i];
    if (line.trim() === "") {
      // A blank line may separate items or end the list; peek ahead.
      let j = i + 1;
      while (j < end && lines[j].trim() === "") j++;
      if (j >= end) break;
      const cont = lines[j].match(LIST_ITEM_RE);
      const contIndent = cont ? cont[1].length : leadingSpaces(lines[j]);
      if (contIndent < baseIndent || (!cont && contIndent <= baseIndent)) break;
      // A same-level item of a DIFFERENT marker type (ordered ↔ unordered)
      // begins a new list, not a continuation of this one.
      if (cont && cont[1].length === baseIndent && isOrderedMarker(cont[2]) !== ordered) break;
      i = j;
      continue;
    }

    const m = line.match(LIST_ITEM_RE);
    if (m && m[1].length === baseIndent) {
      // Switching marker type at this level ends the current list.
      if (isOrderedMarker(m[2]) !== ordered) break;
      // A new item at this list's level. Collect its lines (the marker line
      // plus any following lines indented past the marker, or lazy
      // continuations) and parse them as blocks.
      const markerWidth = m[1].length + m[2].length + 1;
      const itemLines: string[] = [m[3]];
      i++;
      while (i < end) {
        const l = lines[i];
        if (l.trim() === "") {
          // keep blank lines inside the item only if the item continues
          if (i + 1 < end && leadingSpaces(lines[i + 1]) >= markerWidth) {
            itemLines.push("");
            i++;
            continue;
          }
          break;
        }
        const next = l.match(LIST_ITEM_RE);
        if (next && next[1].length <= baseIndent) break; // sibling or shallower
        // strip one level of item indentation for the nested block parser
        itemLines.push(l.slice(Math.min(markerWidth, leadingSpaces(l))));
        i++;
      }
      items.push(renderListItem(itemLines));
      continue;
    }

    // Anything else at/under the base indent ends the list.
    if (!m && leadingSpaces(line) <= baseIndent) break;
    if (m && m[1].length < baseIndent) break;
    // Deeper non-item content without a preceding item — bail to be safe.
    break;
  }

  const tag = ordered ? "ol" : "ul";
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : "";
  return { html: `<${tag}${startAttr}>\n${items.join("\n")}\n</${tag}>`, next: i };
}

/** Render a single list item's collected lines, with GFM task-list support. */
function renderListItem(itemLines: string[]): string {
  // Task list checkbox: "[ ] text" / "[x] text" on the first line.
  const task = itemLines[0].match(/^\[([ xX])\]\s+(.*)$/);
  if (task) {
    const checked = task[1].toLowerCase() === "x" ? " checked" : "";
    itemLines = [task[2], ...itemLines.slice(1)];
    const inner = renderItemBody(itemLines);
    return `<li class="task"><input type="checkbox" disabled${checked}>${inner}</li>`;
  }
  return `<li>${renderItemBody(itemLines)}</li>`;
}

/**
 * Render a list item's body. A simple one-line item is emitted inline (no <p>
 * wrapper, matching tight-list rendering); anything multi-block goes through
 * the full block parser.
 */
function renderItemBody(itemLines: string[]): string {
  const hasBlank = itemLines.some((l) => l.trim() === "");
  // Walk by index — `indexOf` would return the first matching line, mis-testing
  // (and quadratically re-scanning) any item with repeated line text.
  let hasBlock = false;
  for (let idx = 1; idx < itemLines.length; idx++) {
    if (itemLines[idx].trim() !== "" && startsNewBlock(itemLines, idx, itemLines.length)) {
      hasBlock = true;
      break;
    }
  }
  if (!hasBlank && !hasBlock) {
    return inline(itemLines.join("\n").trim());
  }
  return "\n" + parseBlocks(itemLines, 0, itemLines.length).html + "\n";
}

function leadingSpaces(line: string): number {
  const m = line.match(/^(\s*)/);
  return m ? m[1].replace(/\t/g, "    ").length : 0;
}

// ---------------------------------------------------------------------------
// Tables (GFM)
// ---------------------------------------------------------------------------

function isTableDelimiter(line: string): boolean {
  // e.g. `| --- | :--: | ---: |` — each cell is dashes with optional colons.
  if (!line.includes("-")) return false;
  const cells = splitTableRow(line);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

/** Split a table row into cells, honoring `\|` escapes and trimming edges. */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function parseTable(lines: string[], start: number, end: number): ConsumeResult | null {
  const header = splitTableRow(lines[start]);
  const delim = splitTableRow(lines[start + 1]);
  const aligns = delim.map((c) => {
    const t = c.trim();
    const left = t.startsWith(":");
    const right = t.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });

  const headHtml = header
    .map((c, idx) => `<th${alignAttr(aligns[idx])}>${inline(c.trim())}</th>`)
    .join("");

  const rows: string[] = [];
  let i = start + 2;
  while (i < end && lines[i].trim() !== "" && lines[i].includes("|")) {
    const cells = splitTableRow(lines[i]);
    const tds = header
      .map((_, idx) => `<td${alignAttr(aligns[idx])}>${inline((cells[idx] || "").trim())}</td>`)
      .join("");
    rows.push(`<tr>${tds}</tr>`);
    i++;
  }

  const html =
    `<table>\n<thead><tr>${headHtml}</tr></thead>\n` +
    (rows.length ? `<tbody>\n${rows.join("\n")}\n</tbody>\n` : "") +
    `</table>`;
  return { html, next: i };
}

function alignAttr(align: string): string {
  return align ? ` style="text-align:${align}"` : "";
}

// ---------------------------------------------------------------------------
// Inline parser
// ---------------------------------------------------------------------------

/**
 * Render inline Markdown to safe HTML. Strategy:
 *   1. Pull code spans out into placeholders (their content stays literal).
 *   2. HTML-escape everything that remains.
 *   3. Apply inline constructs (images, links, emphasis, strikethrough) on the
 *      now-escaped text — every emitted tag is one we author.
 *   4. Splice the (escaped) code spans back in as <code>…</code>.
 */
function inline(text: string): string {
  const codes: string[] = [];
  // Extract `code` / ``code with ` inside`` spans first.
  let work = text.replace(/(`+)([\s\S]*?)\1/g, (_m, _ticks, content) => {
    const idx = codes.length;
    codes.push(`<code>${escapeHtml(content.replace(/^ | $/g, ""))}</code>`);
    return ` C${idx} `;
  });

  work = escapeHtml(work);

  // Images: ![alt](url "title")
  work = work.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_m, alt, url, title) => {
      const safe = safeUrl(url, true);
      if (!safe) return _m;
      const t = title ? ` title="${escapeAttr(title)}"` : "";
      return `<img src="${escapeAttr(safe)}" alt="${escapeAttr(alt)}"${t}>`;
    },
  );

  // Links: [text](url "title")
  work = work.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_m, label, url, title) => {
      const safe = safeUrl(url, false);
      if (!safe) return _m;
      const t = title ? ` title="${escapeAttr(title)}"` : "";
      return `<a href="${escapeAttr(safe)}"${t} rel="noopener noreferrer">${label}</a>`;
    },
  );

  // Footnote references: [^id] → superscript link, numbered by first use.
  // Done before reference links so `[^id]` isn't mistaken for a shortcut ref.
  work = work.replace(/\[\^([^\]]+)\]/g, (_m, rawId) => {
    const id = rawId.trim();
    if (!footnoteDefs.has(id)) return _m; // undefined footnote → literal text
    let num = footnoteOrder.indexOf(id) + 1;
    if (num === 0) num = footnoteOrder.push(id);
    const slug = footnoteSlug(id);
    // Each reference gets a unique anchor id so the footnote can link back to
    // every one of its call sites (no duplicate ids when a note is reused).
    const refCount = (footnoteRefCounts.get(id) ?? 0) + 1;
    footnoteRefCounts.set(id, refCount);
    const refId = refCount === 1 ? `fnref-${slug}` : `fnref-${slug}-${refCount}`;
    return `<sup class="footnote-ref"><a href="#fn-${slug}" id="${refId}">${num}</a></sup>`;
  });

  // Full / collapsed reference links: [text][label] or [text][].
  work = work.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (_m, text, label) =>
    refLink(text, label.trim() === "" ? text : label) ?? _m,
  );
  // Shortcut reference links: [label] (only when it names a known definition).
  work = work.replace(/\[([^\]]+)\]/g, (_m, label) => refLink(label, label) ?? _m);

  // Bare autolinks: <https://…>  (angle-bracketed; escaped to &lt;…&gt;)
  work = work.replace(/&lt;((?:https?|mailto):[^\s&]+)&gt;/g, (_m, url) => {
    const safe = safeUrl(url, false);
    return safe ? `<a href="${escapeAttr(safe)}" rel="noopener noreferrer">${escapeHtml(url)}</a>` : _m;
  });

  // Bold + italic, strikethrough. Order matters: *** before ** before *.
  work = work
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/___([^_]+)___/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");

  // Hard line break: two trailing spaces (already escaped) before a newline.
  work = work.replace(/ {2,}\n/g, "<br>\n").replace(/\n/g, "<br>\n");

  // Restore code spans.
  work = work.replace(/ C(\d+) /g, (_m, idx) => codes[Number(idx)]);
  return work;
}

/**
 * Resolve a reference-style link to an `<a>`, or null if `label` names no known
 * definition (or its URL is unsafe) — in which case the caller leaves the
 * source literal. `text` is the already-escaped link content.
 */
function refLink(text: string, label: string): string | null {
  const ref = linkRefs.get(normalizeLabel(label));
  if (!ref) return null;
  const safe = safeUrl(ref.url, false);
  if (!safe) return null;
  const t = ref.title ? ` title="${escapeAttr(ref.title)}"` : "";
  return `<a href="${escapeAttr(safe)}"${t} rel="noopener noreferrer">${text}</a>`;
}

/**
 * Allow only safe URL schemes. Relative URLs (no scheme, or starting with `/`,
 * `#`, `./`, `../`) pass; absolute URLs must be http(s)/mailto/tel, or — for
 * images only — a `data:image/...`. Anything else (e.g. `javascript:`) is
 * rejected so the link/image is left as literal text.
 */
function safeUrl(url: string, isImage: boolean): string | null {
  const u = url.trim();
  if (u === "") return null;
  // Relative or fragment/anchor — safe.
  if (/^[#/.]/.test(u) || !/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  const scheme = u.slice(0, u.indexOf(":")).toLowerCase();
  if (scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel") return u;
  if (isImage && /^data:image\//i.test(u)) return u;
  return null;
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
