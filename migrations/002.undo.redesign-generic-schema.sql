DROP TABLE IF EXISTS zones;
DROP TABLE IF EXISTS entity_locations;

CREATE TABLE restaurant_locations (
    restaurant_id INT PRIMARY KEY,
    tenant_id     INT NOT NULL,
    location      GEOMETRY(Point, 4326),
    delivery_zone GEOMETRY(Polygon, 4326),
    is_active     BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_restaurant_location ON restaurant_locations USING GIST (location);
CREATE INDEX idx_restaurant_zone     ON restaurant_locations USING GIST (delivery_zone);
