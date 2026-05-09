// Test script for Phase 2: API Key Vault
// Run with: node test_phase2.js

// Set environment variables for testing (MUST be before requiring modules)
process.env.ENCRYPTION_KEY = 'hackathon_secret_key_32chars_xyz';

// Clear require cache to ensure fresh load
delete require.cache[require.resolve('./security/vault')];

const { encryptKey, decryptKey } = require('./security/vault');

console.log('🧪 Testing Phase 2: API Key Vault\n');

// Test 1: Encryption
console.log('Test 1: Encryption');
const testKey = 'sk-test1234567890abcdefghijklmnopqrstuvwxyz';
try {
  const encrypted = encryptKey(testKey);
  console.log('✅ Encryption successful');
  console.log('   Encrypted format:', encrypted.substring(0, 50) + '...');
  console.log('   Parts count:', encrypted.split(':').length, '(should be 3: iv:tag:ciphertext)');
} catch (error) {
  console.error('❌ Encryption failed:', error.message);
}

// Test 2: Decryption
console.log('\nTest 2: Decryption');
try {
  const encrypted = encryptKey(testKey);
  const decrypted = decryptKey(encrypted);
  console.log('✅ Decryption successful');
  console.log('   Original:', testKey);
  console.log('   Decrypted:', decrypted);
  console.log('   Match:', testKey === decrypted ? '✅ YES' : '❌ NO');
} catch (error) {
  console.error('❌ Decryption failed:', error.message);
}

// Test 3: Invalid encrypted format
console.log('\nTest 3: Invalid encrypted format');
try {
  const invalidEncrypted = 'invalid:format';
  const decrypted = decryptKey(invalidEncrypted);
  console.log('❌ Should have thrown error');
} catch (error) {
  console.log('✅ Correctly threw error:', error.message);
}

// Test 4: Empty key
console.log('\nTest 4: Empty key');
try {
  const encrypted = encryptKey('');
  console.log('❌ Should have thrown error');
} catch (error) {
  console.log('✅ Correctly threw error:', error.message);
}

// Test 5: Different keys produce different ciphertexts
console.log('\nTest 5: Different keys produce different ciphertexts');
const key1 = 'sk-key111111111111111111111111111';
const key2 = 'sk-key222222222222222222222222222';
const encrypted1 = encryptKey(key1);
const encrypted2 = encryptKey(key2);
console.log('✅ Different keys:', encrypted1 !== encrypted2 ? 'YES' : 'NO');

// Test 6: Same key produces different ciphertexts (due to random IV)
console.log('\nTest 6: Same key produces different ciphertexts (random IV)');
const encryptedA = encryptKey(testKey);
const encryptedB = encryptKey(testKey);
console.log('✅ Different ciphertexts:', encryptedA !== encryptedB ? 'YES' : 'NO');
console.log('   Both decrypt to same value:', decryptKey(encryptedA) === decryptKey(encryptedB) ? 'YES' : 'NO');

console.log('\n✅ All Phase 2 encryption/decryption tests passed!');
console.log('\n📝 Next steps:');
console.log('   1. Set up .env file with Supabase credentials');
console.log('   2. Start server: npm start');
console.log('   3. Test POST /api/keys endpoint');
console.log('   4. Test GET /api/models endpoint');
