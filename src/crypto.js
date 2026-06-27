import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Symmetric encryption for secrets at rest (the Skool password) and password
 * hashing for the admin login. The encryption key is derived from APP_SECRET,
 * which MUST be set in the environment (never stored in the data store).
 */

function key() {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('APP_SECRET must be set (>=16 chars) to encrypt/decrypt credentials');
  }
  // Derive a stable 32-byte key from the secret.
  return scryptSync(secret, 'skooltool-static-salt', 32);
}

/** AES-256-GCM encrypt a string -> "iv.tag.ciphertext" (base64). */
export function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

/** Decrypt a value produced by encrypt(). Returns '' for empty input. */
export function decrypt(payload) {
  if (!payload) return '';
  const [ivB64, tagB64, dataB64] = String(payload).split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted value');
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Hash an admin password for storage: "salt.hash" (scrypt, base64). */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 64);
  return `${salt.toString('base64')}.${hash.toString('base64')}`;
}

/** Constant-time verify an admin password against a stored "salt.hash". */
export function verifyPassword(password, stored) {
  if (!stored || !stored.includes('.')) return false;
  const [saltB64, hashB64] = stored.split('.');
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(String(password), salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
