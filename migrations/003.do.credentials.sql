CREATE TABLE api_keys (
    key          TEXT        PRIMARY KEY,
    tenant_id    INT         NOT NULL,
    project_name TEXT        NOT NULL,
    is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE admin_tokens (
    token      TEXT        PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE collection_tokens (
    token      TEXT        PRIMARY KEY,
    collection TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX collection_tokens_expiry ON collection_tokens (expires_at);

-- Resolving the tenant happens before RLS has anything to filter on.
GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys, admin_tokens, collection_tokens TO geo_app;
