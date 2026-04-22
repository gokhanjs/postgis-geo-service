CREATE TABLE collection_tokens (
    token      TEXT PRIMARY KEY,
    collection TEXT        NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
