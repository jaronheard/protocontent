// protocontent Worker entry point.
//
// One Worker serves three hostnames, dispatched by the request Host header:
//   api.protocontent.com  -> control API (bearer auth); the bridge calls this.
//   mcp.protocontent.com  -> remote McpAgent endpoint (Streamable HTTP).
//   *.protocontent.app    -> public content serving (isolated origin); label = spaceId.
//   *.protocontent.com    -> legacy artifact links: 301-redirect to *.protocontent.app.
//
// Also exports:
//   - the `Space` Durable Object (live WebSocket fanout),
//   - the `ProtoMcpAgent` McpAgent Durable Object,
//   - a `scheduled` (cron) handler that sweeps expired artifacts hourly.

import type { Env } from "./types";
import { handleApi } from "./api";
import { handleContent } from "./serve";
import { ProtoMcpAgent } from "./mcp";
import { sweepExpired } from "./db";

const CONTROL_DOMAIN = "protocontent.com"; // api. + mcp. (no cookies set here)
const CONTENT_DOMAIN = "protocontent.app"; // isolated origin for untrusted artifacts

// Pre-build the MCP Streamable-HTTP handler once. .serve() returns a Worker
// handler ({ fetch }). We use the canonical "/mcp" path but also accept the
// host root as a fallback for clients that POST to "/".
const mcpHandler = ProtoMcpAgent.serve("/mcp");
const mcpRootHandler = ProtoMcpAgent.serve("/");

/** Extract the hostname (without port) from the request. */
function hostnameOf(request: Request): string {
  const host = request.headers.get("host") || new URL(request.url).host;
  return host.split(":")[0].toLowerCase();
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const hostname = hostnameOf(request);
    const url = new URL(request.url);

    // 1. Control API (protocontent.com).
    if (hostname === `api.${CONTROL_DOMAIN}`) {
      return handleApi(request, env, ctx);
    }

    // 2. Remote MCP endpoint (protocontent.com). Route /mcp (canonical) or the
    //    host root as a fallback to the same agent.
    if (hostname === `mcp.${CONTROL_DOMAIN}`) {
      const path = url.pathname;
      if (path === "/" || path === "") {
        return mcpRootHandler.fetch(request, env, ctx);
      }
      return mcpHandler.fetch(request, env, ctx);
    }

    // 3. Content serving on the isolated content origin (*.protocontent.app).
    //    The subdomain label is the spaceId.
    if (hostname.endsWith(`.${CONTENT_DOMAIN}`)) {
      const label = hostname.slice(0, -1 * (`.${CONTENT_DOMAIN}`).length);
      if (label && label !== "www") {
        return handleContent(request, env, label);
      }
    }

    // 4. Back-compat: legacy artifact links on *.protocontent.com 301-redirect
    //    to the same path on the content origin (no untrusted HTML runs on .com).
    if (hostname.endsWith(`.${CONTROL_DOMAIN}`)) {
      const label = hostname.slice(0, -1 * (`.${CONTROL_DOMAIN}`).length);
      if (label && label !== "api" && label !== "mcp" && label !== "www") {
        return Response.redirect(
          `https://${label}.${CONTENT_DOMAIN}${url.pathname}${url.search}`,
          301,
        );
      }
    }

    // 5. Apex / www on either domain: minimal landing.
    if (
      hostname === CONTROL_DOMAIN || hostname === CONTENT_DOMAIN ||
      hostname === `www.${CONTROL_DOMAIN}` || hostname === `www.${CONTENT_DOMAIN}`
    ) {
      return new Response("protocontent", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    // 6. Unknown host (e.g. workers.dev preview): treat the first label as a
    //    spaceId so local/preview testing still works.
    const firstLabel = hostname.split(".")[0];
    if (firstLabel) {
      return handleContent(request, env, firstLabel);
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Hourly sweep: delete expired artifacts, their file rows, and R2 objects.
    ctx.waitUntil(sweepExpired(env));
  },
} satisfies ExportedHandler<Env>;

// Durable Object exports — names must match wrangler.jsonc bindings.
export { Space } from "./space";
export { ProtoMcpAgent };
