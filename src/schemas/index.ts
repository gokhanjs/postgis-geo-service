import { Type } from '@sinclair/typebox';

const Latitude = Type.Number({ minimum: -90, maximum: 90, description: 'WGS 84 latitude.' });
const Longitude = Type.Number({ minimum: -180, maximum: 180, description: 'WGS 84 longitude.' });
// A NUL byte cannot be stored in a Postgres text column; it would be a 500.
const IDENTIFIER_PATTERN = '^[\\x20-\\x7E]+$';

const EntityId = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: IDENTIFIER_PATTERN,
  description: "The identifier this entity has in the caller's own system.",
});
const EntityType = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: IDENTIFIER_PATTERN,
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
    tenant_id: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }),
    project_name: Type.String({ minLength: 1, maxLength: 200, pattern: IDENTIFIER_PATTERN }),
  },
  { additionalProperties: false },
);

export const AdminKeyParams = Type.Object({
  prefix: Type.String({
    minLength: 4,
    maxLength: 12,
    pattern: '^gsk_[0-9a-f]*$',
    description: 'The key_prefix shown when listing keys.',
  }),
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

export const EntityAck = Type.Object({ entity_id: Type.String(), entity_type: Type.String() });

export const GeofenceAck = Type.Object({
  id: Type.Integer(),
  entity_id: Type.String(),
  entity_type: Type.String(),
});

export const ContainingResponse = Type.Union([
  Type.Object({ results: Type.Array(Type.Object({ entity_id: Type.String() })) }),
  Type.Object({ inside: Type.Boolean() }),
]);

export const RoutingResponse = Type.Array(
  Type.Object({
    entity_id: Type.String(),
    entity_type: Type.String(),
    road_distance_km: Type.Union([Type.Number(), Type.Null()]),
    duration_min: Type.Union([Type.Number(), Type.Null()]),
  }),
);

export const IssuedKeyResponse = Type.Object({
  key: Type.String({ description: 'Shown once. Only its digest is stored.' }),
  tenant_id: Type.Integer(),
  project_name: Type.String(),
});

export const KeyListResponse = Type.Array(
  Type.Object({
    key_prefix: Type.String(),
    tenant_id: Type.Integer(),
    project_name: Type.String(),
    is_active: Type.Boolean(),
    created_at: Type.String({ format: 'date-time' }),
  }),
);

export const SuccessResponse = Type.Object({ success: Type.Boolean() });

/** Attached to every guarded route, so the reference documents its failures. */
export const guardedResponses = {
  400: ProblemResponse,
  401: ProblemResponse,
  429: ProblemResponse,
} as const;

export const apiKeySecurity = [{ apiKey: [] }];
export const adminSecurity = [{ adminToken: [] }];
