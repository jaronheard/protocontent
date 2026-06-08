#!/usr/bin/env node
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  ApiError,
  artifactHistory,
  keepArtifact,
  listSpace,
  publish,
  unpublishArtifact,
  type PublishFile,
} from "./api.js";
import { loadConfig, type BridgeConfig } from "./config.js";
import {
  contentTypeFromName,
  formatBytes,
  slugify,
  slugifyBasename,
  walkDir,
} from "./util.js";

// Safety rails for a single publish_folder call (not the abuse-limits feature).
const MAX_FILES_PER_CALL = 500;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_SINGLE_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

type TextResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function textResult(text: string): TextResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(text: string): TextResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Format an epoch-ms timestamp (or null) as a short human-readable UTC string. */
function fmtTime(ms: number | null | undefined): string {
  if (ms == null) return "";
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/**
 * Compose the success message a publish tool returns. Deliberately terse: hand
 * the agent the tappable link plus a one-line directive to share it plainly.
 * No space/version/expiry chatter — that ceremony is what makes replies noisy.
 */
function publishMessage(what: string, res: { markdown: string }): string {
  return (
    `Published ${what}.\n\n` +
    `${res.markdown}\n\n` +
    `Share that link with the user in one short line. No emoji, no private/public ` +
    `labels, no expiry notes — just the link.`
  );
}

async function main(): Promise<void> {
  let config: BridgeConfig;
  try {
    config = await loadConfig();
  } catch (err) {
    // Fatal: we cannot operate without a token. Surface clearly on stderr.
    process.stderr.write(
      `[protocontent] startup failed: ${(err as Error).message}\n`
    );
    process.exit(1);
    return;
  }

  process.stderr.write(
    `[protocontent] space ${config.spaceId}` +
      (config.spaceLabel ? ` (${config.spaceLabel})` : "") +
      ` -> ${config.apiBase}\n`
  );

  const server = new McpServer(
    { name: "protocontent", version: "0.3.0" },
    {
      instructions:
        "Publish a local file or folder to protocontent and share its live link. Everything you " +
        "publish lands in this thread's persistent 'space' and updates in place when you republish " +
        "under the same name.\n\n" +
        "WHEN TO PUBLISH: any self-contained, browser-openable artifact — HTML reports, Markdown " +
        "docs (rendered to a styled page), plans, dashboards, prototypes, diagrams, screenshots, or a " +
        "built static site. Never publish source code, secrets, or files meant to be committed.\n\n" +
        "AFTER PUBLISHING: share the returned markdown link in ONE short line — no preamble, no " +
        "emoji, no 'private vs public' explanation, no expiry notes. To update an artifact, publish " +
        "again with the SAME `name` (same URL). The `list` tool returns the space index link that " +
        "shows everything; surface it only when the user asks to see the whole collection.",
    }
  );

  // --- publish_html ----------------------------------------------------------
  server.registerTool(
    "publish_html",
    {
      title: "Publish a single file",
      description:
        "Publish a single HTML, Markdown (.md, rendered to a styled page), or other file — or inline " +
        "content — to this space and share its live link. Provide exactly one of `path` (a file on " +
        "disk) or `content` (inline text; `html`/" +
        "`body` accepted as aliases). To update an artifact, call again with the SAME `name` — it " +
        "republishes in place at the same URL (don't invent a new name like plan-v2).",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Absolute or relative path to a local file to publish."),
        content: z
          .string()
          .optional()
          .describe("Inline file content to publish (alternative to `path`)."),
        // `html`/`body` are accepted as aliases for `content`. The tool name is
        // `publish_html`, so agents — especially when calling before the schema
        // loads — reach for `html`. Accepting it makes the obvious guess work
        // instead of failing with a confusing XOR error.
        html: z
          .string()
          .optional()
          .describe("Alias for `content` (inline file content)."),
        body: z
          .string()
          .optional()
          .describe("Alias for `content` (inline file content)."),
        name: z
          .string()
          .optional()
          .describe(
            "Artifact name (slug). Defaults to the slugified file basename, or 'page'."
          ),
        ttl: z
          .string()
          .optional()
          .describe("Optional time-to-live, e.g. '7d', '24h'. Omit for the default."),
      },
    },
    async (args) => {
      const { path: filePath, name, ttl } = args;
      // Coalesce the inline-content aliases into a single value.
      const content = args.content ?? args.html ?? args.body;
      if (filePath && content !== undefined) {
        return errorResult(
          "Provide exactly one of `path` or `content`, not both."
        );
      }
      if (!filePath && content === undefined) {
        return errorResult(
          "Provide either `content` (inline text, also accepted as `html`/`body`) " +
            "or `path` (a file on disk)."
        );
      }

      let bytes: Buffer;
      let sourceName: string;

      if (filePath) {
        const abs = path.resolve(filePath);
        try {
          const stat = await fs.stat(abs);
          if (!stat.isFile()) {
            return errorResult(`Not a file: ${abs}`);
          }
          if (stat.size > MAX_SINGLE_FILE_BYTES) {
            return errorResult(
              `File is ${formatBytes(stat.size)}, exceeding the ${formatBytes(
                MAX_SINGLE_FILE_BYTES
              )} single-file limit.`
            );
          }
          bytes = await fs.readFile(abs);
        } catch (err) {
          return errorResult(
            `Could not read file ${abs}: ${(err as Error).message}`
          );
        }
        sourceName = path.basename(abs);
      } else {
        bytes = Buffer.from(content as string, "utf8");
        sourceName = "index.html";
      }

      const artifactName = name
        ? slugify(name)
        : filePath
        ? slugifyBasename(sourceName)
        : "page";

      // relPath: a sensible filename. Use the source basename, or default to
      // index.html for inline content.
      const relPath = filePath ? sourceName : "index.html";
      const file: PublishFile = {
        relPath,
        contentBase64: bytes.toString("base64"),
        contentType: contentTypeFromName(relPath),
      };

      try {
        const res = await publish(config, {
          spaceId: config.spaceId,
          spaceLabel: config.spaceLabel,
          name: artifactName,
          ttl,
          files: [file],
        });
        return textResult(publishMessage(`'${artifactName}'`, res));
      } catch (err) {
        return errorResult(`Publish failed: ${(err as Error).message}`);
      }
    }
  );

  // --- publish_folder --------------------------------------------------------
  server.registerTool(
    "publish_folder",
    {
      title: "Publish a folder",
      description:
        "Recursively publish a local directory (e.g. a built static site) to this space and share " +
        "its live link. To update it, call again with the SAME `name` — it republishes in place at " +
        "the same URL. Skips node_modules, .git, dist, and dotfiles.",
      inputSchema: {
        dir: z.string().describe("Path to the directory to publish."),
        entry: z
          .string()
          .optional()
          .describe("Entry file served at the root. Defaults to 'index.html'."),
        name: z
          .string()
          .optional()
          .describe(
            "Artifact name (slug). Defaults to the slugified directory basename."
          ),
        ttl: z
          .string()
          .optional()
          .describe("Optional time-to-live, e.g. '7d', '24h'. Omit for the default."),
      },
    },
    async (args) => {
      const { dir, entry, name, ttl } = args;
      const absDir = path.resolve(dir);

      try {
        const stat = await fs.stat(absDir);
        if (!stat.isDirectory()) {
          return errorResult(`Not a directory: ${absDir}`);
        }
      } catch (err) {
        return errorResult(
          `Could not access directory ${absDir}: ${(err as Error).message}`
        );
      }

      let walked;
      try {
        walked = await walkDir(absDir, {
          maxFiles: MAX_FILES_PER_CALL,
          maxTotalBytes: MAX_TOTAL_BYTES,
        });
      } catch (err) {
        return errorResult((err as Error).message);
      }

      if (walked.length === 0) {
        return errorResult(`No publishable files found in ${absDir}.`);
      }

      const files: PublishFile[] = [];
      for (const f of walked) {
        if (f.size > MAX_SINGLE_FILE_BYTES) {
          return errorResult(
            `File ${f.relPath} is ${formatBytes(f.size)}, exceeding the ` +
              `${formatBytes(MAX_SINGLE_FILE_BYTES)} single-file limit.`
          );
        }
        const buf = await fs.readFile(f.absPath);
        files.push({
          relPath: f.relPath,
          contentBase64: buf.toString("base64"),
          contentType: contentTypeFromName(f.relPath),
        });
      }

      const entryFile = entry ?? "index.html";
      const hasEntry = files.some((f) => f.relPath === entryFile);
      const artifactName = name ? slugify(name) : slugify(path.basename(absDir));

      try {
        const res = await publish(config, {
          spaceId: config.spaceId,
          spaceLabel: config.spaceLabel,
          name: artifactName,
          entry: entryFile,
          ttl,
          files,
        });
        let msg = publishMessage(
          `'${artifactName}' (${files.length} files)`,
          res
        );
        if (!hasEntry) {
          msg +=
            `\n\nNote: entry file '${entryFile}' was not found in the folder; ` +
            `the root URL may 404 until you add one or pass a different \`entry\`.`;
        }
        return textResult(msg);
      } catch (err) {
        return errorResult(`Publish failed: ${(err as Error).message}`);
      }
    }
  );

  // --- list ------------------------------------------------------------------
  server.registerTool(
    "list",
    {
      title: "List artifacts in this space",
      description:
        "List the artifacts in this space with their live links, plus the space index link that " +
        "shows everything. Use it to recover an artifact's link, or to give the user the index page " +
        "when they ask to see the whole collection.",
      inputSchema: {},
    },
    async () => {
      try {
        const res = await listSpace(config);
        const spaceUrl = res.spaceUrl || `https://${config.spaceId}.protocontent.app`;
        if (!res.artifacts || res.artifacts.length === 0) {
          return textResult("Nothing published in this space yet.");
        }
        const lines = res.artifacts.map((a) => `- [${a.name} ↗](${a.url})`);
        return textResult(
          lines.join("\n") + `\n\nSpace index (shows everything): ${spaceUrl}`
        );
      } catch (err) {
        // A space that has never been published to 404s — that's "empty", not an error.
        if (err instanceof ApiError && err.status === 404) {
          return textResult("Nothing published in this space yet.");
        }
        return errorResult(`List failed: ${(err as Error).message}`);
      }
    }
  );

  // --- history ---------------------------------------------------------------
  server.registerTool(
    "history",
    {
      title: "Show an artifact's version history",
      description:
        "Show the published version history of a named artifact in this space (each republish under " +
        "the same name is a new version).",
      inputSchema: {
        name: z.string().describe("Artifact name (slug) to show history for."),
      },
    },
    async (args) => {
      const name = slugify(args.name);
      try {
        const res = await artifactHistory(config, name);
        if (!res.versions || res.versions.length === 0) {
          return textResult(`No version history for '${name}'.`);
        }
        const lines = res.versions
          .slice()
          .sort((a, b) => b.version - a.version)
          .map((v) => `- v${v.version} — ${fmtTime(v.at)} — [open ↗](${v.url})`);
        return textResult(`History for '${name}':\n` + lines.join("\n"));
      } catch (err) {
        return errorResult(`History failed: ${(err as Error).message}`);
      }
    }
  );

  // --- unpublish -------------------------------------------------------------
  server.registerTool(
    "unpublish",
    {
      title: "Unpublish an artifact",
      description:
        "Remove a named artifact from this space so its URL stops serving content.",
      inputSchema: {
        name: z.string().describe("Artifact name (slug) to unpublish."),
      },
    },
    async (args) => {
      const name = slugify(args.name);
      try {
        const res = await unpublishArtifact(config, name);
        if (res.ok) {
          return textResult(`Unpublished '${name}'. Its URL no longer serves content.`);
        }
        return errorResult(`Unpublish of '${name}' did not succeed.`);
      } catch (err) {
        return errorResult(`Unpublish failed: ${(err as Error).message}`);
      }
    }
  );

  // --- keep ------------------------------------------------------------------
  server.registerTool(
    "keep",
    {
      title: "Keep an artifact permanently",
      description:
        "Remove the expiry from a named artifact so it is kept permanently.",
      inputSchema: {
        name: z.string().describe("Artifact name (slug) to keep permanently."),
      },
    },
    async (args) => {
      const name = slugify(args.name);
      try {
        await keepArtifact(config, name);
        return textResult(
          `'${name}' will now be kept permanently (expiry removed).`
        );
      } catch (err) {
        return errorResult(`Keep failed: ${(err as Error).message}`);
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[protocontent] stdio MCP server ready.\n");
}

main().catch((err) => {
  process.stderr.write(`[protocontent] fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
