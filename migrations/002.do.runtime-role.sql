-- Superusers bypass RLS entirely, so the service needs a role that is not one,
-- or every policy in migration 006 is silently inert.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'geo_app') THEN
    CREATE ROLE geo_app LOGIN PASSWORD 'geo_app';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO geo_app;
