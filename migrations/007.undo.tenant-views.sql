DROP VIEW IF EXISTS tenant_geofences;
DROP VIEW IF EXISTS tenant_entity_locations;

GRANT SELECT, INSERT, UPDATE, DELETE ON entity_locations, geofences TO geo_app;
