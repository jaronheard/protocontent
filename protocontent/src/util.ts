// Small dependency-free helpers: id generation, ttl parsing, slugify,
// content-type guessing, and token hashing.

/** Generate a random id (lowercase hex). */
export function genId(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a URL-safe random token (>= 32 chars). */
export function genToken(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  // base64url
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate a short, friendly space id (subdomain label). */
export function genSpaceId(): string {
  // 10 lowercase base36 chars — DNS-safe and short.
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  let s = n.toString(36);
  while (s.length < 10) s = "0" + s;
  return s.slice(0, 12);
}

/** SHA-256 hash of a token, hex-encoded. Only the hash is stored. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const TTL_MS: Record<string, number> = {
  "1h": 1 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/**
 * Parse a ttl string (1h|6h|1d|3d|7d|30d) into an absolute epoch-ms expiry.
 * Defaults to 7d when missing/invalid.
 */
export function ttlToExpiresAt(ttl: string | undefined, now = Date.now()): number {
  const ms = (ttl && TTL_MS[ttl]) || TTL_MS["7d"];
  return now + ms;
}

/** Turn an arbitrary name into a safe single URL path segment. */
export function slugify(input: string): string {
  const s = (input || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "")
    .replace(/-+/g, "-");
  return s || "artifact";
}

/** Decode base64 (standard, with or without padding) into bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const normalized = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(normalized);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode bytes as standard base64. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const EXT_CONTENT_TYPE: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  pdf: "application/pdf",
  wasm: "application/wasm",
  webmanifest: "application/manifest+json",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

/** Guess a content type from a relative path. Falls back to octet-stream. */
export function contentTypeFor(relPath: string): string {
  const dot = relPath.lastIndexOf(".");
  if (dot >= 0) {
    const ext = relPath.slice(dot + 1).toLowerCase();
    if (EXT_CONTENT_TYPE[ext]) return EXT_CONTENT_TYPE[ext];
  }
  return "application/octet-stream";
}

/** Normalize a relative path: strip leading slashes, collapse dot segments. */
export function normalizeRelPath(relPath: string): string {
  const parts = (relPath || "").replace(/^\/+/, "").split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      out.pop();
      continue;
    }
    out.push(p);
  }
  return out.join("/");
}

/** Human-friendly relative time, e.g. "3m ago", "in 2h". */
export function relativeTime(epochMs: number, now = Date.now()): string {
  const diff = epochMs - now;
  const past = diff < 0;
  const s = Math.round(Math.abs(diff) / 1000);
  const units: [number, string][] = [
    [60, "s"],
    [60, "m"],
    [24, "h"],
    [7, "d"],
    [4.345, "w"],
    [12, "mo"],
    [Number.POSITIVE_INFINITY, "y"],
  ];
  let value = s;
  let label = "s";
  for (let i = 0; i < units.length; i++) {
    const [size, name] = units[i];
    label = name;
    if (value < size) break;
    value = Math.floor(value / size);
  }
  const text = `${value}${label}`;
  if (value === 0 && label === "s") return "just now";
  return past ? `${text} ago` : `in ${text}`;
}

/** Standard JSON response with CORS for API/MCP consumers. */
export function json(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...extraHeaders,
    },
  });
}

/** Standard error JSON. */
export function errorJson(message: string, status = 400): Response {
  return json({ error: message }, status);
}
