const crypto = require('crypto');

const ALGORITHM  = 'aes-256-gcm';
const IV_LENGTH  = 12; // bytes — GCM recommended
const TAG_LENGTH = 16; // bytes

// ─── Key loading ──────────────────────────────────────────────────────────────

const getKey = () => {
  const hex = process.env.NXG360_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('NXG360_ENCRYPTION_KEY environment variable is not set');
  }
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    throw new Error('NXG360_ENCRYPTION_KEY must be a 64-character hex string (32 bytes for AES-256)');
  }
  return buf;
};

// ─── Encrypt ──────────────────────────────────────────────────────────────────
// Returns: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
// The format is self-contained — no external metadata needed for decryption.

const encrypt = (plaintext) => {
  if (typeof plaintext !== 'string' || !plaintext) {
    throw new Error('encrypt: plaintext must be a non-empty string');
  }
  const key     = getKey();
  const iv      = crypto.randomBytes(IV_LENGTH);
  const cipher  = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${enc.toString('hex')}`;
};

// ─── Decrypt ──────────────────────────────────────────────────────────────────

const decrypt = (stored) => {
  if (typeof stored !== 'string') throw new Error('decrypt: invalid input');
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('decrypt: malformed ciphertext — expected iv:tag:data');
  const [ivHex, tagHex, encHex] = parts;
  const key      = getKey();
  const iv       = Buffer.from(ivHex,  'hex');
  const authTag  = Buffer.from(tagHex, 'hex');
  const encBuf   = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encBuf), decipher.final()]).toString('utf8');
};

module.exports = { encrypt, decrypt };
