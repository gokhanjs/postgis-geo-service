-- Runs once, on first volume creation.
-- The postgis image already installs postgis into the default database;
-- btree_gist is what lets a single GiST index cover scalar + geometry columns.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;
