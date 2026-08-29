-- Isolation as a database guarantee: a query that forgets its tenant predicate
-- returns nothing rather than another tenant's rows.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS INT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::INT;
$$;

ALTER TABLE entity_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE geofences        ENABLE ROW LEVEL SECURITY;

CREATE POLICY entity_locations_tenant_isolation ON entity_locations
  USING      (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY geofences_tenant_isolation ON geofences
  USING      (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
