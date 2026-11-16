-- Under row-level security alone, PostGIS predicates (not LEAKPROOF) never reach the spatial index.
-- Through these views they do. Never set security_barrier on them: that alone restores the slow plan.
CREATE VIEW tenant_entity_locations AS
  SELECT * FROM entity_locations
  WHERE tenant_id = current_tenant_id()
  WITH CASCADED CHECK OPTION;

CREATE VIEW tenant_geofences AS
  SELECT * FROM geofences
  WHERE tenant_id = current_tenant_id()
  WITH CASCADED CHECK OPTION;

REVOKE ALL ON entity_locations, geofences FROM geo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_entity_locations, tenant_geofences TO geo_app;
