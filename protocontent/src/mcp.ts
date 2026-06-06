// Remote MCP endpoint for mcp.protocontent.com (FALLBACK path).
//
// DEGRADED PATH — read this before relying on it:
//   - This is the fallback for clients that can only speak remote MCP. It is
//     intentionally thinner than the HTTP API + bridge:
//       * inline content only (no local file reading, so folder publishing and
//         arbitrary assets aren't available here — only a single HTML doc),
//       * weaker thread scoping: the MCP "session" IS the space. The Agents SDK
//         gives one Durable Object per MCP session, so we derive the spaceId
//         from this agent's Durable Object id. That means a session maps to
//         exactly one space and there is no cross-session sharing.
//   - It calls the same internal publish/list/history/unpublish/keep logic as
//     the HTTP API (src/db.ts), so behavior stays consistent.
//
// Uses .serve() (Streamable HTTP). We deliberately do NOT use serveSSE():
// cloudflare/agents#660 — SSE transport fails to propagate the session id /
// headers, which breaks session->space mapping.

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Env } from "./types";
import {
  ensureSpace,
  publishArtifact,
  listArtifacts,
  getArtifact,
  listVersions,
  unpublishArtifact,
  keepArtifact,
  artifactUpdatedAt,
  spaceOrigin,
} from "./db";
import { bytesToBase64, slugify } from "./util";

// A stable, fixed project id that owns all MCP-fallback spaces. Spaces created
// via this path are namespaced by the per-session Durable Object id, so they
// never collide with bridge/API spaces (those use short generated ids).
const MCP_PROJECT_ID = "__mcp_fallback__";

interface McpState {
  // The per-session space id, derived once from the Durable Object id.
  spaceId: string;
}

export class ProtoMcpAgent extends McpAgent<Env, McpState> {
  server = new McpServer({ name: "protocontent", version: "0.1.0" });

  initialState: McpState = { spaceId: "" };

  /** Derive a DNS-safe spaceId from this session's Durable Object id. */
  private sessionSpaceId(): string {
    if (this.state.spaceId) return this.state.spaceId;
    // ctx.id.toString() is a stable hex id for this session's DO instance.
    const raw = this.ctx.id.toString().toLowerCase().replace(/[^a-z0-9]/g, "");
    const spaceId = ("mcp" + raw).slice(0, 24) || "mcp" + Date.now().toString(36);
    this.setState({ spaceId });
    return spaceId;
  }

  /** Ensure the per-session space row exists, owned by the MCP project. */
  private async ensureSessionSpace(): Promise<string> {
    const spaceId = this.sessionSpaceId();
    await ensureSpace(this.env, spaceId, MCP_PROJECT_ID, "MCP session");
    return spaceId;
  }

  private async notify(spaceId: string): Promise<void> {
    try {
      const id = this.env.SPACE.idFromName(spaceId);
      await this.env.SPACE.get(id).fetch("https://do/notify", { method: "POST" });
    } catch {
      /* best effort */
    }
  }

  async init(): Promise<void> {
    // publish_html — inline single-file HTML publish.
    this.server.tool(
      "publish_html",
      {
        content: z
          .string()
          .optional()
          .describe("Full HTML document to publish (also accepted as `html`/`body`)."),
        // Aliases for `content`. The tool is named `publish_html`, so agents
        // naturally reach for `html`; accept it instead of failing.
        html: z.string().optional().describe("Alias for `content`."),
        body: z.string().optional().describe("Alias for `content`."),
        name: z.string().optional().describe("Artifact name (URL path segment)."),
        ttl: z
          .enum(["1h", "6h", "1d", "3d", "7d", "30d"])
          .optional()
          .describe("Time to live. Default 7d."),
      },
      async ({ content, html, body, name, ttl }) => {
        const doc = content ?? html ?? body;
        if (doc === undefined) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Provide `content` (the HTML document, also accepted as `html`/`body`).",
              },
            ],
          };
        }
        const spaceId = await this.ensureSessionSpace();
        const artifactName = slugify(name || "page");
        const contentBase64 = bytesToBase64(new TextEncoder().encode(doc));
        const result = await publishArtifact(this.env, {
          spaceId,
          name: artifactName,
          ttl,
          files: [
            {
              relPath: "index.html",
              contentBase64,
              contentType: "text/html; charset=utf-8",
            },
          ],
        });
        await this.notify(spaceId);
        return {
          content: [
            {
              type: "text",
              text:
                `Published ${result.markdown}\n` +
                `URL: ${result.url}\n` +
                `Space: ${result.spaceUrl}\n` +
                `Version: ${result.version}\n` +
                `Expires: ${result.expiresAt ? new Date(result.expiresAt).toISOString() : "never"}`,
            },
          ],
        };
      },
    );

    // list — artifacts in this session's space.
    this.server.tool("list", {}, async () => {
      const spaceId = await this.ensureSessionSpace();
      const rows = await listArtifacts(this.env, spaceId);
      const origin = spaceOrigin(spaceId);
      const items = [];
      for (const a of rows) {
        const updatedAt = (await artifactUpdatedAt(this.env, a.id)) || a.created_at;
        items.push({
          name: a.name,
          url: `${origin}/${a.name}`,
          version: a.latest_version,
          expiresAt: a.expires_at,
          updatedAt,
        });
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ artifacts: items }, null, 2) }],
      };
    });

    // history — versions of one artifact.
    this.server.tool(
      "history",
      { name: z.string().describe("Artifact name.") },
      async ({ name }) => {
        const spaceId = await this.ensureSessionSpace();
        const artifact = await getArtifact(this.env, spaceId, slugify(name));
        if (!artifact) {
          return { content: [{ type: "text", text: `No artifact named "${name}".` }] };
        }
        const origin = spaceOrigin(spaceId);
        const versions = (await listVersions(this.env, artifact.id)).map((v) => ({
          version: v.version,
          at: v.at,
          url: `${origin}/${artifact.name}?v=${v.version}`,
        }));
        return {
          content: [{ type: "text", text: JSON.stringify({ versions }, null, 2) }],
        };
      },
    );

    // unpublish — remove an artifact.
    this.server.tool(
      "unpublish",
      { name: z.string().describe("Artifact name.") },
      async ({ name }) => {
        const spaceId = await this.ensureSessionSpace();
        const ok = await unpublishArtifact(this.env, spaceId, slugify(name));
        if (ok) await this.notify(spaceId);
        return {
          content: [
            { type: "text", text: ok ? `Unpublished "${name}".` : `No artifact named "${name}".` },
          ],
        };
      },
    );

    // keep — pin an artifact (clear expiry).
    this.server.tool(
      "keep",
      { name: z.string().describe("Artifact name.") },
      async ({ name }) => {
        const spaceId = await this.ensureSessionSpace();
        const ok = await keepArtifact(this.env, spaceId, slugify(name));
        return {
          content: [
            {
              type: "text",
              text: ok ? `"${name}" will be kept (no expiry).` : `No artifact named "${name}".`,
            },
          ],
        };
      },
    );
  }
}
