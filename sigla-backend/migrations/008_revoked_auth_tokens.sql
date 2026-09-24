-- Makes logout effective on the server for the full remaining lifetime of a
-- JWT. Only a SHA-256 hash is stored; bearer tokens themselves never enter the
-- database.

CREATE TABLE IF NOT EXISTS revoked_auth_tokens (
  id                BIGSERIAL PRIMARY KEY,
  token_hash        VARCHAR(64) NOT NULL UNIQUE,
  administrator_id INTEGER NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports periodic removal of entries after the corresponding JWT has
-- expired. The application performs this cleanup opportunistically on logout.
CREATE INDEX IF NOT EXISTS idx_revoked_auth_tokens_expires_at
  ON revoked_auth_tokens (expires_at);

COMMENT ON TABLE revoked_auth_tokens IS
  'SHA-256 hashes of JWTs invalidated by logout; rows are disposable after expires_at.';
