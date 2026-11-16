export interface Coordinate {
  lng: number;
  lat: number;
}

export interface OsrmTableResponse {
  distances: (number | null)[][];
  durations: (number | null)[][];
}

const REQUEST_TIMEOUT_MS = 5_000;

// OSRM snaps any coordinate to the nearest road however far it is, which would
// price an address at sea or on a car-free island from a road kilometres away.
const SNAP_RADIUS_M = 1_000;

// Swapping the routing container closes pooled keep-alive sockets, so a failed
// connection is retried once; a timeout or an HTTP error is an answer.
async function fetchWithReconnect(url: string): Promise<Response> {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const attempt = () => fetch(url, { signal });
  try {
    return await attempt();
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    return attempt();
  }
}

/**
 * Asks OSRM for distances and durations from one origin to many destinations.
 *
 * Returns null instead of throwing whenever routing is unavailable, because
 * every caller treats "no routing" as a normal state rather than a failure.
 */
export async function queryOsrmTable(
  baseUrl: string | null,
  origin: Coordinate,
  destinations: readonly Coordinate[],
): Promise<OsrmTableResponse | null> {
  if (!baseUrl) return null;

  // The Table API takes one coordinate list; sources=0 marks the first as origin.
  const coords = [origin, ...destinations].map((c) => `${c.lng},${c.lat}`).join(';');
  const url = `${baseUrl}/table/v1/driving/${coords}?sources=0&annotations=distance,duration`;

  try {
    const res = await fetchWithReconnect(url);
    if (!res.ok) return null;

    const data = (await res.json()) as { code?: string } & OsrmTableResponse;
    if (data.code !== 'Ok') return null;

    return data;
  } catch {
    return null;
  }
}

export type OsrmRouteOutcome =
  | { code: 'Ok'; distance: number; duration: number; data_version: string | null }
  | { code: 'NoRoute' }
  | { code: 'NoSegment' };

/** Fastest car route between two points; null means routing is unavailable, as for the table query. */
export async function queryOsrmRoute(
  baseUrl: string,
  origin: Coordinate,
  destination: Coordinate,
): Promise<OsrmRouteOutcome | null> {
  const url = `${baseUrl}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=false&radiuses=${SNAP_RADIUS_M};${SNAP_RADIUS_M}`;

  try {
    const res = await fetchWithReconnect(url);
    // OSRM reports NoRoute and NoSegment with a 400, so that body is an answer, not an error.
    if (res.status !== 200 && res.status !== 400) return null;

    const data = (await res.json()) as {
      code?: string;
      routes?: { distance: number; duration: number }[];
      data_version?: string;
    };
    if (data.code === 'NoRoute' || data.code === 'NoSegment') return { code: data.code };

    const best = data.routes?.[0];
    if (data.code !== 'Ok' || best === undefined) return null;

    return {
      code: 'Ok',
      distance: best.distance,
      duration: best.duration,
      data_version: data.data_version ?? null,
    };
  } catch {
    return null;
  }
}
