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

async function generateToken() {
  const token = `gat_${crypto.randomBytes(32).toString('hex')}`;

  await pool.query('DELETE FROM admin_tokens');
  await pool.query('INSERT INTO admin_tokens (token) VALUES ($1)', [token]);

  console.log('\n✓ Admin token oluşturuldu. Güvenli bir yere kaydedin, bir daha gösterilmeyecek:\n');
  console.log(`  ${token}\n`);
}

generateToken()
  .catch((err) => {
    console.error('Hata:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
