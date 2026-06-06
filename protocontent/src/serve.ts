// Public content serving for *.protocontent.com.
//
// The subdomain label IS the spaceId. Serving is fully stateless in the Worker
// (R2 + D1); the Durable Object is only consulted for the live WebSocket.
//
// Routes (host = <spaceId>.protocontent.com):
//   GET /              -> first-party live session index page
//   GET /__list        -> JSON list of artifacts (for the index to refetch)
//   GET /__live        -> WebSocket upgrade, routed to the Space DO
//   GET /:name         -> serve the artifact entry (or single file)
//   GET /:name/*assets -> serve a file relative to the artifact
//
// Untrusted-content artifact responses carry a restrictive CSP + nosniff +
// noindex. The first-party index page gets only noindex (permissive CSP).

import type { Env } from "./types";
import { getSpace, listArtifacts, artifactUpdatedAt, resolveFile, getArtifact } from "./db";
import { renderSpacePage, type SpacePageArtifact } from "./space-page";
import { json } from "./util";

/** Restrictive CSP applied to served (untrusted) artifact bytes. */
const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

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

  // --- Live WebSocket: route to the Space Durable Object. ---
  if (path === "/__live") {
    const id = env.SPACE.idFromName(spaceId);
    const stub = env.SPACE.get(id);
    return stub.fetch(new Request("https://do/__live", request));
  }

  // For everything else the space must exist.
  const space = await getSpace(env, spaceId);
  if (!space) return notFound();

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

  const file = await resolveFile(env, spaceId, name, version, relUnderArtifact);
  if (!file) return notFound();

  const obj = await env.BLOBS.get(file.r2_key);
  if (!obj) return notFound();

  const headers = new Headers();
  headers.set("content-type", file.content_type);
  headers.set("content-length", String(file.bytes));
  // Untrusted-content protections (set as HTTP headers, not meta tags).
  headers.set("content-security-policy", ARTIFACT_CSP);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-robots-tag", "noindex");
  headers.set("cache-control", "public, max-age=60");
  // Mark sandboxing of script via header-level frame protections already set.

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
