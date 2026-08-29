-- A tenant's identifier is unique only within that tenant; making it the
-- primary key let one tenant's first zone take over another's.
CREATE TABLE geofences (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_id BIGINT      NOT NULL,
    entity_id   TEXT        NOT NULL,
    entity_type TEXT        NOT NULL,
    tenant_id   INT         NOT NULL,
    area        geography(Polygon, 4326) NOT NULL,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT geofences_tenant_external_key UNIQUE (tenant_id, external_id),

    -- Invalid geometry stores fine and raises on read, and the read is a set
    -- query, so one bad row would break the endpoint for every other row.
    CONSTRAINT geofences_area_valid CHECK (ST_IsValid(area::geometry))
);

CREATE INDEX geofences_lookup ON geofences
    USING GIST (tenant_id, entity_type, area) WHERE is_active;

GRANT SELECT, INSERT, UPDATE, DELETE ON geofences TO geo_app;
