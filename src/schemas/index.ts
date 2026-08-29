import { Type } from '@sinclair/typebox';

const Latitude = Type.Number({ minimum: -90, maximum: 90, description: 'WGS 84 latitude.' });
const Longitude = Type.Number({ minimum: -180, maximum: 180, description: 'WGS 84 longitude.' });
const EntityId = Type.String({
  minLength: 1,
  maxLength: 100,
  description: "The identifier this entity has in the caller's own system.",
});
const EntityType = Type.String({
  minLength: 1,
  maxLength: 100,
  description: 'Caller-defined category, for example "restaurant" or "courier".',
});

export const EntityPathParams = Type.Object({ type: EntityType, id: EntityId });

export const EntityBody = Type.Object(
  {
    lat: Latitude,
    lng: Longitude,
    is_active: Type.Boolean({ description: 'Inactive entities are excluded from every search.' }),
  },
  { additionalProperties: false },
);

export const NearbyQuery = Type.Object(
  {
    lat: Latitude,
    lng: Longitude,
    entity_type: EntityType,
    radius_km: Type.Number({ minimum: 0.1, maximum: 50, default: 5 }),
    limit: Type.Integer({ minimum: 1, maximum: 500, default: 100 }),
    cursor: Type.Optional(
      Type.String({ description: 'The next_cursor from a previous page of results.' }),
    ),
  },
  { additionalProperties: false },
);

export const NearbyResponse = Type.Object({
  results: Type.Array(
    Type.Object({
      entity_id: Type.String(),
      distance_km: Type.Number(),
    }),
  ),
  next_cursor: Type.Union([Type.String(), Type.Null()]),
});

export const GeofencePathParams = Type.Object({
  // Beyond 2^53 JSON.parse collapses distinct values onto the same double.
  id: Type.Integer({
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
    description: "The geofence's identifier in the caller's own system.",
  }),
});

export const GeofenceBody = Type.Object(
  {
    entity_id: EntityId,
    entity_type: EntityType,
    area: Type.Object(
      {
        type: Type.Literal('Polygon'),
        coordinates: Type.Array(Type.Array(Type.Array(Type.Number()))),
      },
      { additionalProperties: false, description: 'RFC 7946 Polygon.' },
    ),
    is_active: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const ContainingQuery = Type.Object(
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

export const AdminKeyParams = Type.Object({
  prefix: Type.String({ description: 'The key_prefix shown when listing keys.' }),
});

export const ProblemResponse = Type.Object(
  {
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer(),
    detail: Type.Optional(Type.String()),
    instance: Type.Optional(Type.String()),
  },
  { description: 'RFC 9457 problem details.' },
);
