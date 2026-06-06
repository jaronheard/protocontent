// Control API for api.protocontent.com. Bearer-authenticated (except project
// minting). The bridge process calls these endpoints.

import type { Env, PublishInput } from "./types";
import {
  ApiError,
  createProject,
  projectForToken,
  ensureSpace,
  requireOwnedSpace,
  publishArtifact,
  listArtifacts,
  getArtifact,
  listVersions,
  unpublishArtifact,
  keepArtifact,
  artifactUpdatedAt,
  spaceOrigin,
  setSpaceBlocked,
  insertReport,
  listProjectSpaces,
  setSpacePublicIndex,
} from "./db";
import { json, errorJson, slugify, genSpaceId } from "./util";
import { DASHBOARD_HTML } from "./dashboard";

/** Notify the space's Durable Object so it broadcasts to live viewers. */
async function notifySpace(env: Env, spaceId: string): Promise<void> {
  try {
    const id = env.SPACE.idFromName(spaceId);
    const stub = env.SPACE.get(id);
    await stub.fetch("https://do/notify", { method: "POST" });
  } catch {
    // Live fanout is best-effort; never fail a publish because of it.
  }
}

function bearer(request: Request): string | null {
  const h = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

/** Resolve the authenticated project or throw 401. */
async function requireProject(request: Request, env: Env): Promise<{ projectId: string; token: string }> {
  const token = bearer(request);
  if (!token) throw new ApiError("missing bearer token", 401);
  const project = await projectForToken(env, token);
  if (!project) throw new ApiError("invalid token", 401);
  return { projectId: project.id, token };
}

// --- Abuse limits ----------------------------------------------------------

const MAX_FILES = 500;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB per publish
const MAX_BODY_BYTES = 72 * 1024 * 1024; // request-body ceiling (base64 inflation headroom)

function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

/** Approximate decoded byte length of a base64 string. */
function b64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

/**
 * Coarse fixed-window rate limit backed by KV; returns true if allowed.
 * KV is eventually consistent so the cap is approximate — fine for abuse
 * mitigation. No-ops (allows) when the KV binding is absent.
 */
async function rateLimit(
  env: Env,
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  if (!env.RL) return true;
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${bucket}:${window}`;
  const current = parseInt((await env.RL.get(key)) || "0", 10);
  if (current >= limit) return false;
  await env.RL.put(key, String(current + 1), { expirationTtl: windowSec * 2 });
  return true;
}

export async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // CORS preflight.
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-max-age": "86400",
      },
    });
  }

  try {
    // First-party claim/manage dashboard on the control plane.
    if ((path === "/" || path === "/app") && request.method === "GET") {
      return new Response(DASHBOARD_HTML, {
        headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" },
      });
    }

    // GET /v1/spaces (auth) -> all spaces owned by this project.
    if (path === "/v1/spaces" && request.method === "GET") {
      return await handleProjectSpaces(request, env);
    }

    // GitHub OAuth (secret-gated opt-in).
    if (path === "/v1/auth/github" && request.method === "GET") {
      return await handleAuthGithub(request, env);
    }
    if (path === "/v1/auth/github/callback" && request.method === "GET") {
      return await handleAuthGithubCallback(request, env);
    }

    // 1. POST /v1/projects (no auth) -> mint anonymous project + token.
    if (path === "/v1/projects" && request.method === "POST") {
      if (!(await rateLimit(env, `proj:${clientIp(request)}`, 30, 3600))) {
        return errorJson("rate limit exceeded — try again later", 429);
      }
      const { token, projectId } = await createProject(env);
      return json({ token, projectId }, 201);
    }

    // 2. POST /v1/publish (auth)
    if (path === "/v1/publish" && request.method === "POST") {
      if (!(await rateLimit(env, `pub:${clientIp(request)}`, 240, 60))) {
        return errorJson("rate limit exceeded — slow down", 429);
      }
      return await handlePublish(request, env, ctx);
    }

    // POST /v1/report (public) -> record an abuse report.
    if (path === "/v1/report" && request.method === "POST") {
      if (!(await rateLimit(env, `report:${clientIp(request)}`, 20, 3600))) {
        return errorJson("rate limit exceeded", 429);
      }
      return await handleReport(request, env);
    }

    // POST /v1/admin/block (admin secret) -> moderation kill switch.
    if (path === "/v1/admin/block" && request.method === "POST") {
      return await handleAdminBlock(request, env);
    }

    // /v1/spaces/:spaceId/...
    const spacesMatch = /^\/v1\/spaces\/([^/]+)(\/.*)?$/.exec(path);
    if (spacesMatch) {
      const spaceId = decodeURIComponent(spacesMatch[1]);
      const rest = spacesMatch[2] || "";

      // 3. GET /v1/spaces/:spaceId/list
      if (rest === "/list" && request.method === "GET") {
        return await handleList(request, env, spaceId);
      }
      if (rest === "/public" && request.method === "POST") {
        return await handleSetPublic(request, env, spaceId);
      }

      // /v1/spaces/:spaceId/artifacts/:name/...
      const artMatch = /^\/artifacts\/([^/]+)(\/.*)?$/.exec(rest);
      if (artMatch) {
        const name = slugify(decodeURIComponent(artMatch[1]));
        const action = artMatch[2] || "";

        // 4. GET .../history
        if (action === "/history" && request.method === "GET") {
          return await handleHistory(request, env, spaceId, name);
        }
        // 5. POST .../unpublish
        if (action === "/unpublish" && request.method === "POST") {
          return await handleUnpublish(request, env, spaceId, name, ctx);
        }
        // 6. POST .../keep
        if (action === "/keep" && request.method === "POST") {
          return await handleKeep(request, env, spaceId, name);
        }
      }
    }

    return errorJson("not found", 404);
  } catch (err) {
    if (err instanceof ApiError) return errorJson(err.message, err.status);
    const message = err instanceof Error ? err.message : "internal error";
    return errorJson(message, 500);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handlePublish(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { projectId, token } = await requireProject(request, env);
  const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_BODY_BYTES) throw new ApiError("request body too large", 413);
  const body = (await request.json().catch(() => null)) as Partial<PublishInput> | null;
  if (!body || typeof body !== "object") throw new ApiError("invalid JSON body", 400);
  if (!body.name || typeof body.name !== "string") throw new ApiError("name is required", 400);
  if (!Array.isArray(body.files) || body.files.length === 0) {
    throw new ApiError("files[] is required", 400);
  }
  if (body.files.length > MAX_FILES) {
    throw new ApiError(`too many files (max ${MAX_FILES})`, 413);
  }
  let totalBytes = 0;
  for (const f of body.files) {
    const n = b64Bytes(typeof f.contentBase64 === "string" ? f.contentBase64 : "");
    if (n > MAX_FILE_BYTES) throw new ApiError("a file exceeds the 25 MB per-file limit", 413);
    totalBytes += n;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new ApiError("publish exceeds the 50 MB total limit", 413);
  }

  // spaceId defaults to a freshly generated label if not supplied.
  const spaceId = (body.spaceId && String(body.spaceId)) || genSpaceId();

  // Create or verify the space (owned by this token's project).
  const space = await ensureSpace(env, spaceId, projectId, body.spaceLabel);

  const result = await publishArtifact(env, {
    spaceId,
    spaceLabel: body.spaceLabel,
    name: body.name,
    entry: body.entry,
    ttl: body.ttl,
    files: body.files,
  });

  // Notify live viewers in the background — don't block the publish response on
  // a cold Durable Object wake-up (~700ms on first hit to an idle space).
  ctx.waitUntil(notifySpace(env, spaceId));

  // The editToken IS the bearer token the caller already holds (scopes edits
  // to this project). Surface it for convenience.
  // The session index is private: surface it with its ?k token so the owner can
  // open the live thread page. Individual artifact links (result.url) stay open.
  const spaceUrl = space.index_token
    ? `${spaceOrigin(spaceId)}/?k=${space.index_token}`
    : result.spaceUrl;

  return json(
    {
      url: result.url,
      spaceUrl,
      markdown: result.markdown,
      editToken: token,
      expiresAt: result.expiresAt,
      version: result.version,
    },
    200,
  );
}

async function handleList(request: Request, env: Env, spaceId: string): Promise<Response> {
  const { projectId } = await requireProject(request, env);
  const space = await requireOwnedSpace(env, spaceId, projectId);
  const rows = await listArtifacts(env, spaceId);
  const origin = spaceOrigin(spaceId);
  const artifacts = rows.map((a) => ({
    name: a.name,
    url: `${origin}/${a.name}`,
    expiresAt: a.expires_at,
    version: a.latest_version,
  }));
  const spaceUrl = space.index_token ? `${origin}/?k=${space.index_token}` : `${origin}/`;
  return json({ artifacts, spaceUrl });
}

async function handleReport(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { url?: string; spaceId?: string; reason?: string }
    | null;
  if (!body || (!body.url && !body.spaceId)) {
    throw new ApiError("url or spaceId required", 400);
  }
  let spaceId = body.spaceId ? String(body.spaceId) : "";
  const url = body.url ? String(body.url).slice(0, 500) : "";
  if (!spaceId && url) {
    try {
      spaceId = new URL(url).hostname.split(".")[0];
    } catch {
      // ignore unparseable urls
    }
  }
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 2000) : "";
  await insertReport(env, { spaceId, url, reason, ip: clientIp(request) });
  console.log("[report]", JSON.stringify({ spaceId, url, reason: reason.slice(0, 200) }));
  return json({ ok: true });
}

async function handleAdminBlock(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_TOKEN) return errorJson("admin not configured", 503);
  const auth = bearer(request);
  if (!auth || auth !== env.ADMIN_TOKEN) return errorJson("forbidden", 403);
  const body = (await request.json().catch(() => null)) as
    | { spaceId?: string; blocked?: boolean }
    | null;
  if (!body?.spaceId) throw new ApiError("spaceId required", 400);
  const blocked = body.blocked !== false; // default: block
  const ok = await setSpaceBlocked(env, String(body.spaceId), blocked);
  if (!ok) throw new ApiError("space not found", 404);
  return json({ ok: true, spaceId: body.spaceId, blocked });
}

async function handleProjectSpaces(request: Request, env: Env): Promise<Response> {
  const { projectId } = await requireProject(request, env);
  const rows = await listProjectSpaces(env, projectId);
  const spaces = rows.map((s) => ({
    id: s.id,
    label: s.label,
    artifactCount: s.count,
    blocked: !!s.blocked,
    url: s.index_token ? `${spaceOrigin(s.id)}/?k=${s.index_token}` : `${spaceOrigin(s.id)}/`,
    createdAt: s.created_at,
  }));
  return json({ spaces });
}

async function handleSetPublic(request: Request, env: Env, spaceId: string): Promise<Response> {
  const { projectId } = await requireProject(request, env);
  await requireOwnedSpace(env, spaceId, projectId);
  const body = (await request.json().catch(() => null)) as { public?: boolean } | null;
  const pub = body?.public !== false; // default: make the index public
  await setSpacePublicIndex(env, spaceId, pub);
  return json({ ok: true, spaceId, publicIndex: pub });
}

async function handleAuthGithub(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return errorJson("sign-in not configured", 503);
  }
  const url = new URL(request.url);
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", `${url.origin}/v1/auth/github/callback`);
  authorize.searchParams.set("scope", "read:user");
  return Response.redirect(authorize.toString(), 302);
}

async function handleAuthGithubCallback(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return errorJson("sign-in not configured", 503);
  }
  const code = new URL(request.url).searchParams.get("code");
  if (!code) return errorJson("missing code", 400);
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) return errorJson("github token exchange failed", 502);
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${tokenJson.access_token}`,
      "user-agent": "protocontent",
      accept: "application/vnd.github+json",
    },
  });
  const user = (await userRes.json()) as { login?: string };
  const login = (user.login || "unknown").replace(/[^a-zA-Z0-9_-]/g, "");
  // TODO: link this GitHub identity to a project to claim its spaces.
  return new Response(
    `<!doctype html><meta charset=utf-8><body style="font-family:system-ui;padding:3rem;max-width:32rem;margin:auto"><h1>Signed in as ${login}</h1><p>GitHub sign-in is wired up. Linking your identity to a project (to claim spaces without pasting a token) is the next step.</p><p><a href="/">&larr; back to the dashboard</a></p></body>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function handleHistory(
  request: Request,
  env: Env,
  spaceId: string,
  name: string,
): Promise<Response> {
  const { projectId } = await requireProject(request, env);
  await requireOwnedSpace(env, spaceId, projectId);
  const artifact = await getArtifact(env, spaceId, name);
  if (!artifact) throw new ApiError("artifact not found", 404);
  const origin = spaceOrigin(spaceId);
  const versions = (await listVersions(env, artifact.id)).map((v) => ({
    version: v.version,
    at: v.at,
    url: `${origin}/${name}?v=${v.version}`,
  }));
  return json({ versions });
}

async function handleUnpublish(
  request: Request,
  env: Env,
  spaceId: string,
  name: string,
  ctx: ExecutionContext,
): Promise<Response> {
  const { projectId } = await requireProject(request, env);
  await requireOwnedSpace(env, spaceId, projectId);
  const ok = await unpublishArtifact(env, spaceId, name);
  if (!ok) throw new ApiError("artifact not found", 404);
  ctx.waitUntil(notifySpace(env, spaceId));
  return json({ ok: true });
}

async function handleKeep(
  request: Request,
  env: Env,
  spaceId: string,
  name: string,
): Promise<Response> {
  const { projectId } = await requireProject(request, env);
  await requireOwnedSpace(env, spaceId, projectId);
  const ok = await keepArtifact(env, spaceId, name);
  if (!ok) throw new ApiError("artifact not found", 404);
  void artifactUpdatedAt; // (kept available; not needed here)
  return json({ expiresAt: null });
}
