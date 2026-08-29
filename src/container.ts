import type { Pool } from 'pg';
import type { Config } from './config/index.ts';
import { TaggedCache } from './lib/tagged-cache.ts';
import { CollectionRepository } from './repositories/collection.repository.ts';
import { CredentialRepository } from './repositories/credential.repository.ts';
import { EntityRepository } from './repositories/entity.repository.ts';
import { HealthRepository } from './repositories/health.repository.ts';
import { ZoneRepository } from './repositories/zone.repository.ts';
import { CollectionService } from './services/collection.service.ts';
import { CredentialService } from './services/credential.service.ts';
import { EntityService } from './services/entity.service.ts';
import { HealthService } from './services/health.service.ts';
import { RoutingService } from './services/routing.service.ts';
import type { SpatialCacheValue } from './services/spatial-cache.ts';
import { ZoneService } from './services/zone.service.ts';

export interface Services {
  entities: EntityService;
  zones: ZoneService;
  credentials: CredentialService;
  routing: RoutingService;
  collections: CollectionService;
  health: HealthService;
}

/**
 * Wires repositories and services by hand. At this size an IoC container would
 * add indirection without removing any, so the graph is written out instead.
 */
export function buildServices(pool: Pool, config: Config): Services {
  const entityRepository = new EntityRepository(pool);

  // One cache backs both spatial read paths, so a write invalidates the
  // entity and zone answers for that tenant together.
  const spatialCache = new TaggedCache<SpatialCacheValue>(config.cache);

  return {
    entities: new EntityService(entityRepository, spatialCache),
    zones: new ZoneService(new ZoneRepository(pool), spatialCache),
    credentials: new CredentialService(new CredentialRepository(pool)),
    routing: new RoutingService(entityRepository, config.osrmUrl),
    collections: new CollectionService(new CollectionRepository(pool)),
    health: new HealthService(new HealthRepository(pool), config.osrmUrl),
  };
}
