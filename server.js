require('dotenv').config();

const crypto     = require('crypto');
const Fastify    = require('fastify');
const helmet     = require('@fastify/helmet');
const rateLimit  = require('@fastify/rate-limit');
const { Pool }   = require('pg');
const { LRUCache } = require('lru-cache');

// ---------------------------------------------------------------------------
// 1. Env var doğrulaması
// ---------------------------------------------------------------------------
const REQUIRED_ENV = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME'];
const missingEnv   = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] Eksik ortam değişkenleri: ${missingEnv.join(', ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. IP kısıtlama listesi
// ALLOWED_IPS tanımlıysa yalnızca o IP'lerden gelen istekler kabul edilir.
// Tanımlı değilse kısıtlama uygulanmaz (herkese açık).
// TRUST_PROXY=true ise X-Forwarded-For başlığından gerçek IP okunur (nginx vb. arkasında).
// ---------------------------------------------------------------------------
const ALLOWED_IPS = process.env.ALLOWED_IPS
  ? new Set(process.env.ALLOWED_IPS.split(',').map((ip) => ip.trim()).filter(Boolean))
  : null;

const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

// ---------------------------------------------------------------------------
// 3. Uygulama
// ---------------------------------------------------------------------------
const app = Fastify({ logger: true, trustProxy: TRUST_PROXY });

app.register(helmet);
app.register(rateLimit, {
  max: 100,
  timeWindow: 60000,
  errorResponseBuilder: () => ({ error: 'Too many requests' }),
});

// IP kısıtlaması tanımlıysa tüm isteklere uygula
if (ALLOWED_IPS) {
  app.addHook('onRequest', async (request, reply) => {
    const clientIp = request.ip;
    if (!ALLOWED_IPS.has(clientIp)) {
      app.log.warn({ clientIp }, 'IP kısıtlaması: erişim reddedildi');
      reply.code(403).send({ error: 'Forbidden' });
    }
  });
  app.log.info(`IP kısıtlaması aktif: ${[...ALLOWED_IPS].join(', ')}`);
}

// ---------------------------------------------------------------------------
// 3. Veritabanı bağlantı havuzu
// ---------------------------------------------------------------------------
const pool = new Pool({
  host:                    process.env.DB_HOST,
  port:                    parseInt(process.env.DB_PORT, 10),
  user:                    process.env.DB_USER,
  password:                process.env.DB_PASS || '',
  database:                process.env.DB_NAME,
  max:                     10,
  idleTimeoutMillis:       30000,
  connectionTimeoutMillis: 5000,
});

// ---------------------------------------------------------------------------
// 4. Cache
// ---------------------------------------------------------------------------
const spatialCache = new LRUCache({ max: 500, ttl: 1000 * 60 * 5 });
const apiKeyCache  = new LRUCache({ max: 200, ttl: 1000 * 60 * 5 }); // API key → {tenant_id, project_name}

const cacheKeyIndex = new Map();

function setCacheWithIndex(entityType, tenantId, key, value) {
  spatialCache.set(key, value);
  const index = `${entityType}:${tenantId}`;
  if (!cacheKeyIndex.has(index)) cacheKeyIndex.set(index, new Set());
  cacheKeyIndex.get(index).add(key);
}

function invalidateCache(entityType, tenantId) {
  const index = `${entityType}:${tenantId}`;
  const keys  = cacheKeyIndex.get(index);
  if (!keys) return;
  keys.forEach((key) => spatialCache.delete(key));
  cacheKeyIndex.delete(index);
}

// ---------------------------------------------------------------------------
// 5. Auth middleware
//
// authenticateAdmin  → DB'deki admin_tokens tablosundan doğrular (5dk cache)
// authenticateApiKey → x-api-key, tüm spatial endpoint'ler için
//                      tenant_id'yi otomatik çözer, request'e enjekte eder
// ---------------------------------------------------------------------------
const adminTokenCache = new LRUCache({ max: 10, ttl: 1000 * 60 * 5 });

const authenticateAdmin = async (request, reply) => {
  const token = request.headers['x-admin-token'];
  if (!token) return reply.code(401).send({ error: 'Missing x-admin-token header' });

  if (adminTokenCache.has(token)) return;

  const { rows } = await pool.query(
    'SELECT token FROM admin_tokens WHERE token = $1',
    [token]
  );

  if (rows.length === 0) return reply.code(401).send({ error: 'Invalid admin token' });

  adminTokenCache.set(token, true);
};

const authenticateApiKey = async (request, reply) => {
  const key = request.headers['x-api-key'];
  if (!key) return reply.code(401).send({ error: 'Missing x-api-key header' });

  if (apiKeyCache.has(key)) {
    request.tenantContext = apiKeyCache.get(key);
    return;
  }

  const { rows } = await pool.query(
    'SELECT tenant_id, project_name FROM api_keys WHERE key = $1 AND is_active = true',
    [key]
  );

  if (rows.length === 0) return reply.code(401).send({ error: 'Invalid or inactive API key' });

  const ctx = { tenant_id: rows[0].tenant_id, project_name: rows[0].project_name };
  apiKeyCache.set(key, ctx);
  request.tenantContext = ctx;
};

// ---------------------------------------------------------------------------
// 6. Health check
// ---------------------------------------------------------------------------
app.get('/health', async () => {
  await pool.query('SELECT 1');
  return { status: 'ok' };
});

// ---------------------------------------------------------------------------
// 7. Admin — API key yönetimi
// ---------------------------------------------------------------------------

// Yeni key oluştur
app.post('/api/v1/admin/keys', {
  preHandler: [authenticateAdmin],
  schema: {
    body: {
      type: 'object',
      required: ['tenant_id', 'project_name'],
      additionalProperties: false,
      properties: {
        tenant_id:    { type: 'integer' },
        project_name: { type: 'string', minLength: 1 },
      },
    },
  },
}, async (request) => {
  const { tenant_id, project_name } = request.body;
  const key = `gsk_${crypto.randomBytes(24).toString('hex')}`;

  await pool.query(
    'INSERT INTO api_keys (key, tenant_id, project_name) VALUES ($1, $2, $3)',
    [key, tenant_id, project_name]
  );

  return { key, tenant_id, project_name };
});

// Tüm key'leri listele
app.get('/api/v1/admin/keys', { preHandler: [authenticateAdmin] }, async () => {
  const { rows } = await pool.query(
    'SELECT key, tenant_id, project_name, is_active, created_at FROM api_keys ORDER BY created_at DESC'
  );
  return rows;
});

// Key iptal et
app.delete('/api/v1/admin/keys/:key', {
  preHandler: [authenticateAdmin],
  schema: {
    params: {
      type: 'object',
      properties: { key: { type: 'string' } },
    },
  },
}, async (request, reply) => {
  const { key } = request.params;
  const { rows } = await pool.query(
    'UPDATE api_keys SET is_active = false WHERE key = $1 RETURNING key',
    [key]
  );
  if (rows.length === 0) return reply.code(404).send({ error: 'Key not found' });
  apiKeyCache.delete(key);
  return { success: true };
});

// ---------------------------------------------------------------------------
// 8. POST /api/v1/entities/sync
// ---------------------------------------------------------------------------
app.post('/api/v1/entities/sync', {
  preHandler: [authenticateApiKey],
  schema: {
    body: {
      type: 'object',
      required: ['entity_id', 'entity_type', 'lat', 'lng', 'is_active'],
      additionalProperties: false,
      properties: {
        entity_id:   { type: 'string', minLength: 1 },
        entity_type: { type: 'string', minLength: 1 },
        lat:         { type: 'number', minimum: -90,  maximum: 90  },
        lng:         { type: 'number', minimum: -180, maximum: 180 },
        is_active:   { type: 'boolean' },
      },
    },
  },
}, async (request) => {
  const { entity_id, entity_type, lat, lng, is_active } = request.body;
  const { tenant_id } = request.tenantContext;

  await pool.query(`
    INSERT INTO entity_locations (entity_id, entity_type, tenant_id, location, is_active)
    VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6)
    ON CONFLICT (entity_id, entity_type, tenant_id)
    DO UPDATE SET
      location  = ST_SetSRID(ST_MakePoint($4, $5), 4326),
      is_active = $6;
  `, [entity_id, entity_type, tenant_id, lng, lat, is_active]);

  invalidateCache(entity_type, tenant_id);
  return { success: true };
});

// ---------------------------------------------------------------------------
// 9. GET /api/v1/entities/nearby
// ---------------------------------------------------------------------------
app.get('/api/v1/entities/nearby', {
  preHandler: [authenticateApiKey],
  schema: {
    querystring: {
      type: 'object',
      required: ['lat', 'lng', 'entity_type'],
      additionalProperties: false,
      properties: {
        lat:         { type: 'number', minimum: -90,  maximum: 90   },
        lng:         { type: 'number', minimum: -180, maximum: 180  },
        entity_type: { type: 'string', minLength: 1 },
        radius_km:   { type: 'number', minimum: 0.1, maximum: 50, default: 5 },
      },
    },
  },
}, async (request) => {
  const { lat, lng, entity_type, radius_km } = request.query;
  const { tenant_id } = request.tenantContext;

  const cacheKey = `nearby:${entity_type}:${tenant_id}:${lat}:${lng}:${radius_km}`;
  if (spatialCache.has(cacheKey)) return spatialCache.get(cacheKey);

  const { rows } = await pool.query(`
    SELECT
      entity_id,
      ROUND(
        (ST_DistanceSphere(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)) / 1000)::numeric,
        2
      ) AS distance_km
    FROM entity_locations
    WHERE is_active   = true
      AND entity_type = $3
      AND tenant_id   = $4
      AND ST_DWithin(
        location::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        $5
      )
    ORDER BY distance_km ASC;
  `, [lng, lat, entity_type, tenant_id, radius_km * 1000]);

  setCacheWithIndex(entity_type, tenant_id, cacheKey, rows);
  return rows;
});

// ---------------------------------------------------------------------------
// 10. POST /api/v1/zones/sync
// ---------------------------------------------------------------------------
app.post('/api/v1/zones/sync', {
  preHandler: [authenticateApiKey],
  schema: {
    body: {
      type: 'object',
      required: ['id', 'entity_id', 'entity_type', 'geojson', 'is_active'],
      additionalProperties: false,
      properties: {
        id:          { type: 'integer' },
        entity_id:   { type: 'string', minLength: 1 },
        entity_type: { type: 'string', minLength: 1 },
        geojson:     { type: 'object' },
        is_active:   { type: 'boolean' },
      },
    },
  },
}, async (request, reply) => {
  const { id, entity_id, entity_type, geojson, is_active } = request.body;
  const { tenant_id } = request.tenantContext;

  if (geojson.type !== 'Polygon') {
    return reply.code(400).send({ error: 'geojson.type must be "Polygon"' });
  }

  await pool.query(`
    INSERT INTO zones (id, entity_id, entity_type, tenant_id, zone, is_active)
    VALUES ($1, $2, $3, $4, ST_GeomFromGeoJSON($5), $6)
    ON CONFLICT (id)
    DO UPDATE SET
      entity_id   = $2,
      entity_type = $3,
      tenant_id   = $4,
      zone        = ST_GeomFromGeoJSON($5),
      is_active   = $6;
  `, [id, entity_id, entity_type, tenant_id, JSON.stringify(geojson), is_active]);

  invalidateCache(entity_type, tenant_id);
  return { success: true };
});

// ---------------------------------------------------------------------------
// 11. DELETE /api/v1/zones/:id
// ---------------------------------------------------------------------------
app.delete('/api/v1/zones/:id', {
  preHandler: [authenticateApiKey],
  schema: {
    params: {
      type: 'object',
      properties: { id: { type: 'integer' } },
    },
  },
}, async (request, reply) => {
  const { id } = request.params;
  const { tenant_id } = request.tenantContext;

  const { rows } = await pool.query(
    'DELETE FROM zones WHERE id = $1 AND tenant_id = $2 RETURNING entity_type',
    [id, tenant_id]
  );

  if (rows.length === 0) return reply.code(404).send({ error: 'Zone not found' });

  invalidateCache(rows[0].entity_type, tenant_id);
  return { success: true };
});

// ---------------------------------------------------------------------------
// 12. GET /api/v1/zones/check
// ---------------------------------------------------------------------------
app.get('/api/v1/zones/check', {
  preHandler: [authenticateApiKey],
  schema: {
    querystring: {
      type: 'object',
      required: ['lat', 'lng', 'entity_type'],
      additionalProperties: false,
      properties: {
        lat:         { type: 'number', minimum: -90,  maximum: 90  },
        lng:         { type: 'number', minimum: -180, maximum: 180 },
        entity_type: { type: 'string', minLength: 1 },
      },
    },
  },
}, async (request) => {
  const { lat, lng, entity_type } = request.query;
  const { tenant_id } = request.tenantContext;

  const cacheKey = `zones:check:${entity_type}:${tenant_id}:${lat}:${lng}`;
  if (spatialCache.has(cacheKey)) return spatialCache.get(cacheKey);

  const { rows } = await pool.query(`
    SELECT entity_id
    FROM zones
    WHERE is_active   = true
      AND entity_type = $1
      AND tenant_id   = $2
      AND ST_Contains(zone, ST_SetSRID(ST_MakePoint($3, $4), 4326));
  `, [entity_type, tenant_id, lng, lat]);

  setCacheWithIndex(entity_type, tenant_id, cacheKey, rows);
  return rows;
});

// ---------------------------------------------------------------------------
// 13. GET /api/v1/collection/download/:token  — Tek kullanımlık Postman indirme
// ---------------------------------------------------------------------------
app.get('/api/v1/collection/download/:token', {
  schema: {
    params: {
      type: 'object',
      properties: { token: { type: 'string' } },
    },
  },
}, async (request, reply) => {
  const { token } = request.params;
  const client    = await pool.connect();

  try {
    await client.query('BEGIN');

    // FOR UPDATE SKIP LOCKED: eş zamanlı istek gelirse kilidi göremez, boş döner
    const { rows } = await client.query(`
      SELECT collection
      FROM   collection_tokens
      WHERE  token      = $1
        AND  expires_at > NOW()
      FOR UPDATE SKIP LOCKED
    `, [token]);

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return reply.code(404).send({ error: 'Link geçersiz, süresi dolmuş veya daha önce kullanılmış.' });
    }

    await client.query('DELETE FROM collection_tokens WHERE token = $1', [token]);
    await client.query('COMMIT');

    reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', 'attachment; filename="geo-service.postman_collection.json"')
      .send(rows[0].collection);

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});


// ---------------------------------------------------------------------------
// 14. Graceful shutdown
// ---------------------------------------------------------------------------
const shutdown = async (signal) => {
  app.log.info(`${signal} alındı, kapatılıyor...`);
  await app.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ---------------------------------------------------------------------------
// 15. Başlat
// ---------------------------------------------------------------------------
const start = async () => {
  try {
    await pool.query('SELECT 1');
    app.log.info('Veritabanı bağlantısı başarılı.');

    // Süresi dolmuş koleksiyon token'larını temizle
    const { rowCount } = await pool.query('DELETE FROM collection_tokens WHERE expires_at < NOW()');
    if (rowCount > 0) app.log.info(`${rowCount} süresi dolmuş koleksiyon token'ı temizlendi.`);

    await app.listen({ port: parseInt(process.env.PORT, 10) || 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error({ err }, 'Başlatma hatası');
    process.exit(1);
  }
};

start();
