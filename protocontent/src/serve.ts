// Public content serving for *.protocontent.app (the isolated content origin).
//
// The subdomain label IS the spaceId. Serving is fully stateless in the Worker
// (R2 + D1); the Durable Object is only consulted for the live WebSocket.
//
// Routes (host = <spaceId>.protocontent.app):
//   GET /              -> first-party live session index page
//   GET /__list        -> JSON list of artifacts (for the index to refetch)
//   GET /__live        -> WebSocket upgrade, routed to the Space DO
//   GET /:name         -> serve the artifact entry (or single file)
//   GET /:name/*assets -> serve a file relative to the artifact
//
// Untrusted artifact responses carry a CSP `sandbox` (opaque origin -> no
// cookies/storage = PSL-free inter-artifact isolation) + nosniff + noindex.
// The first-party index page is NOT sandboxed (it needs same-origin WS/fetch).

import type { Env } from "./types";
import { getSpace, listArtifacts, artifactUpdatedAt, resolveFile, getArtifact } from "./db";
import { renderSpacePage, type SpacePageArtifact } from "./space-page";
import { renderViewerShell } from "./viewer-shell";
import { isMarkdownContentType, renderMarkdownDocument } from "./markdown";
import { json } from "./util";

/**
 * Restrictive CSP applied to served (untrusted) artifact bytes.
 *
 * The `sandbox` directive (with NO `allow-same-origin`) forces an OPAQUE origin,
 * so the document cannot read or set cookies / localStorage. That's what isolates
 * artifacts from each other WITHOUT relying on the Public Suffix List: even though
 * every *.protocontent.app subdomain is the same registrable site, a sandboxed
 * artifact has no cookie/storage access at all, so it can't write a
 * `Domain=.protocontent.app` cookie that bleeds onto siblings.
 *
 * Under an opaque origin `'self'` matches nothing, so we allow the artifact's OWN
 * origin explicitly — that lets folder artifacts load their relative assets.
 *
 * `frame-ancestors` is set to the artifact's own origin (NOT `'none'`) so the
 * same-subdomain trusted viewer shell can embed the raw artifact in its iframe
 * (see viewer-shell.ts). Every OTHER origin — third-party sites and sibling
 * spaces' subdomains — is still blocked, preserving clickjacking protection.
 */
function artifactCsp(origin: string): string {
  return [
    "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-top-navigation-by-user-activation",
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' blob: ${origin}`,
    `style-src 'unsafe-inline' ${origin}`,
    `img-src ${origin} data: blob:`,
    `media-src ${origin} data: blob:`,
    `font-src ${origin} data:`,
    `connect-src ${origin}`,
    `frame-src ${origin}`,
    `frame-ancestors ${origin}`,
    "base-uri 'none'",
    `form-action ${origin}`,
  ].join("; ");
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
  });
}

function gone(): Response {
  return new Response("This content has expired.", {
    status: 410,
    headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
  });
}

function isExpired(expiresAt: number | null): boolean {
  return expiresAt != null && expiresAt < Date.now();
}

export async function handleContent(
  request: Request,
  env: Env,
  spaceId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const k = url.searchParams.get("k");

  // The space must exist for every route.
  const space = await getSpace(env, spaceId);
  if (!space) return notFound();

  // Moderation kill switch: a blocked space serves 410 for every route.
  if (space.blocked) {
    return new Response("This content has been removed.", {
      status: 410,
      headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
    });
  }

  // Index surfaces (the session page + its data + live feed) are PRIVATE: they
  // require the space's index token (?k=). Sharing a single artifact link must
  // not expose the whole thread. Individual artifacts (/:name) stay open — the
  // unguessable subdomain is their capability. Spaces created before index
  // tokens existed have a null token and stay open (legacy) until republished.
  const isIndexSurface =
    path === "/" || path === "" || path === "/__list" || path === "/__live";
  if (isIndexSurface && space.index_token && !space.public_index && k !== space.index_token) {
    return notFound();
  }

  // --- Live WebSocket: route to the Space Durable Object. ---
  if (path === "/__live") {
    const id = env.SPACE.idFromName(spaceId);
    const stub = env.SPACE.get(id);
    return stub.fetch(new Request("https://do/__live", request));
  }

  // --- JSON artifact list for the index page. ---
  if (path === "/__list") {
    const artifacts = await buildArtifactList(env, spaceId);
    return json(
      { artifacts },
      200,
      { "x-robots-tag": "noindex", "cache-control": "no-store" },
    );
  }

  // --- First-party live index page. ---
  if (path === "/" || path === "") {
    const artifacts = await buildArtifactList(env, spaceId);
    const html = renderSpacePage(spaceId, space.label, artifacts);
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-robots-tag": "noindex",
        "cache-control": "no-store",
      },
    });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  // --- Artifact serving: /:name  or  /:name/*assets ---
  const segments = path.replace(/^\/+/, "").split("/");
  const name = decodeURIComponent(segments[0]);
  const relUnderArtifact = segments.slice(1).map((s) => safeDecode(s)).join("/");

  const artifact = await getArtifact(env, spaceId, name);
  if (!artifact) return notFound();
  if (isExpired(artifact.expires_at)) return gone();

  // Version: ?v=N (clamped to existing); default = latest.
  let version = artifact.latest_version;
  const vParam = url.searchParams.get("v");
  if (vParam) {
    const v = parseInt(vParam, 10);
    if (Number.isFinite(v) && v > 0) version = v;
  }

  // --- Trusted viewer shell vs. raw artifact bytes ---
  // A top-level browser navigation to the artifact's ENTRY document gets the
  // trusted first-party shell (frames the raw artifact + renders the badge).
  // Everything else — `?raw=1`, iframe/embed dests, sub-path assets, bots and
  // unfurlers (no Sec-Fetch-Dest), HEAD, old browsers — gets the unchanged raw
  // bytes with the original sandbox CSP, byte-for-byte. The framed raw entry is
  // at the same base path (`/:name?raw=1`), so relative-asset resolution is
  // preserved.
  const isRaw = url.searchParams.get("raw") === "1";
  const isEntry = relUnderArtifact === "";
  const wantsShell =
    isEntry &&
    !isRaw &&
    request.method === "GET" &&
    request.headers.get("sec-fetch-dest") === "document";
  if (wantsShell) {
    const { html, csp } = renderViewerShell({
      spaceId,
      name,
      version,
      host: url.host,
      k: url.searchParams.get("k"),
    });
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": csp,
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex",
        "cache-control": "no-store",
      },
    });
  }

  const file = await resolveFile(env, spaceId, name, version, relUnderArtifact);
  if (!file) return notFound();

  const obj = await env.BLOBS.get(file.r2_key);
  if (!obj) return notFound();

  const headers = new Headers();
  headers.set("content-type", file.content_type);
  headers.set("content-length", String(file.bytes));
  // Untrusted-content protections (set as HTTP headers, not meta tags). The CSP
  // `sandbox` directive gives the document an opaque origin (no cookies/storage),
  // which is our PSL-free inter-artifact isolation. Cookies are also never set on
  // artifact responses (we build headers from scratch — nothing copied from R2).
  headers.set("content-security-policy", artifactCsp(`https://${url.host}`));
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-robots-tag", "noindex");
  headers.set("cache-control", "public, max-age=60");

  // Markdown is the one common agent output the browser can't render on its own
  // (`text/markdown` shows as raw text). Render it to a styled HTML document and
  // serve THAT under the same sandbox CSP / opaque origin. `?source=1` opts out
  // and returns the literal Markdown bytes (for copy / view-source).
  const wantsSource = url.searchParams.get("source") === "1";
  if (isMarkdownContentType(file.content_type) && !wantsSource) {
    const html = renderMarkdownDocument(await obj.text(), name);
    const bytes = new TextEncoder().encode(html);
    headers.set("content-type", "text/html; charset=utf-8");
    headers.set("content-length", String(bytes.byteLength));
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    return new Response(bytes, { status: 200, headers });
  }

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(obj.body, { status: 200, headers });
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Build the artifact list used by both the index page and /__list. */
async function buildArtifactList(env: Env, spaceId: string): Promise<SpacePageArtifact[]> {
  const rows = await listArtifacts(env, spaceId);
  const now = Date.now();
  const out: SpacePageArtifact[] = [];
  for (const a of rows) {
    if (isExpired(a.expires_at)) continue;
    const updatedAt = (await artifactUpdatedAt(env, a.id)) || a.created_at;
    out.push({ name: a.name, url: `/${a.name}`, updatedAt });
  }
  // Most recently updated first.
  out.sort((x, y) => y.updatedAt - x.updatedAt);
  void now;
  return out;
}
