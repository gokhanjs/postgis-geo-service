import { queryOsrmTable } from '../lib/osrm-client.ts';
import type { HealthRepository } from '../repositories/health.repository.ts';

export type OsrmStatus = 'disabled' | 'ok' | 'unreachable';

export class HealthService {
  readonly #health: HealthRepository;
  readonly #osrmUrl: string | null;

  constructor(health: HealthRepository, osrmUrl: string | null) {
    this.#health = health;
    this.#osrmUrl = osrmUrl;
  }

  /** Startup check: no OSRM probe, so a slow routing backend cannot hold the port shut. */
  async checkDatabase(): Promise<void> {
    await this.#health.ping();
  }

  /** Readiness: reaches the database and reports routing without failing on it. */
  async check(): Promise<{ status: 'ok'; osrm: OsrmStatus }> {
    await this.#health.ping();

    if (this.#osrmUrl === null) return { status: 'ok', osrm: 'disabled' };

    const probe = await queryOsrmTable(this.#osrmUrl, { lng: 0, lat: 0 }, [{ lng: 0, lat: 0 }]);
    return { status: 'ok', osrm: probe !== null ? 'ok' : 'unreachable' };
  }
}
