require('dotenv').config();

const crypto   = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT, 10),
  user:     process.env.DB_USER,
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME,
});

const BASE_URL    = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const TTL_MINUTES = parseInt(process.env.COLLECTION_TTL_MINUTES || '60', 10);

function buildCollection() {
  return {
    info: {
      name:   'Geo Service API',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      { key: 'base_url',    value: BASE_URL },
      { key: 'api_key',     value: '' },
      { key: 'admin_token', value: '' },
    ],
    item: [
      {
        name: 'System',
        item: [
          {
            name: 'Health Check',
            request: {
              method: 'GET',
              url: { raw: '{{base_url}}/health', host: ['{{base_url}}'], path: ['health'] },
            },
          },
        ],
      },
      {
        name: 'Admin — Key Management',
        item: [
          {
            name: 'Create API Key',
            request: {
              method: 'POST',
              header: [
                { key: 'x-admin-token', value: '{{admin_token}}' },
                { key: 'Content-Type',  value: 'application/json' },
              ],
              url: { raw: '{{base_url}}/api/v1/admin/keys', host: ['{{base_url}}'], path: ['api', 'v1', 'admin', 'keys'] },
              body: {
                mode: 'raw',
                options: { raw: { language: 'json' } },
                raw: JSON.stringify({ tenant_id: 1, project_name: 'my-project' }, null, 2),
              },
            },
          },
          {
            name: 'List API Keys',
            request: {
              method: 'GET',
              header: [{ key: 'x-admin-token', value: '{{admin_token}}' }],
              url: { raw: '{{base_url}}/api/v1/admin/keys', host: ['{{base_url}}'], path: ['api', 'v1', 'admin', 'keys'] },
            },
          },
          {
            name: 'Revoke API Key',
            request: {
              method: 'DELETE',
              header: [{ key: 'x-admin-token', value: '{{admin_token}}' }],
              url: {
                raw: '{{base_url}}/api/v1/admin/keys/:key',
                host: ['{{base_url}}'],
                path: ['api', 'v1', 'admin', 'keys', ':key'],
                variable: [{ key: 'key', value: '' }],
              },
            },
          },
        ],
      },
      {
        name: 'Entities',
        item: [
          {
            name: 'Sync Entity Location',
            request: {
              method: 'POST',
              header: [
                { key: 'x-api-key',    value: '{{api_key}}' },
                { key: 'Content-Type', value: 'application/json' },
              ],
              url: { raw: '{{base_url}}/api/v1/entities/sync', host: ['{{base_url}}'], path: ['api', 'v1', 'entities', 'sync'] },
              body: {
                mode: 'raw',
                options: { raw: { language: 'json' } },
                raw: JSON.stringify({ entity_id: '42', entity_type: 'restaurant', lat: 47.2924, lng: 11.0516, is_active: true }, null, 2),
              },
            },
          },
          {
            name: 'Nearby Entities',
            request: {
              method: 'GET',
              header: [{ key: 'x-api-key', value: '{{api_key}}' }],
              url: {
                raw:   '{{base_url}}/api/v1/entities/nearby?lat=47.2924&lng=11.0516&entity_type=restaurant&radius_km=5',
                host:  ['{{base_url}}'],
                path:  ['api', 'v1', 'entities', 'nearby'],
                query: [
                  { key: 'lat',         value: '47.2924' },
                  { key: 'lng',         value: '11.0516' },
                  { key: 'entity_type', value: 'restaurant' },
                  { key: 'radius_km',   value: '5' },
                ],
              },
            },
          },
        ],
      },
      {
        name: 'Zones',
        item: [
          {
            name: 'Sync Zone',
            request: {
              method: 'POST',
              header: [
                { key: 'x-api-key',    value: '{{api_key}}' },
                { key: 'Content-Type', value: 'application/json' },
              ],
              url: { raw: '{{base_url}}/api/v1/zones/sync', host: ['{{base_url}}'], path: ['api', 'v1', 'zones', 'sync'] },
              body: {
                mode: 'raw',
                options: { raw: { language: 'json' } },
                raw: JSON.stringify({
                  id: 1, entity_id: '42', entity_type: 'restaurant',
                  geojson: { type: 'Polygon', coordinates: [[[11.05, 47.28], [11.08, 47.28], [11.08, 47.31], [11.05, 47.31], [11.05, 47.28]]] },
                  is_active: true,
                }, null, 2),
              },
            },
          },
          {
            name: 'Check Zone Coverage',
            request: {
              method: 'GET',
              header: [{ key: 'x-api-key', value: '{{api_key}}' }],
              url: {
                raw:   '{{base_url}}/api/v1/zones/check?lat=47.2924&lng=11.0516&entity_type=restaurant',
                host:  ['{{base_url}}'],
                path:  ['api', 'v1', 'zones', 'check'],
                query: [
                  { key: 'lat',         value: '47.2924' },
                  { key: 'lng',         value: '11.0516' },
                  { key: 'entity_type', value: 'restaurant' },
                ],
              },
            },
          },
          {
            name: 'Delete Zone',
            request: {
              method: 'DELETE',
              header: [{ key: 'x-api-key', value: '{{api_key}}' }],
              url: {
                raw: '{{base_url}}/api/v1/zones/:id',
                host: ['{{base_url}}'],
                path: ['api', 'v1', 'zones', ':id'],
                variable: [{ key: 'id', value: '1' }],
              },
            },
          },
        ],
      },
    ],
  };
}

async function generate() {
  const token      = `gcc_${crypto.randomBytes(24).toString('hex')}`;
  const collection = JSON.stringify(buildCollection());
  const expiresAt  = new Date(Date.now() + TTL_MINUTES * 60 * 1000);

  await pool.query(
    'INSERT INTO collection_tokens (token, collection, expires_at) VALUES ($1, $2, $3)',
    [token, collection, expiresAt]
  );

  const downloadUrl = `${BASE_URL}/api/v1/collection/download/${token}`;
  const expiresStr  = expiresAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  console.log('\n✓ Postman koleksiyonu hazırlandı.\n');
  console.log(`  İndirme linki: ${downloadUrl}`);
  console.log(`  Geçerlilik:    ${TTL_MINUTES} dakika (${expiresStr}'e kadar)`);
  console.log('\n  Link tek kullanımlıktır. İndirildikten sonra geçersiz olur.\n');
}

generate()
  .catch((err) => {
    console.error('Hata:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
