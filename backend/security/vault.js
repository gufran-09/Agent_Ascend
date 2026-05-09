// HACKATHON MODE: No encryption — plain text passthrough
// TODO: Re-enable AES-256-GCM encryption for production (see git history)

/**
 * "Encrypt" an API key (hackathon: plain text passthrough)
 * @param {string} plainTextApiKey - The API key
 * @returns {string} The same key (no encryption)
 */
function encryptKey(plainTextApiKey) {
  if (!plainTextApiKey || typeof plainTextApiKey !== 'string') {
    throw new Error('Invalid API key: must be a non-empty string');
  }
  return plainTextApiKey;
}

/**
 * "Decrypt" an API key (hackathon: plain text passthrough)
 * @param {string} encryptedApiKey - The stored key
 * @returns {string} The same key (no decryption)
 */
function decryptKey(encryptedApiKey) {
  if (!encryptedApiKey || typeof encryptedApiKey !== 'string') {
    throw new Error('Invalid encrypted key: must be a non-empty string');
  }
  return encryptedApiKey;
}

module.exports = {
  encryptKey,
  decryptKey
};

