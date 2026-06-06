#!/usr/bin/env node
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
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

/** Format an epoch-ms expiry as an absolute time plus a relative hint. */
function fmtExpiry(ms: number | null | undefined): string {
  if (ms == null) return "";
  const days = Math.round((ms - Date.now()) / 86400000);
  const rel = days <= 0 ? "soon" : days === 1 ? "in ~1 day" : `in ~${days} days`;
  return `${fmtTime(ms)} (${rel})`;
}

/** Compose the standard human-readable success message every tool returns. */
function publishMessage(
  what: string,
  res: {
    url: string;
    spaceUrl: string;
    markdown: string;
    version: number;
    expiresAt: number | null;
  }
): string {
  const lines: string[] = [];
  lines.push(`Published ${what} (v${res.version}).`);
  // Always surface a tappable markdown link.
  lines.push("");
  lines.push(res.markdown);
  lines.push("");
  lines.push(`Live space (updates in real time): ${res.spaceUrl}`);
  lines.push(`Direct URL: ${res.url}`);
  if (res.expiresAt) {
    lines.push(`Expires ${fmtExpiry(res.expiresAt)} — use \`keep\` to make it permanent.`);
  } else {
    lines.push("This artifact has no expiry.");
  }
  return lines.join("\n");
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
    { name: "protocontent", version: "0.2.1" },
    {
      instructions:
        "Publish local files/folders to protocontent and share a tappable, live URL. Each agent " +
        "thread is one persistent 'space'; everything you publish lands there and the space page " +
        "updates in real time as you republish.\n\n" +
        "WHEN TO PUBLISH: any self-contained artifact a human would want to open in a browser — " +
        "HTML reports, plans, dashboards, prototypes, generated docs, diagrams, screenshots, or a " +
        "built static site. Do NOT publish repo source code, secrets, or files meant to be committed.\n\n" +
        "ALWAYS, on every publish: show the returned markdown link to the user. To UPDATE an artifact " +
        "as you iterate, call publish_html/publish_folder again with the SAME `name` — it republishes " +
        "in place at the same URL (do not invent a new name like plan-v2). Use `keep` to stop expiry.\n\n" +
        "AT THE END of a turn where you published anything: surface BOTH (1) the private session-index " +
        "link (the space page, carrying its ?k= token — the one link that shows everything) and (2) each " +
        "worked-on artifact's direct link. The `list` tool returns both. Label which is private vs public.",
    }
  );

  // --- publish_html ----------------------------------------------------------
  server.registerTool(
    "publish_html",
    {
      title: "Publish a single file",
      description:
        "Publish a single HTML (or other) file or inline content to this space and SHARE its " +
        "tappable, live URL with the user. Provide exactly one of `path` (a file on disk) or " +
        "`content` (inline text). To UPDATE an artifact as you iterate, call again with the SAME " +
        "`name` — it republishes in place at the same URL (don't invent a new name). The space " +
        "page updates live as you republish.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Absolute or relative path to a local file to publish."),
        content: z
          .string()
          .optional()
          .describe("Inline file content to publish (alternative to `path`)."),
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
      const { path: filePath, content, name, ttl } = args;
      if ((filePath && content) || (!filePath && content === undefined)) {
        return errorResult(
          "Provide exactly one of `path` or `content`."
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
        "Recursively publish a local directory (e.g. a built static site) to this space and SHARE " +
        "its tappable, live URL with the user. To UPDATE it, call again with the SAME `name` — it " +
        "republishes in place at the same URL. Skips node_modules, .git, and dotfiles. The space " +
        "page updates live as you republish.",
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
        "List every artifact in this space with its live URL and version, plus the private " +
        "session-index link. Use this at the END of a task to surface BOTH the index link (private, " +
        "?k=) and each worked-on artifact's direct link (public) to the user.",
      inputSchema: {},
    },
    async () => {
      try {
        const res = await listSpace(config);
        const spaceUrl = res.spaceUrl || `https://${config.spaceId}.protocontent.app`;
        if (!res.artifacts || res.artifacts.length === 0) {
          return textResult(
            `No artifacts published yet in space ${config.spaceId}.\n` +
              `Space: ${spaceUrl}`
          );
        }
        const lines = res.artifacts.map((a) => {
          const exp = a.expiresAt ? ` — expires ${fmtExpiry(a.expiresAt)}` : " — no expiry";
          return `- [${a.name} ↗](${a.url}) (v${a.version})${exp}`;
        });
        return textResult(
          `Artifacts in space ${config.spaceId}:\n` +
            lines.join("\n") +
            `\n\nLive space (updates in real time): ${spaceUrl}`
        );
      } catch (err) {
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
