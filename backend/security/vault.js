const crypto = require('crypto');

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;

function getEncryptionKey() {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
    throw new Error('ENCRYPTION_KEY must be set before encrypting or decrypting API keys');
  }

  // Stable 32-byte key for AES-256. This lets MVP env keys be any length while
  // still producing an AES-256 key. Rotate carefully in production.
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt an API key with AES-256-GCM.
 * Output format: v1:<iv_base64>:<auth_tag_base64>:<ciphertext_base64>
 * @param {string} plainTextApiKey
 * @returns {string}
 */
function encryptKey(plainTextApiKey) {
  if (!plainTextApiKey || typeof plainTextApiKey !== 'string') {
    throw new Error('Invalid API key: must be a non-empty string');
  }

  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plainTextApiKey, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Decrypt an API key encrypted by encryptKey().
 * @param {string} encryptedApiKey
 * @returns {string}
 */
function decryptKey(encryptedApiKey) {
  if (!encryptedApiKey || typeof encryptedApiKey !== 'string') {
    throw new Error('Invalid encrypted key: must be a non-empty string');
  }

  const [version, ivBase64, tagBase64, ciphertextBase64] = encryptedApiKey.split(':');
  if (version !== VERSION || !ivBase64 || !tagBase64 || !ciphertextBase64) {
    throw new Error('Invalid encrypted key payload');
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivBase64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));

  const plainText = Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, 'base64')),
    decipher.final(),
  ]);

  return plainText.toString('utf8');
}

module.exports = {
  encryptKey,
  decryptKey,
};
