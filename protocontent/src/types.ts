// Shared environment + row types.

import type { Space } from "./space";
import type { ProtoMcpAgent } from "./mcp";

export interface Env {
  BLOBS: R2Bucket;
  DB: D1Database;
  SPACE: DurableObjectNamespace<Space>;
  MCP_OBJECT: DurableObjectNamespace<ProtoMcpAgent>;
  /** KV for coarse rate limiting (fixed-window counters). Optional. */
  RL?: KVNamespace;
  /** Admin token for the moderation kill switch (Wrangler secret). Optional. */
  ADMIN_TOKEN?: string;
  /** GitHub OAuth app credentials (Wrangler secrets) — sign-in opt-in. */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

export interface ProjectRow {
  id: string;
  token_hash: string;
  created_at: number;
  github_user_id?: number | null;
  github_login?: string | null;
  github_avatar?: string | null;
}

export interface SpaceRow {
  id: string;
  project_id: string;
  label: string | null;
  index_token: string | null;
  blocked: number | null;
  public_index: number | null;
  created_at: number;
}

export interface ArtifactRow {
  id: string;
  space_id: string;
  name: string;
  entry: string | null;
  latest_version: number;
  expires_at: number | null;
  created_at: number;
}

export interface FileRow {
  id: string;
  artifact_id: string;
  version: number;
  rel_path: string;
  r2_key: string;
  content_type: string;
  bytes: number;
  created_at: number;
}

export interface PublishFileInput {
  relPath: string;
  contentBase64: string;
  contentType?: string;
}

export interface PublishInput {
  spaceId: string;
  spaceLabel?: string;
  name: string;
  entry?: string;
  ttl?: string;
  files: PublishFileInput[];
}

export interface PublishResult {
  url: string;
  spaceUrl: string;
  markdown: string;
  editToken: string;
  expiresAt: number | null;
  version: number;
}
