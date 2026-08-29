CREATE EXTENSION IF NOT EXISTS postgis;

-- Lets one GiST index span scalar columns and a geometry column together,
-- which is what makes the tenant + type + area lookups single-index.
CREATE EXTENSION IF NOT EXISTS btree_gist;
