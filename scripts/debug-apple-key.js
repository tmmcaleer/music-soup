/**
 * Debug Apple Music Private Key Format
 */

const config = require('./config');

console.log('🔍 Apple Music Private Key Debug:');
console.log('================================');

const privateKey = config.appleMusic.privateKey;

if (!privateKey) {
  console.log('❌ Private key is missing or empty');
  process.exit(1);
}

console.log('✅ Private key exists');
console.log(`📏 Length: ${privateKey.length} characters`);
console.log(`🔤 First 50 chars: "${privateKey.substring(0, 50)}"`);
console.log(`🔤 Last 50 chars: "${privateKey.substring(privateKey.length - 50)}"`);

// Check for common issues
console.log('\n🔍 Key Format Checks:');
console.log(`  Starts with BEGIN: ${privateKey.startsWith('-----BEGIN PRIVATE KEY-----')}`);
console.log(`  Ends with END: ${privateKey.endsWith('-----END PRIVATE KEY-----')}`);
console.log(`  Contains newlines: ${privateKey.includes('\n')}`);
console.log(`  Contains \\n escaped: ${privateKey.includes('\\n')}`);

// Check line structure
const lines = privateKey.split('\n');
console.log(`\n📄 Line structure:`);
console.log(`  Total lines: ${lines.length}`);
lines.forEach((line, i) => {
  if (i < 3 || i > lines.length - 4) { // Show first 3 and last 3 lines
    console.log(`  Line ${i + 1}: "${line}"`);
  } else if (i === 3) {
    console.log(`  ... (${lines.length - 6} middle lines hidden)`);
  }
});

// Test JWT signing
console.log('\n🧪 Testing JWT signing:');
try {
  const jwt = require('jsonwebtoken');
  const payload = { test: 'value', iat: Math.floor(Date.now() / 1000) };
  
  const token = jwt.sign(payload, privateKey, {
    algorithm: 'ES256',
    keyid: config.appleMusic.keyId,
  });
  
  console.log('✅ JWT signing successful!');
  console.log(`🎫 Token preview: ${token.substring(0, 50)}...`);
} catch (error) {
  console.log('❌ JWT signing failed:');
  console.log(`   Error: ${error.message}`);
}
