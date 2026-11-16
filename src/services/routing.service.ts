import type { LRUCache } from 'lru-cache';
import { queryOsrmRoute, queryOsrmTable, type Coordinate } from '../lib/osrm-client.ts';
import type { DestinationRef, EntityRepository } from '../repositories/entity.repository.ts';

export interface RoutedDestination extends DestinationRef {
  road_distance_km: number | null;
  duration_min: number | null;
}

export type RoutingResult =
  | { status: 'ok'; destinations: RoutedDestination[] }
  | { status: 'disabled' }
  | { status: 'unreachable' };

export interface PairRoute {
  road_distance_km: number;
  duration_min: number;
  data_version: string | null;
}

export type PairRouteResult =
  | { status: 'ok'; route: PairRoute }
  | { status: 'disabled' }
  | { status: 'unreachable' }
  | { status: 'no_route' }
  | { status: 'no_road_near_point' };

export class RoutingService {
  readonly #entities: EntityRepository;
  readonly #osrmUrl: string | null;
  readonly #routes: LRUCache<string, PairRoute>;
  readonly #inflight = new Map<string, Promise<PairRouteResult>>();
  #dataVersion: string | null = null;

  constructor(
    entities: EntityRepository,
    osrmUrl: string | null,
    routes: LRUCache<string, PairRoute>,
  ) {
    this.#entities = entities;
    this.#osrmUrl = osrmUrl;
    this.#routes = routes;
  }

  async route(origin: Coordinate, destination: Coordinate): Promise<PairRouteResult> {
    if (this.#osrmUrl === null) return { status: 'disabled' };

    const from = toCacheGrid(origin);
    const to = toCacheGrid(destination);
    const key = `${from.lng},${from.lat};${to.lng},${to.lat}`;

    // The version is learnt from the latest OSRM answer, so after a map update
    // the first uncached pair retires every answer computed on the old map.
    const cached = this.#routes.get(key);
    if (cached !== undefined && cached.data_version === this.#dataVersion) {
      return { status: 'ok', route: cached };
    }

    // A search asks the same pair once per vehicle class, often concurrently.
    let pending = this.#inflight.get(key);
    if (pending === undefined) {
      pending = this.#ask(this.#osrmUrl, key, from, to).finally(() => this.#inflight.delete(key));
      this.#inflight.set(key, pending);
    }
    return pending;
  }

  async #ask(
    osrmUrl: string,
    key: string,
    from: Coordinate,
    to: Coordinate,
  ): Promise<PairRouteResult> {
    const versionBefore = this.#dataVersion;
    const answer = await queryOsrmRoute(osrmUrl, from, to);
    if (answer === null) return { status: 'unreachable' };
    if (answer.code === 'NoRoute') return { status: 'no_route' };
    if (answer.code === 'NoSegment') return { status: 'no_road_near_point' };

    // During a map switch a slower answer from the old map must not undo the
    // newer version another request has already seen, nor be cached under it.
    if (this.#dataVersion === versionBefore) this.#dataVersion = answer.data_version;
    const route = {
      road_distance_km: kilometres(answer.distance),
      duration_min: minutes(answer.duration),
      data_version: answer.data_version,
    };
    if (route.data_version === this.#dataVersion) this.#routes.set(key, route);

    return { status: 'ok', route };
  }

  async distances(
    tenantId: number,
    origin: Coordinate,
    destinations: readonly DestinationRef[],
  ): Promise<RoutingResult> {
    if (this.#osrmUrl === null) return { status: 'disabled' };

    const locations = await this.#entities.findCoordinates(tenantId, destinations);
    if (locations.length === 0) return { status: 'ok', destinations: [] };

    const table = await queryOsrmTable(this.#osrmUrl, origin, locations);
    if (table === null) return { status: 'unreachable' };

    // Row 0 is the single source; column 0 is the source itself, so the
    // destinations start at index 1.
    const distances = table.distances[0] ?? [];
    const durations = table.durations[0] ?? [];

    // Answer in the order the caller asked, keyed by identity rather than by
    // array position: the query returns only the destinations that exist.
    const byKey = new Map(
      locations.map((location, i) => [
        `${location.entity_type}\x00${location.entity_id}`,
        {
          entity_id: location.entity_id,
          entity_type: location.entity_type,
          road_distance_km: toKilometres(distances[i + 1]),
          duration_min: toMinutes(durations[i + 1]),
        },
      ]),
    );

    return {
      status: 'ok',
      destinations: destinations.map(
        (wanted) =>
          byKey.get(`${wanted.entity_type}\x00${wanted.entity_id}`) ?? {
            entity_id: wanted.entity_id,
            entity_type: wanted.entity_type,
            road_distance_km: null,
            duration_min: null,
          },
      ),
    };
  }
}

/** About a metre: requests for the same address share an answer despite geocoder jitter. */
function toCacheGrid({ lng, lat }: Coordinate): Coordinate {
  return { lng: Math.round(lng * 1e5) / 1e5, lat: Math.round(lat * 1e5) / 1e5 };
}

function kilometres(metres: number): number {
  return Math.round(metres / 10) / 100;
}

function minutes(seconds: number): number {
  return Math.round((seconds / 60) * 10) / 10;
}

function toKilometres(metres: number | null | undefined): number | null {
  return metres === null || metres === undefined ? null : kilometres(metres);
}

function toMinutes(seconds: number | null | undefined): number | null {
  return seconds === null || seconds === undefined ? null : minutes(seconds);
}
