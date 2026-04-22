DROP TABLE IF EXISTS restaurant_locations;

CREATE TABLE entity_locations (
    entity_id   TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    tenant_id   INT  NOT NULL,
    location    GEOMETRY(Point, 4326),
    is_active   BOOLEAN DEFAULT TRUE,
    PRIMARY KEY (entity_id, entity_type, tenant_id)
);

CREATE INDEX idx_entity_location ON entity_locations USING GIST (location);
CREATE INDEX idx_entity_tenant    ON entity_locations (tenant_id, entity_type);

CREATE TABLE zones (
    id          BIGINT PRIMARY KEY,
    entity_id   TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    tenant_id   INT  NOT NULL,
    zone        GEOMETRY(Polygon, 4326),
    is_active   BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_zone_geometry ON zones USING GIST (zone);
CREATE INDEX idx_zone_entity   ON zones (entity_id, entity_type, tenant_id);
