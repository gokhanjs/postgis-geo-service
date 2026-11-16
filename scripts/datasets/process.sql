-- Builds reference.provinces, reference.districts and reference.places from
-- the imported rows. Runs as one transaction; lengths are metres in EPSG:3035.

TRUNCATE reference.provinces, reference.districts, reference.places;

CREATE TEMP TABLE province_area ON COMMIT DROP AS
SELECT substr(iso3166_2, 4) AS code, name, iso3166_2, ST_Transform(geom, 3035) AS geom
  FROM reference.osm_boundaries
 WHERE osm_type = 'relation' AND admin_level = 4 AND iso3166_2 ~ '^TR-[0-9]{2}$';
CREATE INDEX ON province_area USING GIST (geom);

-- Closed ways at this level are coastline islets, not districts.
CREATE TEMP TABLE district_source ON COMMIT DROP AS
SELECT osm_id, name, wikidata, ST_Transform(geom, 3035) AS geom
  FROM reference.osm_boundaries
 WHERE osm_type = 'relation' AND admin_level = 6;
CREATE INDEX ON district_source USING GIST (geom);

-- An island mapped inside its district (Kara Ada in Bodrum) is not a district of its own.
DELETE FROM district_source inner_one
 USING district_source outer_one
 WHERE inner_one.osm_id <> outer_one.osm_id
   AND ST_Covers(outer_one.geom, inner_one.geom)
   AND ST_Area(outer_one.geom) > ST_Area(inner_one.geom);

-- The province comes from geometry: the OSM network tags disagree with it.
-- ST_Covers includes edges, so a point on one shared by two provinces takes the smaller code.
CREATE TEMP TABLE district_land ON COMMIT DROP AS
SELECT DISTINCT ON (d.osm_id)
       p.code || '-' || reference.slug(d.name) AS code, d.name, p.code AS province_code,
       d.wikidata, d.osm_id, d.geom, p.geom AS province_geom
  FROM district_source d
  JOIN province_area p ON ST_Covers(p.geom, ST_PointOnSurface(d.geom))
 ORDER BY d.osm_id, p.code;
CREATE INDEX ON district_land USING GIST (geom);

-- The buffer keeps only what no district covers inside the district's own
-- province, so it reaches over the sea but never across a land border.
CREATE TEMP TABLE district_extended ON COMMIT DROP AS
SELECT d.code, d.name, d.province_code, d.wikidata, d.osm_id,
       ST_Union(d.geom, ST_CollectionExtract(
         ST_Difference(ST_Intersection(reach.geom, d.province_geom), land.geom), 3)) AS geom
  FROM district_land d
 CROSS JOIN LATERAL (SELECT ST_Buffer(d.geom, 200) AS geom) reach
 CROSS JOIN LATERAL (
       SELECT ST_Union(o.geom) AS geom FROM district_land o WHERE ST_Intersects(o.geom, reach.geom)
     ) land;
CREATE INDEX ON district_extended USING GIST (geom);

-- Where two buffers meet over narrow water, the smaller code keeps the overlap.
CREATE TEMP TABLE district_resolved ON COMMIT DROP AS
SELECT d.code, d.name, d.province_code, d.wikidata, d.osm_id,
       COALESCE(ST_Difference(d.geom, smaller.geom), d.geom) AS geom
  FROM district_extended d
 CROSS JOIN LATERAL (
       SELECT ST_Union(o.geom) AS geom FROM district_extended o
        WHERE o.code < d.code AND ST_Intersects(o.geom, d.geom)
     ) smaller;

-- The coverage functions return SRID 0 (PostGIS 3.7.0), so it is set again.
CREATE TEMP TABLE district_clean ON COMMIT DROP AS
SELECT code, name, province_code, wikidata, osm_id,
       ST_SetSRID(ST_CoverageClean(geom) OVER (), 3035) AS geom
  FROM district_resolved;

CREATE TEMP TABLE district_simple ON COMMIT DROP AS
SELECT code, name, province_code, wikidata, osm_id,
       ST_SetSRID(ST_CoverageSimplify(geom, 50) OVER (), 3035) AS geom
  FROM district_clean;

INSERT INTO reference.districts (code, name, province_code, wikidata, osm_relation, geom)
SELECT code, name, province_code, wikidata, osm_id,
       ST_Multi(ST_ReducePrecision(ST_Transform(geom, 4326), 1e-5))
  FROM district_simple;

-- The province's own polygon runs out to its territorial waters; the published
-- one must cover exactly what its districts cover.
INSERT INTO reference.provinces (code, name, iso3166_2, geom)
SELECT p.code, p.name, p.iso3166_2, ST_Multi(ST_Union(d.geom))
  FROM province_area p
  JOIN reference.districts d ON d.province_code = p.code
 GROUP BY p.code, p.name, p.iso3166_2;

-- Points take their province from the polygon with the waters, so a pier head
-- beyond the 200 m buffer still has one.
INSERT INTO reference.places (code, type, name, province_code, geom)
SELECT DISTINCT ON (pl.osm_type, pl.osm_id)
       pl.type || ':' || left(pl.osm_type, 1) || pl.osm_id, pl.type, pl.name, p.code, pl.geom
  FROM reference.osm_places pl
  JOIN province_area p ON ST_Covers(p.geom, ST_Transform(pl.geom, 3035))
 ORDER BY pl.osm_type, pl.osm_id, p.code;

INSERT INTO reference.places (code, type, name, iata, icao, province_code, geom)
SELECT DISTINCT ON (a.ident) 'airport:' || a.ident, 'airport', a.name, a.iata, a.icao, p.code, a.geom
  FROM reference.airports a
  JOIN province_area p ON ST_Covers(p.geom, ST_Transform(a.geom, 3035))
 ORDER BY a.ident, p.code;
