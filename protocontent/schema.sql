-- protocontent D1 schema.
-- Apply with: wrangler d1 execute protocontent --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  token_hash      TEXT UNIQUE,
  created_at      INTEGER,
  github_user_id  INTEGER,
  github_login    TEXT,
  github_avatar   TEXT
);

CREATE TABLE IF NOT EXISTS spaces (
  id          TEXT PRIMARY KEY,
  project_id  TEXT,
  label       TEXT,
  index_token TEXT,
  blocked     INTEGER DEFAULT 0,
  public_index INTEGER DEFAULT 0,
  created_at  INTEGER
);

CREATE TABLE IF NOT EXISTS artifacts (
  id              TEXT PRIMARY KEY,
  space_id        TEXT,
  name            TEXT,
  entry           TEXT,
  latest_version  INTEGER,
  expires_at      INTEGER,
  created_at      INTEGER,
  UNIQUE (space_id, name)
);

CREATE TABLE IF NOT EXISTS files (
  id            TEXT PRIMARY KEY,
  artifact_id   TEXT,
  version       INTEGER,
  rel_path      TEXT,
  r2_key        TEXT,
  content_type  TEXT,
  bytes         INTEGER,
  created_at    INTEGER
);

CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  space_id    TEXT,
  url         TEXT,
  reason      TEXT,
  ip          TEXT,
  created_at  INTEGER
);

-- Helpful indexes.
CREATE INDEX IF NOT EXISTS idx_projects_token_hash ON projects (token_hash);
CREATE INDEX IF NOT EXISTS idx_spaces_project_id   ON spaces (project_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_space_id  ON artifacts (space_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_expires   ON artifacts (expires_at);
CREATE INDEX IF NOT EXISTS idx_files_artifact_id   ON files (artifact_id);
CREATE INDEX IF NOT EXISTS idx_files_artifact_ver  ON files (artifact_id, version);

-- Migration (run once on existing DBs; ignore "duplicate column" errors):
-- ALTER TABLE projects ADD COLUMN github_user_id INTEGER;
-- ALTER TABLE projects ADD COLUMN github_login TEXT;
-- ALTER TABLE projects ADD COLUMN github_avatar TEXT;
