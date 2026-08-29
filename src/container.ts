import type { Pool } from 'pg';
import type { Config } from './config/index.ts';
import { TaggedCache } from './lib/tagged-cache.ts';
import { CredentialRepository } from './repositories/credential.repository.ts';
import { EntityRepository } from './repositories/entity.repository.ts';
import { HealthRepository } from './repositories/health.repository.ts';
import { GeofenceRepository, type GeofenceMatch } from './repositories/geofence.repository.ts';
import { CredentialService } from './services/credential.service.ts';
import { EntityService, type NearbyPage } from './services/entity.service.ts';
import { HealthService } from './services/health.service.ts';
import { RoutingService } from './services/routing.service.ts';
import { GeofenceService } from './services/geofence.service.ts';

export interface Services {
  entities: EntityService;
  geofences: GeofenceService;
  credentials: CredentialService;
  routing: RoutingService;
  health: HealthService;
}

/**
 * Wires repositories and services by hand. At this size an IoC container would
 * add indirection without removing any, so the graph is written out instead.
 */
export function buildServices(pool: Pool, config: Config): Services {
  const entityRepository = new EntityRepository(pool);

  // One store per read path: they share no rows, so a single store would only
  // make each write drop the other's answers.
  const entityCache = new TaggedCache<NearbyPage>(config.cache);
  const geofenceCache = new TaggedCache<GeofenceMatch[] | { inside: boolean }>(config.cache);

  return {
    entities: new EntityService(entityRepository, entityCache),
    geofences: new GeofenceService(new GeofenceRepository(pool), geofenceCache),
    credentials: new CredentialService(new CredentialRepository(pool)),
    routing: new RoutingService(entityRepository, config.osrmUrl),
    health: new HealthService(new HealthRepository(pool), config.osrmUrl),
  };
}
