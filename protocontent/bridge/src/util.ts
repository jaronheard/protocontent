import { randomBytes, randomInt } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

/**
 * Map of file extensions (without leading dot) to MIME content types.
 * Small, hand-picked list covering the common cases an agent publishes.
 */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  cjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  wasm: "application/wasm",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
  avif: "image/avif",
  bmp: "image/bmp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/** Detect a content type from a file name / path using its extension. */
export function contentTypeFromName(name: string): string {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (!ext) return DEFAULT_CONTENT_TYPE;
  return CONTENT_TYPE_BY_EXT[ext] ?? DEFAULT_CONTENT_TYPE;
}

/**
 * Turn an arbitrary string into a DNS/URL-safe slug.
 * Lowercases, replaces runs of non-alphanumerics with single hyphens,
 * trims leading/trailing hyphens. Falls back to "page" when empty.
 */
export function slugify(input: string, fallback = "page"): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || fallback;
}

/**
 * Slugify a file basename, dropping its extension first so that
 * "My Plan.html" -> "my-plan".
 */
export function slugifyBasename(fileName: string, fallback = "page"): string {
  const base = path.basename(fileName, path.extname(fileName));
  return slugify(base || fileName, fallback);
}

// --- space-id generation ----------------------------------------------------

const ADJECTIVES = [
  "amber", "azure", "brave", "calm", "clever", "coral", "crimson", "dawn",
  "eager", "ember", "fancy", "fleet", "gentle", "golden", "happy", "hazel",
  "indigo", "ivory", "jade", "jolly", "keen", "lively", "lunar", "maple",
  "mellow", "mint", "misty", "noble", "ocean", "olive", "opal", "pearl",
  "plum", "proud", "quiet", "rapid", "royal", "ruby", "sage", "scarlet",
  "shy", "silent", "silver", "solar", "spry", "starry", "sunny", "swift",
  "teal", "tidal", "topaz", "vivid", "warm", "wild", "wise", "zesty",
];

const NOUNS = [
  "canyon", "harbor", "meadow", "summit", "river", "forest", "valley", "ridge",
  "glade", "haven", "isle", "lagoon", "marsh", "oasis", "prairie", "reef",
  "tundra", "delta", "dune", "fjord", "geyser", "grove", "knoll", "mesa",
  "cove", "bay", "creek", "falls", "glen", "moor", "peak", "shore",
  "spring", "thicket", "vista", "wharf", "willow", "cedar", "birch", "aspen",
  "comet", "ember", "falcon", "heron", "lynx", "otter", "raven", "sparrow",
  "beacon", "compass", "lantern", "anchor", "pebble", "ripple", "breeze", "echo",
];

const B32 = "abcdefghijklmnopqrstuvwxyz234567";

/** A cryptographically-random DNS-safe token of `len` base32 chars (~5 bits each). */
function randomToken(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += B32[bytes[i] & 31];
  return out;
}

/**
 * Generate a DNS-safe space id like `quiet-harbor-3kf9q…` — two random words
 * for a little readability, plus a 22-char crypto-random suffix (~110 bits).
 *
 * The id is the capability that grants access to a space, so it must be
 * UNGUESSABLE and is never derived from anything public (e.g. the agent session
 * id). Per-thread stability is handled by caching this random id in
 * ~/.protocontent/spaces.json (see config.ts), NOT by seeding it.
 */
export function generateSpaceId(): string {
  const adj = ADJECTIVES[randomInt(ADJECTIVES.length)];
  const noun = NOUNS[randomInt(NOUNS.length)];
  return `${adj}-${noun}-${randomToken(22)}`;
}

// --- directory walk ---------------------------------------------------------

export interface WalkedFile {
  /** Absolute path on disk. */
  absPath: string;
  /** POSIX-style path relative to the walk root. */
  relPath: string;
  /** Size in bytes. */
  size: number;
}

export interface WalkOptions {
  /** Skip dot-files and dot-directories (default true). */
  skipDotfiles?: boolean;
  /** Directory names to always skip. */
  skipDirs?: Set<string>;
  /** Abort once this many files have been collected. */
  maxFiles: number;
  /** Abort once total collected bytes exceed this. */
  maxTotalBytes: number;
}

const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".cache",
  "dist",
  ".next",
  ".turbo",
]);

/**
 * Recursively walk `root`, returning files with POSIX-relative paths.
 * Enforces file-count and total-byte ceilings, throwing a clear error
 * if either is exceeded (a safety rail against absurd uploads).
 */
export async function walkDir(
  root: string,
  options: WalkOptions
): Promise<WalkedFile[]> {
  const skipDotfiles = options.skipDotfiles ?? true;
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  const out: WalkedFile[] = [];
  let totalBytes = 0;

  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const name = entry.name;
      if (skipDotfiles && name.startsWith(".")) continue;
      const abs = path.join(dir, name);

      if (entry.isDirectory()) {
        if (skipDirs.has(name)) continue;
        await recurse(abs);
      } else if (entry.isFile()) {
        const stat = await fs.stat(abs);
        out.push({
          absPath: abs,
          relPath: path.relative(root, abs).split(path.sep).join("/"),
          size: stat.size,
        });
        totalBytes += stat.size;
        if (out.length > options.maxFiles) {
          throw new Error(
            `Folder has more than ${options.maxFiles} files — too large to publish in one call. ` +
              `Publish a smaller subfolder or split it up.`
          );
        }
        if (totalBytes > options.maxTotalBytes) {
          throw new Error(
            `Folder exceeds the ${formatBytes(options.maxTotalBytes)} upload ceiling. ` +
              `Publish a smaller subfolder or split it up.`
          );
        }
      }
      // symlinks and other special entries are ignored
    }
  }

  await recurse(root);
  return out;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- gitignore convention ---------------------------------------------------

/**
 * Best-effort: if `startDir` is inside a git repo, ensure `.protocontent/` is
 * listed in the repo's .gitignore. protocontent artifacts are ephemeral — you
 * publish them to a URL, you don't commit them — so staging them under
 * `.protocontent/` keeps them out of version control automatically.
 *
 * Idempotent; silent on any failure; opt out with PROTOCONTENT_NO_GITIGNORE=1.
 */
export async function ensureGitignore(startDir: string = process.cwd()): Promise<void> {
  if (process.env.PROTOCONTENT_NO_GITIGNORE) return;
  try {
    // Walk up to the repo root (a directory containing .git).
    let dir = path.resolve(startDir);
    let root: string | null = null;
    for (let i = 0; i < 40; i++) {
      try {
        await fs.stat(path.join(dir, ".git"));
        root = dir;
        break;
      } catch {
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    if (!root) return; // not inside a git repo — nothing to do

    const giPath = path.join(root, ".gitignore");
    let content = "";
    try {
      content = await fs.readFile(giPath, "utf8");
    } catch {
      // no .gitignore yet — appendFile will create it
    }
    const alreadyIgnored = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .some((l) => l === ".protocontent/" || l === ".protocontent");
    if (alreadyIgnored) return;

    const sep = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    const block = `${sep}\n# protocontent — ephemeral published artifacts (not source)\n.protocontent/\n`;
    await fs.appendFile(giPath, block);
  } catch {
    // best effort — never fail a publish over this
  }
}
