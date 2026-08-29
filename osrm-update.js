require('dotenv').config();

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const REGION = process.env.OSRM_REGION;
const DATA_PATH = process.env.OSRM_DATA_PATH;
const CONTAINER_NAME = process.env.OSRM_CONTAINER_NAME || 'osrm-server';

// ---------------------------------------------------------------------------
// Doğrulama
// ---------------------------------------------------------------------------
if (!REGION) {
  console.error('[HATA] OSRM_REGION tanımlı değil. Örnek: europe/austria');
  process.exit(1);
}
if (!DATA_PATH) {
  console.error('[HATA] OSRM_DATA_PATH tanımlı değil. Örnek: /opt/osrm/data');
  process.exit(1);
}

// Docker erişilebilir mi?
try {
  execSync('docker info', { stdio: 'ignore' });
} catch {
  console.error('[HATA] Docker çalışmıyor veya erişilemiyor.');
  process.exit(1);
}

const regionName = REGION.split('/').pop(); // europe/austria → austria
const pbfFile = path.join(DATA_PATH, `${regionName}.osm.pbf`);
const osrmFile = path.join(DATA_PATH, `${regionName}.osrm`);
const downloadUrl = `https://download.geofabrik.de/${REGION}-latest.osm.pbf`;

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------
function run(label, cmd) {
  console.log(`\n[${label}] Çalışıyor...`);
  execSync(cmd, { stdio: 'inherit' });
  console.log(`[${label}] Tamamlandı.`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`\n[İNDİRME] ${url}`);

    const tmp = `${dest}.tmp`;
    const file = fs.createWriteStream(tmp);

    const request = https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(tmp);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(tmp);
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      let lastPrint = 0;

      res.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPrint && pct % 10 === 0) {
            process.stdout.write(`\r  %${pct} indirildi...`);
            lastPrint = pct;
          }
        }
      });

      res.pipe(file);
      file.on('finish', () => {
        file.close();
        fs.renameSync(tmp, dest);
        console.log(`\n[İNDİRME] Tamamlandı → ${dest}`);
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Ana akış
// ---------------------------------------------------------------------------
async function update() {
  console.log(`\n=== OSRM Veri Güncelleme ===`);
  console.log(`Bölge     : ${REGION}`);
  console.log(`Veri dizini: ${DATA_PATH}`);

  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(DATA_PATH, { recursive: true });
    console.log(`[BİLGİ] Dizin oluşturuldu: ${DATA_PATH}`);
  }

  // 1. OSM verisini indir
  await download(downloadUrl, pbfFile);

  // 2. Extract
  run(
    'EXTRACT',
    `docker run --rm -v "${DATA_PATH}:/data" ghcr.io/project-osrm/osrm-backend osrm-extract -p /opt/car.lua /data/${regionName}.osm.pbf`,
  );

  // 3. Partition
  run(
    'PARTITION',
    `docker run --rm -v "${DATA_PATH}:/data" ghcr.io/project-osrm/osrm-backend osrm-partition /data/${regionName}.osrm`,
  );

  // 4. Customize
  run(
    'CUSTOMIZE',
    `docker run --rm -v "${DATA_PATH}:/data" ghcr.io/project-osrm/osrm-backend osrm-customize /data/${regionName}.osrm`,
  );

  // 5. OSRM container'ı yeniden başlat
  try {
    run('RESTART', `docker restart ${CONTAINER_NAME}`);
  } catch {
    console.log(
      `[BİLGİ] "${CONTAINER_NAME}" container'ı bulunamadı. İlk kurulumsa aşağıdaki komutla başlatın:`,
    );
    console.log(`\n  docker run -d --name ${CONTAINER_NAME} --restart unless-stopped \\`);
    console.log(`    -p 5000:5000 -v "${DATA_PATH}:/data" \\`);
    console.log(`    ghcr.io/project-osrm/osrm-backend \\`);
    console.log(`    osrm-routed --algorithm mld /data/${regionName}.osrm\n`);
  }

  console.log('\n✓ OSRM verisi güncellendi.\n');
}

update().catch((err) => {
  console.error('\n[HATA]', err.message);
  process.exit(1);
});
