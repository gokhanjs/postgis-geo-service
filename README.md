# Geo Service

Konum tabanlı sorgular için geliştirilmiş, yüksek performanslı ve çok kiracılı (multi-tenant) bir spatial mikroservis. PostGIS'in coğrafi veri işleme yeteneklerini kullanarak nokta konumu sorgulama, yakın nesne bulma ve polygon kapsama alanı kontrolü işlemlerini üstlenir. Ana uygulama sistemlerinden bağımsız çalışır; birden fazla projeye tek servis üzerinden hizmet verir.

---

## İçindekiler

- [Teknoloji Yığını](#teknoloji-yığını)
- [Sistem Gereksinimleri](#sistem-gereksinimleri)
- [Kurulum](#kurulum)
- [Komutlar](#komutlar)
- [Proje Yapısı](#proje-yapısı)
- [Veritabanı Şeması](#veritabanı-şeması)
- [Koordinatlar Nasıl Çalışır?](#koordinatlar-nasıl-çalışır)
- [Güvenlik Modeli](#güvenlik-modeli)
- [API Referansı](#api-referansı)
- [Konfigürasyon](#konfigürasyon)
- [Önbellek (Cache)](#önbellek-cache)
- [Migration Sistemi](#migration-sistemi)
- [Postman Koleksiyonu](#postman-koleksiyonu)
- [OSRM Yol Mesafesi](#osrm-yol-mesafesi)

---

## Teknoloji Yığını

| Katman | Teknoloji | Açıklama |
|---|---|---|
| Çalışma ortamı | Node.js 22+ | JavaScript çalışma ortamı |
| Web framework | Fastify 5 | Express'e kıyasla ~2-3x daha hızlı HTTP framework |
| Veritabanı sürücüsü | pg (node-postgres) | PostgreSQL bağlantısı ve connection pool yönetimi |
| Spatial veritabanı | PostgreSQL + PostGIS | Geometrik veri tipleri ve coğrafi sorgular |
| Güvenlik | @fastify/helmet | HTTP güvenlik başlıkları |
| Hız sınırlama | @fastify/rate-limit | İstek hızı sınırlandırma |
| Önbellek | lru-cache | Bellekte LRU tabanlı sorgu önbelleği |
| Konfigürasyon | dotenv | Ortam değişkenleri yönetimi |
| Geliştirme | nodemon | Dosya değişikliğinde otomatik yeniden başlatma |
| Paket yöneticisi | pnpm | Disk ve hız açısından npm'den verimli |

---

## Sistem Gereksinimleri

Servisi çalıştırmadan önce aşağıdakilerin kurulu olması gerekir:

- **Node.js** `>= 18`
- **pnpm** `>= 8`
- **PostgreSQL** `>= 14` ve **PostGIS** eklentisi

### macOS — Homebrew ile Kurulum

```bash
# Node.js
brew install node

# pnpm
npm install -g pnpm

# PostgreSQL + PostGIS bağımlılıkları (DBngin gibi araçlar kullanıyorsanız)
brew install gmp sfcgal libtiff
```

> **Not:** DBngin veya Postgres.app gibi araçlarla PostgreSQL kuruluysa PostGIS eklentisi genellikle dahili gelir. Ancak bağımlı sistem kütüphaneleri (`gmp`, `sfcgal`, `libtiff`) Homebrew aracılığıyla ayrıca kurulmalıdır.

### PostGIS Doğrulama

```sql
-- Veritabanına bağlanıp PostGIS'in kurulu olduğunu kontrol edin
SELECT name FROM pg_available_extensions WHERE name = 'postgis';
```

---

## Kurulum

### 1. Bağımlılıkları Yükle

```bash
pnpm install
```

### 2. Ortam Dosyasını Oluştur

Proje kök dizininde `.env` dosyası oluşturun:

```env
PORT=3000

DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=postgres
DB_PASS=
DB_NAME=geo_service_db
```

> `.env` dosyası `.gitignore`'a eklenmiştir. Sürüm kontrolüne gitmez.

### 3. Veritabanını ve Tabloları Oluştur

```bash
pnpm migrate
```

Bu komut şunları otomatik yapar:
- `.env`'deki `DB_NAME` yoksa veritabanını oluşturur
- PostGIS eklentisini aktif eder
- Tüm tabloları ve indeksleri sırayla oluşturur

### 4. İlk Admin Token'ını Üret

```bash
pnpm generate:token
```

Ekranda görünen `gat_...` token'ını güvenli bir yere kaydedin. **Bir daha gösterilmez.**

### 5. Servisi Başlat

```bash
# Geliştirme (otomatik yeniden başlatma ile)
pnpm dev

# Üretim
pnpm start
```

Servis `http://0.0.0.0:3000` adresinde dinlemeye başlar.

---

## Komutlar

| Komut | Açıklama |
|---|---|
| `pnpm start` | Servisi başlatır (üretim modu) |
| `pnpm dev` | Servisi nodemon ile başlatır (geliştirme modu) |
| `pnpm migrate` | Bekleyen tüm migration'ları sırayla uygular |
| `pnpm migrate:down` | Son migration'ı geri alır |
| `pnpm generate:token` | Yeni admin token üretir, eskisini geçersiz kılar |
| `pnpm generate:collection` | Tek kullanımlık Postman koleksiyonu indirme linki üretir |
| `pnpm osrm:update` | OSRM harita verisini indirir, işler ve container'ı yeniden başlatır |

---

## Proje Yapısı

```
geo-service/
├── migrations/
│   ├── 001.do.create-restaurant-locations.sql    # İlk şema (geçmiş)
│   ├── 001.undo.create-restaurant-locations.sql
│   ├── 002.do.redesign-generic-schema.sql        # Genel entity/zone yapısı
│   ├── 002.undo.redesign-generic-schema.sql
│   ├── 003.do.create-api-keys.sql                # Proje API key tablosu
│   ├── 003.undo.create-api-keys.sql
│   ├── 004.do.create-admin-tokens.sql            # Admin token tablosu
│   ├── 004.undo.create-admin-tokens.sql
│   ├── 005.do.create-collection-tokens.sql       # Postman koleksiyon token tablosu
│   └── 005.undo.create-collection-tokens.sql
├── server.js             # Ana uygulama — tüm endpoint'ler ve middleware
├── migrate.js            # Migration runner
├── generate-token.js     # Admin token üretici
├── generate-collection.js # Postman koleksiyon linki üretici
├── osrm-update.js        # OSRM harita verisi güncelleme scripti
├── package.json
├── .env                  # Ortam değişkenleri (git'e gitmez)
├── .gitignore
└── README.md
```

---

## Veritabanı Şeması

### `entity_locations`
Herhangi bir nesnenin (restoran, depo, sürücü vb.) nokta konumunu saklar.

| Kolon | Tip | Açıklama |
|---|---|---|
| `entity_id` | TEXT | Nesnenin dış sistemdeki ID'si |
| `entity_type` | TEXT | Nesne tipi (`restaurant`, `driver`, `warehouse` vb.) |
| `tenant_id` | INT | Hangi projeye ait olduğu |
| `location` | GEOMETRY(Point, 4326) | WGS84 koordinat sistemiyle nokta |
| `is_active` | BOOLEAN | Aktif/pasif durumu |

**Primary key:** `(entity_id, entity_type, tenant_id)` — aynı ID farklı tipler için kullanılabilir.

**İndeksler:**
- `idx_entity_location` — GIST (spatial sorgu hızlandırması)
- `idx_entity_tenant` — B-tree `(tenant_id, entity_type)`

---

### `zones`
Herhangi bir nesnenin polygon kapsama alanını saklar (teslimat bölgesi, servis alanı, geofence vb.).

| Kolon | Tip | Açıklama |
|---|---|---|
| `id` | BIGINT | Dış sistemdeki zone ID'si (primary key) |
| `entity_id` | TEXT | Hangi nesneye ait |
| `entity_type` | TEXT | Nesne tipi |
| `tenant_id` | INT | Hangi projeye ait |
| `zone` | GEOMETRY(Polygon, 4326) | WGS84 Polygon geometrisi |
| `is_active` | BOOLEAN | Aktif/pasif durumu |

**İndeksler:**
- `idx_zone_geometry` — GIST (spatial sorgu hızlandırması)
- `idx_zone_entity` — B-tree `(entity_id, entity_type, tenant_id)`

---

### `api_keys`
Proje başına API anahtarlarını saklar.

| Kolon | Tip | Açıklama |
|---|---|---|
| `key` | TEXT | `gsk_` önekli anahtar (primary key) |
| `tenant_id` | INT | Bu key'e bağlı tenant |
| `project_name` | TEXT | Projenin adı (tanımlayıcı) |
| `is_active` | BOOLEAN | Aktif/iptal durumu |
| `created_at` | TIMESTAMPTZ | Oluşturulma zamanı |

---

### `admin_tokens`
Admin işlemleri için kullanılan token'ları saklar. Sadece bir aktif token bulunur.

| Kolon | Tip | Açıklama |
|---|---|---|
| `token` | TEXT | `gat_` önekli token (primary key) |
| `created_at` | TIMESTAMPTZ | Oluşturulma zamanı |

---

## Koordinatlar Nasıl Çalışır?

### Koordinat Sistemi: WGS84 (SRID 4326)

Tüm koordinatlar **WGS84** (GPS cihazlarının kullandığı standart) koordinat sistemiyle saklanır. PostGIS'te bu sistem `SRID 4326` olarak tanımlanır.

- **Latitude (enlem):** Kuzey-güney ekseni. `-90` ile `+90` arasında. (İstanbul ≈ `41.0`)
- **Longitude (boylam):** Doğu-batı ekseni. `-180` ile `+180` arasında. (İstanbul ≈ `28.9`)

> Önemli: PostGIS'e koordinat girerken sıra **`(longitude, latitude)`** şeklindedir; genel kullanımdaki `(lat, lng)` sırasının tersidir. API bu dönüşümü otomatik yapar — dışarıdan her zaman `lat` ve `lng` olarak gönderebilirsiniz.

### Mesafe Hesaplama — `ST_DistanceSphere`

`/entities/nearby` endpoint'i iki nokta arasındaki mesafeyi **küresel yüzey mesafesi** olarak hesaplar:

```sql
ST_DistanceSphere(location, ST_SetSRID(ST_MakePoint(lng, lat), 4326))
```

- Dünya'nın küresel şeklini hesaba katar
- Sonuç **metre** cinsindendir, API bunu kilometre'ye çevirir
- Düz hat mesafesidir — yol ağı veya arazi dikkate alınmaz

### Yakınlık Filtresi — `ST_DWithin` (Geography)

```sql
ST_DWithin(
  location::geography,
  ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
  radius_metres
)
```

`::geography` cast'i koordinatları **coğrafi** (derece yerine metre bazlı) sisteme dönüştürür. Bu sayede `radius_km` parametresi doğrudan metre bazlı filtre olarak çalışır ve ekvator ile kutup gibi farklı enlemlerde tutarlı sonuç verir.

### Polygon İçi Kontrol — `ST_Contains`

`/zones/check` endpoint'i kullanıcı koordinatının bir polygon'un içinde olup olmadığını kontrol eder:

```sql
ST_Contains(zone, ST_SetSRID(ST_MakePoint(lng, lat), 4326))
```

- Zone polygon'ları **GeoJSON Polygon** formatında sisteme girilir
- PostGIS `ST_GeomFromGeoJSON()` ile doğrudan içe aktarır
- Nehir, deniz, dağ gibi coğrafi engeller bu yaklaşımda sorun oluşturmaz çünkü polygon sınırını insan çizer

### GeoJSON Polygon Formatı

Zone senkronizasyonunda beklenen format:

```json
{
  "type": "Polygon",
  "coordinates": [
    [
      [28.9784, 41.0082],
      [29.0300, 41.0200],
      [29.0500, 41.0000],
      [28.9784, 41.0082]
    ]
  ]
}
```

- Koordinatlar `[longitude, latitude]` sırasıyla verilir (GeoJSON standardı)
- İlk ve son nokta aynı olmalıdır (kapalı halka)
- Sadece `Polygon` tipi desteklenir (`MultiPolygon` desteklenmez)

---

## Güvenlik Modeli

Servis iki katmanlı bir kimlik doğrulama sistemi kullanır:

```
┌─────────────────────────────────────────────────┐
│  x-admin-token: gat_...                         │
│  Admin işlemleri: key oluştur, listele, iptal   │
│  DB'den doğrulanır, 5 dakika önbelleklenir       │
├─────────────────────────────────────────────────┤
│  x-api-key: gsk_...                             │
│  Spatial işlemler: sync, nearby, zones          │
│  Tenant ID otomatik çözülür, 5 dakika önbelleklenir │
└─────────────────────────────────────────────────┘
```

### Admin Token (`gat_`)

- `pnpm generate:token` komutuyla üretilir
- Komut çalıştığında eski token silinir, yeni token DB'ye yazılır
- Yalnızca bir kez ekrana yazdırılır
- Token rotasyonundan sonra eski token önbellekte kalıyorsa en fazla **5 dakika** daha geçerli olur

### API Key (`gsk_`)

- `POST /api/v1/admin/keys` endpoint'iyle oluşturulur
- Her key bir `tenant_id`'ye bağlıdır
- Key, istekte `x-api-key` header'ı olarak iletilir
- İstek gövdesinde `tenant_id` gerekmez; servis key'den otomatik çözer
- `DELETE /api/v1/admin/keys/:key` ile iptal edilebilir (soft revoke)

### Multi-Tenant İzolasyon

Her spatial sorguya `WHERE tenant_id = X` koşulu otomatik eklenir. Bir proje, başka bir projenin verilerine erişemez.

```
Proje A  →  gsk_aaa...  →  tenant_id: 1  →  sadece tenant 1 verisi
Proje B  →  gsk_bbb...  →  tenant_id: 2  →  sadece tenant 2 verisi
```

---

## API Referansı

### Genel Bilgiler

- **Base URL:** `http://localhost:3000`
- **Versiyon:** `v1`
- **İçerik tipi:** `application/json`

---

### `GET /health`

Servis ve veritabanı sağlık kontrolü. Auth gerektirmez.

**Yanıt:**
```json
{ "status": "ok" }
```

---

### Admin Endpoint'leri

Tüm admin endpoint'leri `x-admin-token: gat_...` header'ı gerektirir.

---

#### `POST /api/v1/admin/keys` — API Key Oluştur

```json
// İstek gövdesi
{
  "tenant_id": 1,
  "project_name": "acme-delivery"
}
```

```json
// Yanıt
{
  "key": "gsk_...",
  "tenant_id": 1,
  "project_name": "acme-delivery"
}
```

---

#### `GET /api/v1/admin/keys` — Key Listesi

```json
// Yanıt
[
  {
    "key": "gsk_...",
    "tenant_id": 1,
    "project_name": "acme-delivery",
    "is_active": true,
    "created_at": "2026-04-22T10:00:00.000Z"
  }
]
```

---

#### `DELETE /api/v1/admin/keys/:key` — Key İptal Et

Key'i soft revoke eder (`is_active = false`). Önbellekteki kopya en fazla 5 dakika geçerli kalır.

```json
// Yanıt
{ "success": true }
```

---

### Spatial Endpoint'ler

Tüm spatial endpoint'ler `x-api-key: gsk_...` header'ı gerektirir. `tenant_id` gönderilmez — key'den otomatik çözülür.

---

#### `POST /api/v1/entities/sync` — Konum Ekle / Güncelle

Bir nesnenin nokta konumunu ekler veya günceller. Aynı `(entity_id, entity_type)` için tekrar çağrıldığında üzerine yazar.

```json
// İstek gövdesi
{
  "entity_id": "42",
  "entity_type": "restaurant",
  "lat": 47.2924,
  "lng": 11.0516,
  "is_active": true
}
```

| Alan | Tip | Zorunlu | Kural |
|---|---|---|---|
| `entity_id` | string | Evet | Min 1 karakter |
| `entity_type` | string | Evet | Min 1 karakter |
| `lat` | number | Evet | -90 ile 90 arası |
| `lng` | number | Evet | -180 ile 180 arası |
| `is_active` | boolean | Evet | — |

```json
// Yanıt
{ "success": true }
```

---

#### `GET /api/v1/entities/nearby` — Yakın Nesneler

Verilen koordinata belirtilen yarıçap içindeki aktif nesneleri mesafeye göre sıralı döner.

**Query parametreleri:**

| Parametre | Tip | Zorunlu | Varsayılan | Kural |
|---|---|---|---|---|
| `lat` | number | Evet | — | -90 ile 90 |
| `lng` | number | Evet | — | -180 ile 180 |
| `entity_type` | string | Evet | — | — |
| `radius_km` | number | Hayır | `5` | 0.1 ile 50 arası |

```json
// Yanıt
[
  { "entity_id": "42", "distance_km": "0.00" },
  { "entity_id": "17", "distance_km": "2.34" }
]
```

---

#### `POST /api/v1/zones/sync` — Zone Ekle / Güncelle

Bir nesneye ait polygon kapsama alanını ekler veya günceller. `id` dış sistemdeki (örn. Laravel) zone ID'sidir.

```json
// İstek gövdesi
{
  "id": 13,
  "entity_id": "2",
  "entity_type": "restaurant",
  "geojson": {
    "type": "Polygon",
    "coordinates": [[[10.98, 47.29], [11.05, 47.26], [11.05, 47.29], [10.98, 47.29]]]
  },
  "is_active": true
}
```

| Alan | Tip | Zorunlu | Kural |
|---|---|---|---|
| `id` | integer | Evet | Dış sistem zone ID'si |
| `entity_id` | string | Evet | — |
| `entity_type` | string | Evet | — |
| `geojson` | object | Evet | `type: "Polygon"` zorunlu |
| `is_active` | boolean | Evet | — |

```json
// Yanıt
{ "success": true }
```

---

#### `GET /api/v1/zones/check` — Zone Kapsama Kontrolü

Verilen koordinatı kapsayan zone'lara sahip nesneleri döner. Kullanım senaryosu: *"Bu adrese hangi restoranlar teslimat yapar?"*

**Query parametreleri:**

| Parametre | Tip | Zorunlu |
|---|---|---|
| `lat` | number | Evet |
| `lng` | number | Evet |
| `entity_type` | string | Evet |

```json
// Yanıt
[
  { "entity_id": "2" },
  { "entity_id": "7" }
]
```

Boş array döndüğünde o koordinat hiçbir zone tarafından kapsanmıyor demektir.

---

#### `DELETE /api/v1/zones/:id` — Zone Sil

Belirtilen ID'ye sahip zone'u siler. Yalnızca key'e bağlı tenant'a ait zone'lar silinebilir.

```json
// Yanıt
{ "success": true }
```

---

#### `POST /api/v1/routing/distances` — Yol Mesafesi ve Sürüş Süresi

> **OSRM gerektirir.** `OSRM_URL` tanımlı değilse `503` döner, diğer endpoint'ler etkilenmez.

Bir origin noktasından entity listesine kadar **yol ağı üzerinden** mesafe (km) ve tahmini sürüş süresini (dakika) hesaplar.

```json
// İstek gövdesi
{
  "origin": { "lat": 47.2924, "lng": 11.0516 },
  "destinations": [
    { "entity_id": "42", "entity_type": "restaurant" },
    { "entity_id": "17", "entity_type": "restaurant" }
  ]
}
```

| Alan | Tip | Zorunlu | Kural |
|---|---|---|---|
| `origin.lat` | number | Evet | -90 ile 90 |
| `origin.lng` | number | Evet | -180 ile 180 |
| `destinations` | array | Evet | 1–50 öğe |
| `destinations[].entity_id` | string | Evet | — |
| `destinations[].entity_type` | string | Evet | — |

```json
// Yanıt
[
  {
    "entity_id": "42",
    "entity_type": "restaurant",
    "road_distance_km": 3.47,
    "duration_min": 8.2
  },
  {
    "entity_id": "17",
    "entity_type": "restaurant",
    "road_distance_km": 6.10,
    "duration_min": 14.5
  }
]
```

OSRM ulaşılamaz durumdaysa `503` döner:

```json
{ "error": "Routing service unreachable", "osrm": "unreachable" }
```

---

---

## Konfigürasyon

### Ortam Değişkenleri (`.env`)

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `PORT` | Hayır | Dinlenecek port (varsayılan: `3000`) |
| `DB_HOST` | Evet | PostgreSQL sunucu adresi |
| `DB_PORT` | Evet | PostgreSQL port (genellikle `5432`) |
| `DB_USER` | Evet | Veritabanı kullanıcısı |
| `DB_PASS` | Hayır | Veritabanı şifresi (boş bırakılabilir) |
| `DB_NAME` | Evet | Veritabanı adı |
| `ALLOWED_IPS` | Hayır | İzin verilen IP adresleri (virgülle ayrılmış). Tanımlı değilse herkese açık. |
| `TRUST_PROXY` | Hayır | `true` yapılırsa `X-Forwarded-For` başlığından gerçek IP okunur (varsayılan: `false`) |
| `COLLECTION_TTL_MINUTES` | Hayır | Postman koleksiyon linkinin geçerlilik süresi (varsayılan: `60`) |
| `OSRM_URL` | Hayır | OSRM sunucu adresi (örn. `http://localhost:5000`). Tanımlı değilse routing devre dışı. |
| `OSRM_REGION` | Hayır | Harita bölgesi (`pnpm osrm:update` için, örn. `europe/austria`) |
| `OSRM_DATA_PATH` | Hayır | OSRM veri dizini (`pnpm osrm:update` için, örn. `/opt/osrm/data`) |
| `OSRM_CONTAINER_NAME` | Hayır | Docker container adı (varsayılan: `osrm-server`) |

### IP Kısıtlaması

`ALLOWED_IPS` tanımlı **değilse** servis herkese açık çalışır.  
`ALLOWED_IPS` tanımlıysa yalnızca listede yer alan IP adreslerinden gelen istekler kabul edilir; diğerleri `403 Forbidden` alır.

```env
# Sadece aynı sunucudan erişim (Laravel ile aynı makinedeyse)
ALLOWED_IPS=127.0.0.1,::1

# Belirli sunuculara kısıtlama
ALLOWED_IPS=127.0.0.1,::1,10.0.0.5,10.0.0.12
```

Servis başlarken aktif kısıtlama log'a yazılır:

```
{"msg":"IP kısıtlaması aktif: 127.0.0.1, ::1"}
```

Reddedilen her istek `warn` seviyesinde loglanır:

```
{"clientIp":"45.12.34.56","msg":"IP kısıtlaması: erişim reddedildi"}
```

**Nginx / reverse proxy arkasında kullanım:**  
Proxy arkasında `request.ip` her zaman proxy'nin IP'sini döner. Gerçek istemci IP'sini okumak için:

```env
ALLOWED_IPS=10.0.0.5
TRUST_PROXY=true
```

`TRUST_PROXY=true` yapılınca Fastify `X-Forwarded-For` başlığını okur. Bunu yalnızca güvenilir bir proxy arkasında açın; doğrudan internete açık sunucularda `X-Forwarded-For` başlığı sahte gelebilir.

### Rate Limiting

`server.js` içinde tanımlıdır:

```js
app.register(rateLimit, {
  max: 100,        // Pencere başına maksimum istek sayısı
  timeWindow: 60000, // Pencere süresi (ms) — 60000 = 1 dakika
});
```

Değiştirmek için bu iki satırı düzenleyin. Örneğin dakikada 200 istek için `max: 200`.

### Connection Pool

`server.js` içinde `Pool` tanımında:

```js
const pool = new Pool({
  max: 10,                    // Maksimum eş zamanlı bağlantı sayısı
  idleTimeoutMillis: 30000,   // Boştaki bağlantının kapatılma süresi (ms)
  connectionTimeoutMillis: 5000, // Bağlantı kurulamazsa timeout (ms)
});
```

### Önbellek (Cache) Süreleri

`server.js` içinde:

```js
const spatialCache = new LRUCache({ max: 500, ttl: 1000 * 60 * 5 }); // Spatial sorgular: 5 dakika
const apiKeyCache  = new LRUCache({ max: 200, ttl: 1000 * 60 * 5 }); // API key doğrulama: 5 dakika
const adminTokenCache = new LRUCache({ max: 10, ttl: 1000 * 60 * 5 }); // Admin token: 5 dakika
```

`ttl` değeri milisaniye cinsindendir. `1000 * 60 * 5` = 5 dakika.

---

## Önbellek (Cache)

### Nasıl Çalışır?

Spatial sorgular (`nearby`, `zones/check`) aynı parametrelerle tekrar geldiğinde veritabanına gidilmez; sonuç önbellekten döndürülür.

Önbellek anahtarı şu parametrelerin birleşiminden oluşur:
- `entity_type`
- `tenant_id`
- `lat`, `lng`
- `radius_km` (nearby için)

### Akıllı İptal

`entities/sync` veya `zones/sync` çağrıldığında:
- Tüm önbellek temizlenmez
- Yalnızca **ilgili `(entity_type, tenant_id)` çiftine ait** önbellek kayıtları silinir
- Diğer tenant'ların ve diğer entity tiplerinin önbelleği etkilenmez

---

## Migration Sistemi

Migration'lar `migrations/` klasöründe çift dosya olarak tutulur:

```
NNN.do.açıklama.sql    ← İleri (uygula)
NNN.undo.açıklama.sql  ← Geri (geri al)
```

`schema_migrations` tablosu hangi migration'ların uygulandığını takip eder.

### Yeni Migration Eklemek

```bash
# Dosyaları oluştur
touch migrations/006.do.add-entity-metadata.sql
touch migrations/006.undo.add-entity-metadata.sql

# Uygula
pnpm migrate
```

### Migration Komutları

```bash
pnpm migrate        # Tüm bekleyen migration'ları uygula
pnpm migrate:down   # En son migration'ı geri al
```

---

## Postman Koleksiyonu

Koleksiyon bir CLI komutuyla oluşturulur ve tek kullanımlık bir indirme linki üretilir. Link kullanıldıktan sonra otomatik olarak silinir. Aynı anda birden fazla kişi aynı linke istek atarsa sadece biri indirebilir; diğeri `404` alır (PostgreSQL `FOR UPDATE SKIP LOCKED` ile korunur).

### 1. Koleksiyonu Oluştur

Servis çalışırken:

```bash
pnpm generate:collection
```

Çıktı:

```
✓ Postman koleksiyonu hazırlandı.

  İndirme linki: http://localhost:3000/api/v1/collection/download/gcc_...
  Geçerlilik:    60 dakika (21:56'e kadar)

  Link tek kullanımlıktır. İndirildikten sonra geçersiz olur.
```

### 2. Koleksiyonu İndir

Linki tarayıcıda aç ya da curl ile indir:

```bash
curl -OJ http://localhost:3000/api/v1/collection/download/gcc_...
# geo-service.postman_collection.json olarak kaydedilir
```

Link indirme sonrasında veya süresi dolunca (`expires_at`) geçersiz hale gelir. Sunucu her başladığında süresi dolmuş token'lar otomatik temizlenir.

### 3. Postman'a Aktar

1. Postman → **Import** → İndirilen `.json` dosyasını sürükle
2. **Environment** oluştur, şu değişkenleri tanımla:

| Değişken | Değer |
|---|---|
| `base_url` | `http://localhost:3000` |
| `api_key` | `gsk_...` |
| `admin_token` | `gat_...` |

### TTL Ayarı

Varsayılan geçerlilik süresi 60 dakikadır. `.env` dosyasına şu satırı ekleyerek değiştirebilirsin:

```env
COLLECTION_TTL_MINUTES=30
```

---

## OSRM Yol Mesafesi

OSRM (Open Source Routing Machine), OpenStreetMap verilerini kullanarak yol ağı üzerinden gerçek mesafe ve sürüş süresi hesaplar. Servis OSRM olmadan da tamamen çalışır; routing özelliği opsiyoneldir.

### OSRM Nedir?

- **Kuş uçuşu mesafe** → `ST_DistanceSphere` (PostGIS, her zaman aktif)
- **Yol mesafesi + süre** → OSRM Table API (opsiyonel, Docker gerektirir)

`OSRM_URL` tanımlı olmadığında `POST /api/v1/routing/distances` endpoint'i `503` döner; `/health` endpoint'i `"osrm": "disabled"` bilgisini verir. Diğer tüm endpoint'ler etkilenmez.

### Sunucu Gereksinimleri

| Bileşen | Minimum | Önerilen |
|---|---|---|
| RAM | 4 GB | 8 GB+ |
| Disk | 5 GB (küçük bölge) | 50 GB+ (Avrupa) |
| Docker | Kurulu olmalı | — |

> Küçük bir ülke verisi (~500 MB PBF) işlenmiş halde ~2 GB disk kaplar.

### Docker ile OSRM Kurulumu

#### 1. Ortam Değişkenlerini Ayarla

`.env` dosyasına ekle:

```env
OSRM_URL=http://localhost:5000
OSRM_REGION=europe/austria
OSRM_DATA_PATH=/opt/osrm/data
OSRM_CONTAINER_NAME=osrm-server
```

#### 2. Harita Verisini İndir ve İşle

```bash
pnpm osrm:update
```

Bu komut sırayla şunları yapar:

1. Geofabrik'ten bölgenin OSM PBF dosyasını indirir
2. `osrm-extract` — yol ağını çıkarır
3. `osrm-partition` — Multi-Level Dijkstra için bölümlere ayırır
4. `osrm-customize` — ağırlık ve kısıtlamaları uygular
5. OSRM container'ını yeniden başlatır

İlk çalıştırmada container henüz yoksa komut başlatma talimatını ekrana yazar:

```
  docker run -d --name osrm-server --restart unless-stopped \
    -p 5000:5000 -v "/opt/osrm/data:/data" \
    ghcr.io/project-osrm/osrm-backend \
    osrm-routed --algorithm mld /data/austria.osrm
```

#### 3. Sağlık Kontrolü

```bash
curl http://localhost:3000/health
# { "status": "ok", "osrm": "ok" }
```

`osrm` değerleri: `"disabled"` (URL yok), `"ok"` (servis çalışıyor), `"unreachable"` (URL var ama cevap vermiyor).

### Veri Güncelleme

OpenStreetMap verileri sürekli değişir. Harita verisini güncel tutmak için:

```bash
pnpm osrm:update
```

Haftalık veya aylık çalıştırmak yeterlidir. Komut indir → işle → yeniden başlat akışını otomatik yönetir.

### Bölge Örnekleri

```env
# Avusturya
OSRM_REGION=europe/austria

# Türkiye
OSRM_REGION=europe/turkey

# Almanya
OSRM_REGION=europe/germany

# Türkiye'nin belirli bir bölgesi (daha hızlı işlem)
OSRM_REGION=europe/turkey/marmara-region-latest
```

Geçerli bölge listesi için: [download.geofabrik.de](https://download.geofabrik.de)

---

## Yeni Bir Projeyi Entegre Etmek

```bash
# 1. Admin token ile yeni proje için key oluştur
curl -X POST http://localhost:3000/api/v1/admin/keys \
  -H "x-admin-token: gat_..." \
  -H "Content-Type: application/json" \
  -d '{"tenant_id": 3, "project_name": "yeni-proje"}'

# Yanıt: { "key": "gsk_...", "tenant_id": 3, "project_name": "yeni-proje" }

# 2. Bu key'i projenin .env dosyasına ekle
GEO_SERVICE_KEY=gsk_...
GEO_SERVICE_URL=http://geo-service:3000

# 3. Artık spatial endpoint'leri kullanabilirsin
curl -X POST http://localhost:3000/api/v1/entities/sync \
  -H "x-api-key: gsk_..." \
  -H "Content-Type: application/json" \
  -d '{"entity_id":"1","entity_type":"store","lat":41.01,"lng":28.97,"is_active":true}'
```
