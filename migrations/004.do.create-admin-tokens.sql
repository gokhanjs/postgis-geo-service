CREATE TABLE admin_tokens (
    token      TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
