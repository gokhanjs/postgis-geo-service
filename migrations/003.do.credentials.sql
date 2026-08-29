-- Credentials are stored as digests. A database read, whether a leaked backup
-- or an insider, then yields nothing that can be replayed against the API.
CREATE TABLE api_keys (
    key_hash     TEXT        PRIMARY KEY,
    key_prefix   TEXT        NOT NULL,
    tenant_id    INT         NOT NULL,
    project_name TEXT        NOT NULL,
    is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Listing keys shows the prefix, which is enough to tell them apart.
CREATE INDEX api_keys_prefix ON api_keys (key_prefix);

CREATE TABLE admin_tokens (
    token_hash TEXT        PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Resolving the tenant happens before RLS has anything to filter on.
GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys, admin_tokens TO geo_app;
