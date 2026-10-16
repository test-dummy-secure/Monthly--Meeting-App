'use strict';
const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
async function main() {
  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'reports' ORDER BY ordinal_position`
  );
  rows.forEach(r => console.log(r.column_name, '-', r.data_type, r.is_nullable === 'NO' ? '(required)' : ''));
  await pool.end();
}
main().catch(async e => { console.error(e.message); await pool.end(); });
