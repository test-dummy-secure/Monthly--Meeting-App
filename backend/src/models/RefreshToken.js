// src/models/RefreshToken.js
import { query } from '../../database/index.js';

export const createRefreshToken = async (userId, token, expiresAt) => {
  const result = await query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3) RETURNING id, token, expires_at, revoked`,
    [userId, token, expiresAt]
  );
  return result.rows[0];
};

export const revokeRefreshToken = async (token) => {
  await query(`UPDATE refresh_tokens SET revoked = TRUE WHERE token = $1`, [token]);
};

export const findValidRefreshToken = async (token) => {
  const result = await query(
    `SELECT * FROM refresh_tokens WHERE token = $1 AND revoked = FALSE AND expires_at > NOW()`,
    [token]
  );
  return result.rows[0];
};
