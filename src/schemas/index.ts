import { Type } from '@sinclair/typebox';

const Latitude = Type.Number({ minimum: -90, maximum: 90 });
const Longitude = Type.Number({ minimum: -180, maximum: 180 });
const EntityId = Type.String({ minLength: 1, maxLength: 100 });
const EntityType = Type.String({ minLength: 1, maxLength: 100 });

export const EntitySyncBody = Type.Object(
  {
    entity_id: EntityId,
    entity_type: EntityType,
    lat: Latitude,
    lng: Longitude,
    is_active: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const NearbyQuery = Type.Object(
  {
    lat: Latitude,
    lng: Longitude,
    entity_type: EntityType,
    radius_km: Type.Number({ minimum: 0.1, maximum: 50, default: 5 }),
  },
  { additionalProperties: false },
);

export const ZoneSyncBody = Type.Object(
  {
    id: Type.Integer(),
    entity_id: EntityId,
    entity_type: EntityType,
    geojson: Type.Object({}, { additionalProperties: true }),
    is_active: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const ZoneIdParams = Type.Object({ id: Type.Integer() });

export const ZoneCheckQuery = Type.Object(
  {
    lat: Latitude,
    lng: Longitude,
    entity_type: EntityType,
    entity_id: Type.Optional(EntityId),
  },
  { additionalProperties: false },
);

export const RoutingBody = Type.Object(
  {
    origin: Type.Object({ lat: Latitude, lng: Longitude }, { additionalProperties: false }),
    destinations: Type.Array(
      Type.Object(
        { entity_id: EntityId, entity_type: EntityType },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 50 },
    ),
  },
  { additionalProperties: false },
);

export const AdminKeyBody = Type.Object(
  {
    tenant_id: Type.Integer(),
    project_name: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

export const AdminKeyParams = Type.Object({ key: Type.String() });

export const TokenParams = Type.Object({ token: Type.String() });
