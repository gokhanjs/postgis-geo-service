require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DB_CONFIG = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASS || '',
};

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Hedef veritabanı yoksa oluştur.
// CREATE DATABASE transaction içinde çalışmaz,
// bu yüzden sistem veritabanı "postgres" üzerinden ayrı bir bağlantıyla yapılır.
async function ensureDatabase() {
  const adminPool = new Pool({ ...DB_CONFIG, database: 'postgres' });
  try {
    const { rows } = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      process.env.DB_NAME,
    ]);
    if (rows.length === 0) {
      // Veritabanı adını doğrudan parametre olarak geçemeyiz,
      // ama bu değer .env'den geliyor ve sadece harf/rakam/_ içermeli.
      if (!/^[a-zA-Z0-9_]+$/.test(process.env.DB_NAME)) {
        throw new Error('Güvensiz veritabanı adı. Sadece harf, rakam ve _ kullanın.');
      }
      await adminPool.query(`CREATE DATABASE ${process.env.DB_NAME}`);
      console.log(`[DB] "${process.env.DB_NAME}" veritabanı oluşturuldu.`);
    } else {
      console.log(`[DB] "${process.env.DB_NAME}" zaten mevcut.`);
    }
  } finally {
    await adminPool.end();
  }
}

const pool = new Pool({ ...DB_CONFIG, database: process.env.DB_NAME });

// Hangi migration'ların çalıştırıldığını tutan tablo
const ENSURE_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    filename   TEXT NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

async function getAppliedVersions(client) {
  const { rows } = await client.query('SELECT version FROM schema_migrations ORDER BY version ASC');
  return new Set(rows.map((r) => r.version));
}

async function migrate() {
  const command = process.argv[2] || 'up';

  await ensureDatabase();

  const client = await pool.connect();

  try {
    await client.query(ENSURE_TABLE);

    // Sadece "do" (ileri) dosyalarını al, versiyona göre sırala
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const doFiles = files.filter((f) => f.includes('.do.'));
    const undoFiles = files.filter((f) => f.includes('.undo.'));

    if (command === 'up') {
      const applied = await getAppliedVersions(client);
      const pending = doFiles.filter((f) => {
        const version = f.split('.')[0];
        return !applied.has(version);
      });

      if (pending.length === 0) {
        console.log('Çalıştırılacak migration yok, veritabanı güncel.');
        return;
      }

      for (const file of pending) {
        const version = file.split('.')[0];
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        console.log(`[UP] ${file}`);
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, filename) VALUES ($1, $2)', [
          version,
          file,
        ]);
        await client.query('COMMIT');
      }
      console.log('Migration tamamlandı.');
    } else if (command === 'down') {
      const applied = await getAppliedVersions(client);
      if (applied.size === 0) {
        console.log('Geri alınacak migration yok.');
        return;
      }

      // En son uygulananı geri al
      const lastVersion = [...applied].sort().pop();
      const undoFile = undoFiles.find((f) => f.startsWith(lastVersion));

      if (!undoFile) {
        console.error(`[HATA] ${lastVersion} için undo dosyası bulunamadı.`);
        process.exit(1);
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, undoFile), 'utf8');
      console.log(`[DOWN] ${undoFile}`);
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [lastVersion]);
      await client.query('COMMIT');
      console.log('Geri alma tamamlandı.');
    } else {
      console.error('Geçersiz komut. Kullanım: node migrate.js [up|down]');
      process.exit(1);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration hatası:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
