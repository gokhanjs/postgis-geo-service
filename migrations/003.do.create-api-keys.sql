CREATE TABLE api_keys (
    key          TEXT PRIMARY KEY,
    tenant_id    INT  NOT NULL,
    project_name TEXT NOT NULL,
    is_active    BOOLEAN      DEFAULT TRUE,
    created_at   TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_api_keys_tenant ON api_keys (tenant_id);
