export interface PolygonGeoJson {
  type: 'Polygon';
  coordinates: number[][][];
}

export type PolygonValidation =
  { ok: true; polygon: PolygonGeoJson } | { ok: false; reason: string };

const LNG_MIN = -180;
const LNG_MAX = 180;
const LAT_MIN = -90;
const LAT_MAX = 90;

/** A linear ring needs four positions, since the last repeats the first. */
const MIN_RING_POSITIONS = 4;

/**
 * Validates a GeoJSON Polygon, returning the narrowed value so that passing
 * this check is the only way to obtain a PolygonGeoJson. Reasons reach clients.
 */
export function validatePolygon(geojson: unknown): PolygonValidation {
  if (!isRecord(geojson) || geojson['type'] !== 'Polygon') {
    return { ok: false, reason: 'geojson.type must be "Polygon"' };
  }

  const coordinates = geojson['coordinates'];
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return { ok: false, reason: 'geojson.coordinates must be a non-empty array' };
  }

  for (const ring of coordinates) {
    if (!Array.isArray(ring) || ring.length < MIN_RING_POSITIONS) {
      return {
        ok: false,
        reason: `Each polygon ring must have at least ${MIN_RING_POSITIONS} positions`,
      };
    }

    for (const position of ring) {
      if (!isValidPosition(position)) {
        return {
          ok: false,
          reason: 'Each position must be [longitude, latitude] with valid bounds',
        };
      }
    }
  }

  return { ok: true, polygon: { type: 'Polygon', coordinates: coordinates as number[][][] } };
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
