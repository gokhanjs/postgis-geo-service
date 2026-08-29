DROP POLICY IF EXISTS geofences_tenant_isolation ON geofences;
DROP POLICY IF EXISTS entity_locations_tenant_isolation ON entity_locations;

ALTER TABLE geofences        DISABLE ROW LEVEL SECURITY;
ALTER TABLE entity_locations DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS current_tenant_id();
