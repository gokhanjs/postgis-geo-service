-- geography, not geometry: the per-query cast the old schema needed is exactly
-- what stopped the GiST index from being usable.
CREATE TABLE entity_locations (
    entity_id   TEXT        NOT NULL,
    entity_type TEXT        NOT NULL,
    tenant_id   INT         NOT NULL,
    location    geography(Point, 4326) NOT NULL,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (entity_id, entity_type, tenant_id)
);

-- The only shape the read path asks for; the predicate keeps dead rows out.
CREATE INDEX entity_locations_lookup ON entity_locations
    USING GIST (tenant_id, entity_type, location) WHERE is_active;

GRANT SELECT, INSERT, UPDATE, DELETE ON entity_locations TO geo_app;
