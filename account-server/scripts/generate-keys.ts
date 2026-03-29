#!/usr/bin/env tsx
/**
 * Generate RSA-2048 key pair for JWT RS256 signing.
 *
 * Usage:
 *   tsx scripts/generate-keys.ts [output-dir]
 *
 * Default output: data/keys/
 *
 * After generation, set in your .env:
 *   JWT_PRIVATE_KEY_PATH=data/keys/jwt-private.pem
 *
 * Or for key rotation support:
 *   JWKS_KEY_DIR=data/keys/
 */
import path from 'path';
import { generateKeyFiles } from '../src/jwks';

const outputDir = process.argv[2] || path.join(__dirname, '..', 'data', 'keys');

console.log('[generate-keys] Generating RSA-2048 key pair...');
console.log(`[generate-keys] Output directory: ${outputDir}`);

const result = generateKeyFiles(outputDir);

console.log('');
console.log('Add to your .env:');
console.log(`  JWT_PRIVATE_KEY_PATH=${result.privateKeyPath}`);
console.log('');
console.log('Or for key rotation:');
console.log(`  JWKS_KEY_DIR=${path.dirname(result.privateKeyPath)}`);
console.log('');
console.log('The JWKS endpoint will be available at:');
console.log('  GET /.well-known/jwks.json');
