'use strict';
const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
async function main() {
  const { rows: tenants } = await pool.query(
    `SELECT id, name FROM customers WHERE name IN ('Bizmetric', 'threeacross', 'NXGSecure') ORDER BY name`
  );
  console.log('=== "reports" table (what the frontend UI actually reads) ===');
  for (const t of tenants) {
    const { rows } = await pool.query(`SELECT id, report_type, generated_at FROM reports WHERE tenant_id = $1 ORDER BY generated_at DESC LIMIT 3`, [t.id]);
    console.log(`${t.name}: ${rows.length} row(s)`);
    rows.forEach(r => console.log(`   [${r.report_type}] ${r.generated_at}`));
  }
  const { rows: totalReports } = await pool.query(`SELECT COUNT(*) FROM reports`);
  console.log(`\nTotal rows in "reports" table across ALL tenants: ${totalReports[0].count}`);
  await pool.end();
}
main().catch(async e => { console.error('ERROR:', e.message); await pool.end(); });
