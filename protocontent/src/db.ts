// D1 data-access helpers and the core publish/list/history/unpublish/keep
// logic shared by the HTTP API and the MCP fallback.

import type {
  Env,
  ProjectRow,
  SpaceRow,
  ArtifactRow,
  FileRow,
  PublishInput,
  PublishResult,
} from "./types";
import {
  genId,
  genToken,
  sha256Hex,
  ttlToExpiresAt,
  slugify,
  base64ToBytes,
  contentTypeFor,
  normalizeRelPath,
} from "./util";

const ROOT_DOMAIN = "protocontent.app"; // isolated content/artifact origin

export function spaceOrigin(spaceId: string): string {
  return `https://${spaceId}.${ROOT_DOMAIN}`;
}

// ---------------------------------------------------------------------------
// Projects + auth
// ---------------------------------------------------------------------------

/** Create an anonymous project and return { token, projectId }. */
export async function createProject(env: Env): Promise<{ token: string; projectId: string }> {
  const token = genToken(24); // ~32 url-safe chars
  const tokenHash = await sha256Hex(token);
  const projectId = genId();
  await env.DB.prepare(
    `INSERT INTO projects (id, token_hash, created_at) VALUES (?, ?, ?)`,
  )
    .bind(projectId, tokenHash, Date.now())
    .run();
  return { token, projectId };
}

/** Resolve a bearer token to its project, or null. */
export async function projectForToken(env: Env, token: string): Promise<ProjectRow | null> {
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT id, token_hash, created_at FROM projects WHERE token_hash = ?`,
  )
    .bind(tokenHash)
    .first<ProjectRow>();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

export async function getSpace(env: Env, spaceId: string): Promise<SpaceRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, project_id, label, created_at FROM spaces WHERE id = ?`,
    )
      .bind(spaceId)
      .first<SpaceRow>()) ?? null
  );
}

/**
 * Ensure a space exists and is owned by `projectId`. Creates it if new.
 * Throws if it exists but belongs to a different project.
 */
export async function ensureSpace(
  env: Env,
  spaceId: string,
  projectId: string,
  label?: string,
): Promise<SpaceRow> {
  const existing = await getSpace(env, spaceId);
  if (existing) {
    if (existing.project_id !== projectId) {
      throw new ApiError("space is owned by another project", 403);
    }
    if (label && label !== existing.label) {
      await env.DB.prepare(`UPDATE spaces SET label = ? WHERE id = ?`)
        .bind(label, spaceId)
        .run();
      existing.label = label;
    }
    return existing;
  }
  const row: SpaceRow = {
    id: spaceId,
    project_id: projectId,
    label: label ?? null,
    created_at: Date.now(),
  };
  await env.DB.prepare(
    `INSERT INTO spaces (id, project_id, label, created_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(row.id, row.project_id, row.label, row.created_at)
    .run();
  return row;
}

/** Assert a space exists and is owned by the project, returning it. */
export async function requireOwnedSpace(
  env: Env,
  spaceId: string,
  projectId: string,
): Promise<SpaceRow> {
  const space = await getSpace(env, spaceId);
  if (!space) throw new ApiError("space not found", 404);
  if (space.project_id !== projectId) throw new ApiError("forbidden", 403);
  return space;
}

// ---------------------------------------------------------------------------
// Artifacts + files
// ---------------------------------------------------------------------------

export async function getArtifact(
  env: Env,
  spaceId: string,
  name: string,
): Promise<ArtifactRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, space_id, name, entry, latest_version, expires_at, created_at
       FROM artifacts WHERE space_id = ? AND name = ?`,
    )
      .bind(spaceId, name)
      .first<ArtifactRow>()) ?? null
  );
}

export async function listArtifacts(env: Env, spaceId: string): Promise<ArtifactRow[]> {
  const res = await env.DB.prepare(
    `SELECT id, space_id, name, entry, latest_version, expires_at, created_at
     FROM artifacts WHERE space_id = ? ORDER BY created_at DESC`,
  )
    .bind(spaceId)
    .all<ArtifactRow>();
  return res.results ?? [];
}

/** Most recent file timestamp for an artifact (used for "updatedAt"). */
export async function artifactUpdatedAt(env: Env, artifactId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT MAX(created_at) AS at FROM files WHERE artifact_id = ?`,
  )
    .bind(artifactId)
    .first<{ at: number | null }>();
  return row?.at ?? 0;
}

export async function listVersions(
  env: Env,
  artifactId: string,
): Promise<{ version: number; at: number }[]> {
  const res = await env.DB.prepare(
    `SELECT version, MIN(created_at) AS at
     FROM files WHERE artifact_id = ?
     GROUP BY version ORDER BY version DESC`,
  )
    .bind(artifactId)
    .all<{ version: number; at: number }>();
  return res.results ?? [];
}

/**
 * Resolve a single file row for serving: artifact `name`, version (or latest),
 * and the requested relative path under the artifact.
 */
export async function resolveFile(
  env: Env,
  spaceId: string,
  name: string,
  version: number,
  relPath: string,
): Promise<FileRow | null> {
  const artifact = await getArtifact(env, spaceId, name);
  if (!artifact) return null;
  const wanted = normalizeRelPath(relPath) || artifact.entry || "index.html";
  return (
    (await env.DB.prepare(
      `SELECT id, artifact_id, version, rel_path, r2_key, content_type, bytes, created_at
       FROM files WHERE artifact_id = ? AND version = ? AND rel_path = ?`,
    )
      .bind(artifact.id, version, wanted)
      .first<FileRow>()) ?? null
  );
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Core publish logic (shared by HTTP API + MCP)
// ---------------------------------------------------------------------------

/**
 * Publish a new version of an artifact into a space. Caller must already have
 * verified ownership / created the space row. Stores files in R2, upserts D1
 * rows, bumps the version, and returns the public result payload.
 *
 * NOTE: this does NOT notify the Durable Object — callers do that so the DO
 * binding stays out of this module's responsibilities.
 */
export async function publishArtifact(
  env: Env,
  input: PublishInput,
): Promise<PublishResult & { artifactId: string }> {
  if (!input.files || input.files.length === 0) {
    throw new ApiError("files must contain at least one entry", 400);
  }
  const spaceId = input.spaceId;
  const name = slugify(input.name);
  const now = Date.now();

  // Determine entry. Folder => entry (default index.html). Single file => that file.
  let entry: string;
  if (input.files.length === 1) {
    entry = normalizeRelPath(input.files[0].relPath) || "index.html";
  } else {
    entry = normalizeRelPath(input.entry || "index.html") || "index.html";
  }

  // Compute next version.
  const existing = await getArtifact(env, spaceId, name);
  const version = (existing?.latest_version ?? 0) + 1;
  const artifactId = existing?.id ?? genId();
  const expiresAt = ttlToExpiresAt(input.ttl, now);

  // Write each file to R2.
  const fileRows: FileRow[] = [];
  for (const f of input.files) {
    const rel = normalizeRelPath(f.relPath);
    if (!rel) throw new ApiError(`invalid relPath: ${JSON.stringify(f.relPath)}`, 400);
    const bytes = base64ToBytes(f.contentBase64);
    const contentType = f.contentType || contentTypeFor(rel);
    const r2Key = `${spaceId}/${name}/v${version}/${rel}`;
    await env.BLOBS.put(r2Key, bytes, {
      httpMetadata: { contentType },
    });
    fileRows.push({
      id: genId(),
      artifact_id: artifactId,
      version,
      rel_path: rel,
      r2_key: r2Key,
      content_type: contentType,
      bytes: bytes.byteLength,
      created_at: now,
    });
  }

  // Upsert artifact + insert file rows via a batch.
  const statements: D1PreparedStatement[] = [];
  statements.push(
    env.DB.prepare(
      `INSERT INTO artifacts (id, space_id, name, entry, latest_version, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(space_id, name) DO UPDATE SET
         entry = excluded.entry,
         latest_version = excluded.latest_version,
         expires_at = excluded.expires_at`,
    ).bind(artifactId, spaceId, name, entry, version, expiresAt, existing?.created_at ?? now),
  );
  for (const fr of fileRows) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO files (id, artifact_id, version, rel_path, r2_key, content_type, bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        fr.id,
        fr.artifact_id,
        fr.version,
        fr.rel_path,
        fr.r2_key,
        fr.content_type,
        fr.bytes,
        fr.created_at,
      ),
    );
  }
  await env.DB.batch(statements);

  const url = `${spaceOrigin(spaceId)}/${name}`;
  const spaceUrl = `${spaceOrigin(spaceId)}/`;
  return {
    artifactId,
    url,
    spaceUrl,
    markdown: `[${name} ↗](${url})`,
    // editToken is the bearer token scoping edits to this project; the caller
    // supplies it (they already hold it). We surface a placeholder reference
    // here and let the API layer fill the real token in.
    editToken: "",
    expiresAt,
    version,
  };
}

/** Delete all R2 objects + file/artifact rows for an artifact. */
export async function unpublishArtifact(
  env: Env,
  spaceId: string,
  name: string,
): Promise<boolean> {
  const artifact = await getArtifact(env, spaceId, name);
  if (!artifact) return false;
  await deleteArtifactById(env, artifact.id);
  return true;
}

/** Internal: delete an artifact (and its files + R2 objects) by id. */
export async function deleteArtifactById(env: Env, artifactId: string): Promise<void> {
  const files = await env.DB.prepare(
    `SELECT r2_key FROM files WHERE artifact_id = ?`,
  )
    .bind(artifactId)
    .all<{ r2_key: string }>();
  const keys = (files.results ?? []).map((r) => r.r2_key);
  // R2 delete accepts up to 1000 keys per call.
  for (let i = 0; i < keys.length; i += 1000) {
    await env.BLOBS.delete(keys.slice(i, i + 1000));
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM files WHERE artifact_id = ?`).bind(artifactId),
    env.DB.prepare(`DELETE FROM artifacts WHERE id = ?`).bind(artifactId),
  ]);
}

/** Set expires_at = NULL (keep forever) for an artifact. */
export async function keepArtifact(env: Env, spaceId: string, name: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE artifacts SET expires_at = NULL WHERE space_id = ? AND name = ?`,
  )
    .bind(spaceId, name)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Cron sweep
// ---------------------------------------------------------------------------

/** Delete all expired artifacts (rows + R2). Returns count removed. */
export async function sweepExpired(env: Env, now = Date.now()): Promise<number> {
  const expired = await env.DB.prepare(
    `SELECT id FROM artifacts WHERE expires_at IS NOT NULL AND expires_at < ?`,
  )
    .bind(now)
    .all<{ id: string }>();
  const ids = (expired.results ?? []).map((r) => r.id);
  for (const id of ids) {
    await deleteArtifactById(env, id);
  }
  return ids.length;
}
