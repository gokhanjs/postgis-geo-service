export interface Coordinate {
  lng: number;
  lat: number;
}

export interface OsrmTableResponse {
  distances: (number | null)[][];
  durations: (number | null)[][];
}

const REQUEST_TIMEOUT_MS = 5_000;

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
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return null;

    const data = (await res.json()) as { code?: string } & OsrmTableResponse;
    if (data.code !== 'Ok') return null;

    return data;
  } catch {
    return null;
  }
}
