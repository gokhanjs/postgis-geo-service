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

-- Geography leads: with scalars first, whether the spatial predicate reaches
-- the index depends on row estimates, and on some distributions it does not.
CREATE INDEX entity_locations_lookup ON entity_locations
    USING GIST (location, tenant_id, entity_type) WHERE is_active;

-- Owned here rather than by each write path, so it cannot be forgotten.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

CREATE TRIGGER entity_locations_touch
  BEFORE UPDATE ON entity_locations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON entity_locations TO geo_app;
