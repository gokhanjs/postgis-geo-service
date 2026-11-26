CREATE TABLE admin_tokens (
    token_hash TEXT        PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT ON admin_tokens TO geo_app;
GRANT INSERT, UPDATE ON api_keys TO geo_app;
