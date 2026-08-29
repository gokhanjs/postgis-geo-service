import { queryOsrmTable, type Coordinate } from '../lib/osrm-client.ts';
import type { EntityRepository } from '../repositories/entity.repository.ts';

export interface DestinationRef {
  entity_id: string;
  entity_type: string;
}

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

    const entityIds = destinations.map((d) => d.entity_id);
    const entityTypes = [...new Set(destinations.map((d) => d.entity_type))];

    const locations = await this.#entities.findCoordinates(tenantId, entityIds, entityTypes);
    if (locations.length === 0) return { status: 'ok', destinations: [] };

    const table = await queryOsrmTable(this.#osrmUrl, origin, locations);
    if (table === null) return { status: 'unreachable' };

    // Row 0 is the single source; column 0 is the source itself, so the
    // destinations start at index 1.
    const distances = table.distances[0] ?? [];
    const durations = table.durations[0] ?? [];

    return {
      status: 'ok',
      destinations: locations.map((location, i) => ({
        entity_id: location.entity_id,
        entity_type: location.entity_type,
        road_distance_km: toKilometres(distances[i + 1]),
        duration_min: toMinutes(durations[i + 1]),
      })),
    };
  }
}

function toKilometres(metres: number | null | undefined): number | null {
  return metres === null || metres === undefined ? null : Math.round(metres / 10) / 100;
}

function toMinutes(seconds: number | null | undefined): number | null {
  return seconds === null || seconds === undefined ? null : Math.round((seconds / 60) * 10) / 10;
}
