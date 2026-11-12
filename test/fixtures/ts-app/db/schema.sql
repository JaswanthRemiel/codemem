-- Schema for the fixture app. Not parsed structurally: indexed as line windows.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  owner_id TEXT REFERENCES users (id),
  payload TEXT NOT NULL
);
CREATE INDEX users_owner_idx ON users (owner_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  owner_id TEXT REFERENCES users (id),
  payload TEXT NOT NULL
);
CREATE INDEX sessions_owner_idx ON sessions (owner_id);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  owner_id TEXT REFERENCES users (id),
  payload TEXT NOT NULL
);
CREATE INDEX roles_owner_idx ON roles (owner_id);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  owner_id TEXT REFERENCES users (id),
  payload TEXT NOT NULL
);
CREATE INDEX audit_log_owner_idx ON audit_log (owner_id);

CREATE TABLE password_resets (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  owner_id TEXT REFERENCES users (id),
  payload TEXT NOT NULL
);
CREATE INDEX password_resets_owner_idx ON password_resets (owner_id);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  owner_id TEXT REFERENCES users (id),
  payload TEXT NOT NULL
);
CREATE INDEX api_tokens_owner_idx ON api_tokens (owner_id);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  owner_id TEXT REFERENCES users (id),
  payload TEXT NOT NULL
);
CREATE INDEX invitations_owner_idx ON invitations (owner_id);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  owner_id TEXT REFERENCES users (id),
  payload TEXT NOT NULL
);
CREATE INDEX teams_owner_idx ON teams (owner_id);

CREATE TABLE team_members (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  owner_id TEXT REFERENCES users (id),
  payload TEXT NOT NULL
);
CREATE INDEX team_members_owner_idx ON team_members (owner_id);
