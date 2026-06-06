import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateSpaceId, slugify } from "./util.js";

export const DEFAULT_API_BASE = "https://api.protocontent.com";

interface ConfigFile {
  token?: string;
  projectId?: string;
}

/** Resolve the configured API base, trimming any trailing slash. */
export function getApiBase(): string {
  const raw = process.env.PROTOCONTENT_API?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_API_BASE;
  return base.replace(/\/+$/, "");
}

function configDir(): string {
  return path.join(os.homedir(), ".protocontent");
}

function configPath(): string {
  return path.join(configDir(), "config.json");
}

async function readConfigFile(): Promise<ConfigFile | null> {
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as ConfigFile;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function writeConfigFile(cfg: ConfigFile): Promise<void> {
  const dir = configDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const data = JSON.stringify(cfg, null, 2) + "\n";
  // Write then chmod to guarantee 0600 even if umask interfered.
  await fs.writeFile(configPath(), data, { mode: 0o600 });
  try {
    await fs.chmod(configPath(), 0o600);
  } catch {
    // best effort — not all filesystems support chmod
  }
}

/**
 * Mint an anonymous project token via the public (no-auth) endpoint and
 * cache it to ~/.protocontent/config.json.
 */
async function mintAnonymousToken(
  apiBase: string
): Promise<{ token: string; projectId?: string }> {
  let res: Response;
  try {
    res = await fetch(`${apiBase}/v1/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  } catch (err) {
    throw new Error(
      `Could not reach protocontent API at ${apiBase} to create an anonymous project: ` +
        `${(err as Error).message}`
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Failed to mint anonymous project token (${res.status} ${res.statusText})` +
        (body ? `: ${body}` : "")
    );
  }
  const json = (await res.json()) as { token?: string; projectId?: string };
  if (!json.token) {
    throw new Error("Project endpoint did not return a token.");
  }
  const cfg: ConfigFile = { token: json.token, projectId: json.projectId };
  await writeConfigFile(cfg);
  return { token: json.token, projectId: json.projectId };
}

/**
 * Resolve the auth token, in priority order:
 *   1. env PROTOCONTENT_TOKEN
 *   2. ~/.protocontent/config.json
 *   3. mint a new anonymous token (and cache it)
 */
export async function resolveToken(apiBase: string): Promise<string> {
  const envToken = process.env.PROTOCONTENT_TOKEN?.trim();
  if (envToken) return envToken;

  const cfg = await readConfigFile();
  if (cfg?.token) return cfg.token;

  const minted = await mintAnonymousToken(apiBase);
  return minted.token;
}

/**
 * Compute the per-process space id and label.
 * Seeded deterministically from CLAUDE_SESSION_ID when present so the
 * space lines up with the agent's thread; otherwise random.
 */
export function computeSpace(): { spaceId: string; spaceLabel?: string } {
  const seed = process.env.CLAUDE_SESSION_ID?.trim();
  const spaceId = generateSpaceId(seed && seed.length > 0 ? seed : undefined);

  let spaceLabel: string | undefined;
  try {
    const base = path.basename(process.cwd());
    const label = slugify(base, "");
    spaceLabel = label.length > 0 ? label : undefined;
  } catch {
    spaceLabel = undefined;
  }

  return { spaceId, spaceLabel };
}

export interface BridgeConfig {
  apiBase: string;
  token: string;
  spaceId: string;
  spaceLabel?: string;
}

/** Build the full bridge config once at startup. */
export async function loadConfig(): Promise<BridgeConfig> {
  const apiBase = getApiBase();
  const token = await resolveToken(apiBase);
  const { spaceId, spaceLabel } = computeSpace();
  return { apiBase, token, spaceId, spaceLabel };
}
