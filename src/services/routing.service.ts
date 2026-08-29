import { queryOsrmTable, type Coordinate } from '../lib/osrm-client.ts';
import type { DestinationRef, EntityRepository } from '../repositories/entity.repository.ts';

export interface RoutedDestination extends DestinationRef {
  road_distance_km: number | null;
  duration_min: number | null;
}

export type RoutingResult =
  | { status: 'ok'; destinations: RoutedDestination[] }
  | { status: 'disabled' }
  | { status: 'unreachable' };

export class RoutingService {
  readonly #entities: EntityRepository;
  readonly #osrmUrl: string | null;

  constructor(entities: EntityRepository, osrmUrl: string | null) {
    this.#entities = entities;
    this.#osrmUrl = osrmUrl;
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

function toKilometres(metres: number | null | undefined): number | null {
  return metres === null || metres === undefined ? null : Math.round(metres / 10) / 100;
}

function toMinutes(seconds: number | null | undefined): number | null {
  return seconds === null || seconds === undefined ? null : Math.round((seconds / 60) * 10) / 10;
}
