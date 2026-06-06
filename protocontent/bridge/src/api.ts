import type { BridgeConfig } from "./config.js";

// --- HTTP contract types -----------------------------------------------------

export interface PublishFile {
  /** Path relative to the artifact root (POSIX, e.g. "assets/app.css"). */
  relPath: string;
  /** base64-encoded file contents. */
  contentBase64: string;
  /** MIME content type. */
  contentType: string;
}

export interface PublishRequest {
  spaceId: string;
  spaceLabel?: string;
  name: string;
  entry?: string;
  ttl?: string | number;
  files: PublishFile[];
}

export interface PublishResponse {
  url: string;
  spaceUrl: string;
  markdown: string;
  editToken: string;
  expiresAt: number | null;
  version: number;
}

export interface ListArtifact {
  name: string;
  url: string;
  expiresAt: number | null;
  version: number;
}

export interface ListResponse {
  artifacts: ListArtifact[];
}

export interface HistoryVersion {
  version: number;
  at: number;
  url: string;
}

export interface HistoryResponse {
  versions: HistoryVersion[];
}

export interface UnpublishResponse {
  ok: boolean;
}

export interface KeepResponse {
  expiresAt: number | null;
}

// --- low-level request helper -----------------------------------------------

class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  config: BridgeConfig,
  method: "GET" | "POST",
  pathName: string,
  body?: unknown
): Promise<T> {
  const url = `${config.apiBase}${pathName}`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.token}`,
    accept: "application/json",
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError(
      `Network error calling ${method} ${pathName}: ${(err as Error).message}`
    );
  }

  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      detail = parsed.error ?? parsed.message ?? text;
    } catch {
      // keep raw text
    }
    throw new ApiError(
      `${method} ${pathName} failed (${res.status} ${res.statusText})` +
        (detail ? `: ${detail}` : ""),
      res.status,
      text
    );
  }

  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(
      `${method} ${pathName} returned non-JSON response: ${text.slice(0, 200)}`
    );
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

// --- typed endpoint wrappers -------------------------------------------------

export async function publish(
  config: BridgeConfig,
  req: PublishRequest
): Promise<PublishResponse> {
  return request<PublishResponse>(config, "POST", "/v1/publish", req);
}

export async function listSpace(config: BridgeConfig): Promise<ListResponse> {
  return request<ListResponse>(
    config,
    "GET",
    `/v1/spaces/${enc(config.spaceId)}/list`
  );
}

export async function artifactHistory(
  config: BridgeConfig,
  name: string
): Promise<HistoryResponse> {
  return request<HistoryResponse>(
    config,
    "GET",
    `/v1/spaces/${enc(config.spaceId)}/artifacts/${enc(name)}/history`
  );
}

export async function unpublishArtifact(
  config: BridgeConfig,
  name: string
): Promise<UnpublishResponse> {
  return request<UnpublishResponse>(
    config,
    "POST",
    `/v1/spaces/${enc(config.spaceId)}/artifacts/${enc(name)}/unpublish`
  );
}

export async function keepArtifact(
  config: BridgeConfig,
  name: string
): Promise<KeepResponse> {
  return request<KeepResponse>(
    config,
    "POST",
    `/v1/spaces/${enc(config.spaceId)}/artifacts/${enc(name)}/keep`
  );
}

export { ApiError };
