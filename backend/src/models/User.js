// src/models/User.js
import { query } from '../../database/index.js';

export const createUser = async (email, passwordHash, role = 'account_manager') => {
  const result = await query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role, created_at, updated_at`,
    [email, passwordHash, role]
  );
  return result.rows[0];
};

export const findUserByEmail = async (email) => {
  const result = await query(`SELECT * FROM users WHERE email = $1`, [email]);
  return result.rows[0];
};

export const findUserById = async (id) => {
  const result = await query(`SELECT id, email, role, created_at, updated_at FROM users WHERE id = $1`, [id]);
  return result.rows[0];
};

export const updateUserPassword = async (id, newPasswordHash) => {
  const result = await query(
    `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, email, role, updated_at`,
    [newPasswordHash, id]
  );
  return result.rows[0];
};
