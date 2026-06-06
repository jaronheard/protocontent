// Control API for api.protocontent.com. Bearer-authenticated (except project
// minting). The bridge process calls these endpoints.

import type { Env, PublishInput } from "./types";
import {
  ApiError,
  createProject,
  projectForToken,
  getProject,
  getSpace,
  linkProjectGithub,
  countProjectSpaces,
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

/**
 * Notify the space's Durable Object so it broadcasts to live viewers. Sends the
 * affected artifact name + version so the DO can describe the change. Strictly
 * best-effort: never throws (a failed fanout must not fail a publish).
 */
async function notifySpace(
  env: Env,
  spaceId: string,
  artifact: { name: string; version?: number },
): Promise<void> {
  try {
    const id = env.SPACE.idFromName(spaceId);
    const stub = env.SPACE.get(id);
    await stub.fetch("https://do/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: artifact.name, version: artifact.version ?? 0 }),
    });
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

// --- CORS -------------------------------------------------------------------

const SESSION_COOKIE = "pc_session";
const SESSION_MAX_AGE = 2592000; // 30 days, in seconds.
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE * 1000;

/**
 * Is this an origin we trust for credentialed (cookie-bearing) requests?
 * Any *.protocontent.app artifact origin, plus the api/marketing origins.
 */
function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return (
    /^https:\/\/([a-z0-9-]+\.)?protocontent\.app$/.test(origin) ||
    origin === "https://api.protocontent.com" ||
    origin === "https://protocontent.com"
  );
}

/**
 * CORS headers for an API response. The bearer-token API keeps wildcard CORS;
 * the credentialed endpoints (/v1/me, /v1/auth/logout, /v1/claim) must echo the
 * exact request Origin and allow credentials (cookies). A wildcard origin is
 * never sent together with credentials (the browser would reject it).
 */
function corsHeaders(
  request: Request,
  { credentials }: { credentials?: boolean } = {},
): Record<string, string> {
  const origin = request.headers.get("origin") || request.headers.get("Origin");
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
  if (credentials && isAllowedOrigin(origin)) {
    headers["access-control-allow-origin"] = origin as string;
    headers["access-control-allow-credentials"] = "true";
    headers["vary"] = "Origin";
  } else {
    headers["access-control-allow-origin"] = "*";
  }
  return headers;
}

// --- Session cookie (stateless, HMAC-signed) --------------------------------

interface SessionPayload {
  uid: number;
  login: string;
  avatar: string;
  exp: number; // ms epoch
}

/** UTF-8 + url-safe base64 encode (no padding). */
function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Inverse of b64urlEncode → original UTF-8 string. */
function b64urlDecode(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Import the session HMAC key, derived from the (stable) GitHub client secret. */
async function sessionKey(env: Env): Promise<CryptoKey> {
  const secret = env.GITHUB_CLIENT_SECRET || "";
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** HMAC-SHA256 of a string with the session key, returned as url-safe base64. */
async function hmacB64url(message: string, env: Env): Promise<string> {
  const key = await sessionKey(env);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time string compare (avoid early-exit timing leaks). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Produce a signed `pc_session` token for a payload. */
async function signSession(payload: SessionPayload, env: Env): Promise<string> {
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = await hmacB64url(body, env);
  return `${body}.${sig}`;
}

/** Read the `pc_session` cookie value from a request, or null. */
function sessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie") || request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Verify the `pc_session` cookie: recompute the HMAC (constant-time compare)
 * and check expiry. Returns the identity, or null if absent/invalid/expired.
 */
async function verifySession(
  request: Request,
  env: Env,
): Promise<{ uid: number; login: string; avatar: string } | null> {
  const cookie = sessionCookie(request);
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = await hmacB64url(body, env);
  if (!timingSafeEqual(sig, expected)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(b64urlDecode(body)) as SessionPayload;
  } catch {
    return null;
  }
  if (
    typeof payload.uid !== "number" ||
    typeof payload.exp !== "number" ||
    payload.exp < Date.now()
  ) {
    return null;
  }
  return {
    uid: payload.uid,
    login: typeof payload.login === "string" ? payload.login : "",
    avatar: typeof payload.avatar === "string" ? payload.avatar : "",
  };
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

  // CORS preflight. Echo the origin + allow credentials for trusted origins so
  // preflight for the credentialed endpoints (/v1/me, /v1/auth/logout,
  // /v1/claim) succeeds; falls back to wildcard for the bearer-token API.
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(request, { credentials: true }),
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

    // Credentialed identity / session endpoints (cookie-authenticated; CORS
    // echoes the request origin for *.protocontent.app + the control origins).
    if (path === "/v1/me" && request.method === "GET") {
      return await handleMe(request, env);
    }
    if (path === "/v1/auth/logout" && request.method === "POST") {
      return await handleLogout(request, env);
    }
    if (path === "/v1/claim" && request.method === "POST") {
      return await handleClaim(request, env);
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
  ctx.waitUntil(notifySpace(env, spaceId, { name: body.name, version: result.version }));

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
  // Thread the popup flag through `state` so the callback knows whether to
  // postMessage+close (popup) or 302 back to the dashboard.
  const popup = url.searchParams.get("popup") === "1";
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", `${url.origin}/v1/auth/github/callback`);
  authorize.searchParams.set("scope", "read:user");
  authorize.searchParams.set("state", popup ? "popup" : "dashboard");
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
  const user = (await userRes.json()) as { id?: number; login?: string; avatar_url?: string };
  if (typeof user.id !== "number") return errorJson("github user fetch failed", 502);
  const login = (user.login || "unknown").replace(/[^a-zA-Z0-9_-]/g, "");
  const avatar = typeof user.avatar_url === "string" ? user.avatar_url : "";

  // Mint a stateless, signed session cookie on the api origin. Host-only (no
  // Domain) so it is NEVER sent to *.protocontent.app artifact origins; the
  // viewer badge reads identity via a credentialed GET /v1/me to this origin.
  const token = await signSession(
    { uid: user.id, login, avatar, exp: Date.now() + SESSION_MAX_AGE_MS },
    env,
  );
  const setCookie =
    `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${SESSION_MAX_AGE}`;

  const popup = new URL(request.url).searchParams.get("state") === "popup";
  if (popup) {
    return new Response(
      `<!doctype html><meta charset=utf-8><body style="font-family:system-ui;padding:3rem;max-width:32rem;margin:auto"><script>try{window.opener&&window.opener.postMessage({type:'protocontent-auth',ok:true},'*');}catch(e){}window.close();</script><h1>Signed in as ${login}</h1><p>You can close this window.</p></body>`,
      { headers: { "content-type": "text/html; charset=utf-8", "set-cookie": setCookie } },
    );
  }
  // Dashboard flow: cookie now set, bounce back to the control plane.
  return new Response(null, {
    status: 302,
    headers: { location: "https://api.protocontent.com/", "set-cookie": setCookie },
  });
}

/**
 * GET /v1/me?space=<spaceId> — credentialed identity probe for the viewer badge.
 * Signed out → all null/false. Signed in → login/avatar from the session, plus
 * ownership of `space`. The space's index token (k) + indexUrl are returned ONLY
 * to the owner; never to anyone else.
 */
async function handleMe(request: Request, env: Env): Promise<Response> {
  const headers = corsHeaders(request, { credentials: true });
  const session = await verifySession(request, env);
  const spaceId = new URL(request.url).searchParams.get("space");

  const body: {
    login: string | null;
    avatarUrl: string | null;
    ownsThisSpace: boolean;
    indexUrl: string | null;
    k: string | null;
  } = {
    login: session ? session.login || null : null,
    avatarUrl: session ? session.avatar || null : null,
    ownsThisSpace: false,
    indexUrl: null,
    k: null,
  };

  if (session && spaceId) {
    const space = await getSpace(env, spaceId);
    if (space) {
      const project = await getProject(env, space.project_id);
      if (project && project.github_user_id != null && project.github_user_id === session.uid) {
        body.ownsThisSpace = true;
        body.k = space.index_token ?? null;
        body.indexUrl = space.index_token
          ? `${spaceOrigin(spaceId)}/?k=${space.index_token}`
          : `${spaceOrigin(spaceId)}/`;
      }
    }
  }

  return json(body, 200, headers);
}

/** POST /v1/auth/logout — clear the session cookie. 204, credentialed CORS. */
async function handleLogout(request: Request, env: Env): Promise<Response> {
  void env;
  const headers = corsHeaders(request, { credentials: true });
  return new Response(null, {
    status: 204,
    headers: {
      ...headers,
      "set-cookie": `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None`,
    },
  });
}

/**
 * POST /v1/claim — link the signed-in GitHub identity to the bearer token's
 * project, so the owner can later claim its spaces via the cookie alone.
 * Requires BOTH a valid bearer token AND a valid pc_session cookie.
 */
async function handleClaim(request: Request, env: Env): Promise<Response> {
  const headers = corsHeaders(request, { credentials: true });
  // Bearer first (mirrors the rest of the API), then session.
  const { projectId } = await requireProject(request, env);
  const session = await verifySession(request, env);
  if (!session) {
    return json({ error: "sign in first" }, 401, headers);
  }
  await linkProjectGithub(env, projectId, {
    uid: session.uid,
    login: session.login,
    avatar: session.avatar,
  });
  const spaces = await countProjectSpaces(env, projectId);
  return json({ ok: true, spaces }, 200, headers);
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
  ctx.waitUntil(notifySpace(env, spaceId, { name, version: 0 }));
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
