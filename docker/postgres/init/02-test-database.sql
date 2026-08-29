-- Dedicated database for the integration suite, so `pnpm test` never touches
-- the development data.
SELECT 'CREATE DATABASE geo_service_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'geo_service_test')\gexec

\connect geo_service_test
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;
