import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateSpaceId, slugify, ensureGitignore } from "./util.js";

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

function spacesPath(): string {
  return path.join(configDir(), "spaces.json");
}

async function readSpaces(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(spacesPath(), "utf8");
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeSpaces(map: Record<string, string>): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true, mode: 0o700 });
  await fs.writeFile(spacesPath(), JSON.stringify(map, null, 2) + "\n", { mode: 0o600 });
  try {
    await fs.chmod(spacesPath(), 0o600);
  } catch {
    // best effort
  }
}

// A valid high-entropy space id: two words + a >=20-char base32 suffix.
const NEW_SPACE_ID = /^[a-z]+-[a-z]+-[a-z2-7]{20,}$/;

/**
 * Resolve the stable PROJECT ROOT for a directory: the top of its git repo,
 * shared across all worktrees of that repo, so the space stays the same whether
 * you run in the main checkout or any worktree.
 *
 * Walks up looking for `.git`. A `.git` directory means we found the repo root.
 * A `.git` *file* means this is a linked worktree — it points at
 * `<mainRoot>/.git/worktrees/<name>`, so we recover `<mainRoot>` from it.
 * Returns null if `startDir` is not inside a git repo.
 */
async function resolveProjectRoot(startDir: string): Promise<string | null> {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 40; i++) {
    const gitPath = path.join(dir, ".git");
    try {
      const stat = await fs.stat(gitPath);
      if (stat.isDirectory()) return dir;
      if (stat.isFile()) {
        // Linked worktree: ".git" is a file like "gitdir: /abs/.git/worktrees/x".
        try {
          const content = await fs.readFile(gitPath, "utf8");
          const m = content.match(/gitdir:\s*(.+)\s*$/m);
          if (m) {
            let gd = m[1].trim();
            if (!path.isAbsolute(gd)) gd = path.resolve(dir, gd);
            const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
            const idx = gd.indexOf(marker);
            if (idx >= 0) return gd.slice(0, idx); // the main repo root
          }
        } catch {
          // fall through to using this dir
        }
        return dir;
      }
    } catch {
      // no .git here — keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Compute the space id + label for this run.
 *
 * The space id is HIGH-ENTROPY RANDOM (~110 bits) — it's the capability that
 * grants access to a space, so it must be unguessable and is NEVER derived from
 * anything public.
 *
 * It is cached so the SAME space is reused across bridge restarts, subagents,
 * compaction, and resumed/renamed sessions — anything that would otherwise mint
 * a fresh slug and orphan the links already shared. The cache key, in priority
 * order:
 *   1. PROTOCONTENT_SPACE_ID — explicit pin (advanced; used verbatim).
 *   2. The git PROJECT ROOT (stable across worktrees of one repo).
 *   3. CLAUDE_PROJECT_DIR, else the current working directory.
 * The chosen id is persisted under that key in ~/.protocontent/spaces.json and a
 * valid cached id is never silently regenerated. (Legacy entries keyed by
 * CLAUDE_SESSION_ID are still honored and migrated to the project key.)
 */
export async function computeSpace(): Promise<{ spaceId: string; spaceLabel?: string }> {
  // 1. Explicit pin wins outright.
  const pinned = process.env.PROTOCONTENT_SPACE_ID?.trim();

  // 2/3. Resolve a stable project key.
  const startDir = process.env.CLAUDE_PROJECT_DIR?.trim() || process.cwd();
  const projectRoot = await resolveProjectRoot(startDir);
  const projectKey = projectRoot || startDir;

  let spaceId: string;
  if (pinned && pinned.length > 0) {
    spaceId = slugify(pinned, "");
    if (!spaceId) spaceId = generateSpaceId();
  } else {
    const map = await readSpaces();
    const sessionKey = process.env.CLAUDE_SESSION_ID?.trim();
    const fromProject = map[projectKey];
    const fromSession = sessionKey ? map[sessionKey] : undefined;
    if (fromProject && NEW_SPACE_ID.test(fromProject)) {
      spaceId = fromProject;
    } else if (fromSession && NEW_SPACE_ID.test(fromSession)) {
      // Migrate a legacy session-keyed space onto the durable project key.
      spaceId = fromSession;
      map[projectKey] = spaceId;
      await writeSpaces(map);
    } else {
      spaceId = generateSpaceId();
      map[projectKey] = spaceId;
      await writeSpaces(map);
    }
  }

  let spaceLabel: string | undefined;
  try {
    const label = slugify(path.basename(projectKey), "");
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
  const { spaceId, spaceLabel } = await computeSpace();
  // Keep ephemeral published artifacts out of git (best-effort, idempotent).
  await ensureGitignore(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  return { apiBase, token, spaceId, spaceLabel };
}
