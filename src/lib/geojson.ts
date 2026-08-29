export interface PolygonGeoJson {
  type: 'Polygon';
  coordinates: number[][][];
}

const LNG_MIN = -180;
const LNG_MAX = 180;
const LAT_MIN = -90;
const LAT_MAX = 90;

/** A linear ring needs four positions, since the last repeats the first. */
const MIN_RING_POSITIONS = 4;

/**
 * Checks a GeoJSON Polygon far enough that PostGIS will accept it.
 *
 * Returns the reason it was rejected, or null when it passes. Messages are
 * surfaced to clients verbatim, so they name the offending rule rather than
 * the internal check.
 */
export function validatePolygon(geojson: unknown): string | null {
  if (!isRecord(geojson) || geojson['type'] !== 'Polygon') {
    return 'geojson.type must be "Polygon"';
  }

  const coordinates = geojson['coordinates'];
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return 'geojson.coordinates must be a non-empty array';
  }

  for (const ring of coordinates) {
    if (!Array.isArray(ring) || ring.length < MIN_RING_POSITIONS) {
      return `Each polygon ring must have at least ${MIN_RING_POSITIONS} positions`;
    }

    for (const position of ring) {
      if (!isValidPosition(position)) {
        return 'Each position must be [longitude, latitude] with valid bounds';
      }
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidPosition(position: unknown): boolean {
  if (!Array.isArray(position) || position.length < 2) return false;

  const [lng, lat] = position;
  if (typeof lng !== 'number' || typeof lat !== 'number') return false;

  return lng >= LNG_MIN && lng <= LNG_MAX && lat >= LAT_MIN && lat <= LAT_MAX;
}
