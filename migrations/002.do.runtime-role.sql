-- Superusers bypass RLS entirely, so the service needs a role that is not one,
-- or every policy in migration 006 is silently inert.
DO $$
DECLARE
  runtime_user TEXT := coalesce(current_setting('geo.runtime_user', true), 'geo_app');
  runtime_pass TEXT := coalesce(current_setting('geo.runtime_password', true), 'geo_app');
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = runtime_user) THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', runtime_user, runtime_pass);
  ELSE
    -- Keeps the role in step with DB_PASS when it is rotated.
    EXECUTE format('ALTER ROLE %I PASSWORD %L', runtime_user, runtime_pass);
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', runtime_user);
END $$;
