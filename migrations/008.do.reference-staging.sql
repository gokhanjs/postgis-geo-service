-- Working tables of the reference dataset pipeline. The service serves the
-- exported files, never these tables, so the runtime role gets no grant here.
CREATE SCHEMA reference;

-- Codes are stored by consumers, so this must never change for an existing name.
-- Turkish capitals are mapped before lower(), which turns İ into i plus a combining dot.
CREATE FUNCTION reference.slug(name TEXT) RETURNS TEXT
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT trim(BOTH '-' FROM regexp_replace(
    translate(lower(translate(name, 'İIÇĞÖŞÜÂÎÛ', 'iicgosuaiu')), 'çğıöşüâîû', 'cgiosuaiu'),
    '[^a-z0-9]+', '-', 'g'))
$$;

CREATE TABLE reference.osm_boundaries (
    osm_type    TEXT     NOT NULL CHECK (osm_type IN ('way', 'relation')),
    osm_id      BIGINT   NOT NULL,
    admin_level SMALLINT NOT NULL,
    name        TEXT     NOT NULL,
    iso3166_2   TEXT,
    wikidata    TEXT,
    geom        geometry(MultiPolygon, 4326) NOT NULL,
    PRIMARY KEY (osm_type, osm_id)
);

CREATE TABLE reference.osm_places (
    osm_type TEXT   NOT NULL CHECK (osm_type IN ('node', 'way', 'relation')),
    osm_id   BIGINT NOT NULL,
    type     TEXT   NOT NULL CHECK (type IN ('port', 'station')),
    name     TEXT   NOT NULL,
    geom     geometry(Point, 4326) NOT NULL,
    PRIMARY KEY (osm_type, osm_id)
);

CREATE TABLE reference.airports (
    ident      TEXT PRIMARY KEY,
    iata       TEXT,
    icao       TEXT,
    name       TEXT NOT NULL,
    iso_region TEXT,
    geom       geometry(Point, 4326) NOT NULL
);

CREATE TABLE reference.provinces (
    code      TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    iso3166_2 TEXT NOT NULL UNIQUE,
    geom      geometry(MultiPolygon, 4326) NOT NULL
);

CREATE TABLE reference.districts (
    code          TEXT   PRIMARY KEY,
    name          TEXT   NOT NULL,
    province_code TEXT   NOT NULL,
    wikidata      TEXT,
    osm_relation  BIGINT NOT NULL,
    geom          geometry(MultiPolygon, 4326) NOT NULL
);

CREATE TABLE reference.places (
    code          TEXT PRIMARY KEY,
    type          TEXT NOT NULL CHECK (type IN ('airport', 'port', 'station')),
    name          TEXT NOT NULL,
    iata          TEXT,
    icao          TEXT,
    province_code TEXT NOT NULL,
    geom          geometry(Point, 4326) NOT NULL
);

CREATE INDEX osm_boundaries_geom ON reference.osm_boundaries USING GIST (geom);
