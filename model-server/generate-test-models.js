#!/usr/bin/env node
/**
 * Windy Pro v2.0 — Test Model Generator
 * 
 * Creates placeholder .wpr model files in ./models/ for all 15 models.
 * Each file has:
 *   - WNDY0001 magic bytes (8 bytes)
 *   - Model tier byte (1 byte: 0=free, 1=plus, 2=pro, 3=promax)
 *   - Model family byte (1 byte: 0=core, 1=edge, 2=lingua)
 *   - Model ID (32 bytes, null-padded)
 *   - Version (4 bytes: major.minor as uint16 each)
 *   - Reserved header space (up to 256 bytes total)
 *   - Random data padded to 1/100th of real model size
 * 
 * Usage:
 *   node generate-test-models.js          # Generate all 15 test models
 *   node generate-test-models.js --clean  # Delete existing and regenerate
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODELS_DIR = path.join(__dirname, 'models');
const HEADER_SIZE = 256; // bytes reserved for header
const SIZE_DIVISOR = 100; // 1/100th of real size for testing

const TIER_BYTE = { free: 0, plus: 1, pro: 2, promax: 3 };
const FAMILY_BYTE = { core: 0, edge: 1, lingua: 2 };

const MODELS = [
    { id: 'core-spark', family: 'core', sizeMB: 75, tier: 'free' },
    { id: 'core-pulse', family: 'core', sizeMB: 142, tier: 'plus' },
    { id: 'core-standard', family: 'core', sizeMB: 466, tier: 'plus' },
    { id: 'core-global', family: 'core', sizeMB: 1500, tier: 'pro' },
    { id: 'core-pro', family: 'core', sizeMB: 1500, tier: 'pro' },
    { id: 'core-turbo', family: 'core', sizeMB: 1600, tier: 'pro' },
    { id: 'core-ultra', family: 'core', sizeMB: 2900, tier: 'promax' },
    { id: 'edge-spark', family: 'edge', sizeMB: 42, tier: 'free' },
    { id: 'edge-pulse', family: 'edge', sizeMB: 78, tier: 'free' },
    { id: 'edge-standard', family: 'edge', sizeMB: 168, tier: 'plus' },
    { id: 'edge-global', family: 'edge', sizeMB: 515, tier: 'pro' },
    { id: 'edge-pro', family: 'edge', sizeMB: 515, tier: 'pro' },
    { id: 'lingua-es', family: 'lingua', sizeMB: 500, tier: 'pro' },
    { id: 'lingua-fr', family: 'lingua', sizeMB: 500, tier: 'pro' },
    { id: 'lingua-hi', family: 'lingua', sizeMB: 500, tier: 'pro' },
];

function buildHeader(model) {
    const header = Buffer.alloc(HEADER_SIZE, 0);

    // Magic bytes: WNDY0001 (8 bytes)
    header.write('WNDY0001', 0, 8, 'ascii');

    // Tier byte (offset 8)
    header.writeUInt8(TIER_BYTE[model.tier] || 0, 8);

    // Family byte (offset 9)
    header.writeUInt8(FAMILY_BYTE[model.family] || 0, 9);

    // Model ID (offset 10, 32 bytes, null-padded)
    header.write(model.id, 10, 32, 'ascii');

    // Version: 2.0 (offset 42, two uint16)
    header.writeUInt16LE(2, 42); // major
    header.writeUInt16LE(0, 44); // minor

    // Real size in MB (offset 46, uint32, for verification)
    header.writeUInt32LE(model.sizeMB, 46);

    // Timestamp (offset 50, uint32, unix epoch)
    header.writeUInt32LE(Math.floor(Date.now() / 1000), 50);

    // Checksum placeholder (offset 54, 32 bytes for SHA-256, filled later)
    // offset 54-85 reserved for checksum

    // Marker at end of header
    header.write('ENDH', HEADER_SIZE - 4, 4, 'ascii');

    return header;
}

function generateModel(model) {
    const filePath = path.join(MODELS_DIR, `${model.id}.wpr`);

    // Target size: 1/100th of real size, minimum 100KB
    const targetBytes = Math.max(
        100 * 1024, // 100 KB minimum
        Math.round((model.sizeMB * 1024 * 1024) / SIZE_DIVISOR)
    );

    const dataBytes = targetBytes - HEADER_SIZE;

    console.log(`  📦 ${model.id.padEnd(16)} ${formatBytes(targetBytes).padStart(10)} (real: ${model.sizeMB} MB)`);

    // Build header
    const header = buildHeader(model);

    // Write file: header + random data in chunks (to avoid massive buffer allocation)
    const fd = fs.openSync(filePath, 'w');
    fs.writeSync(fd, header, 0, HEADER_SIZE);

    // Write random data in 1MB chunks
    const CHUNK_SIZE = 1024 * 1024; // 1 MB
    let remaining = dataBytes;
    while (remaining > 0) {
        const chunkLen = Math.min(CHUNK_SIZE, remaining);
        const chunk = crypto.randomBytes(chunkLen);
        fs.writeSync(fd, chunk, 0, chunkLen);
        remaining -= chunkLen;
    }

    fs.closeSync(fd);

    // Verify
    const stat = fs.statSync(filePath);
    return { id: model.id, path: filePath, size: stat.size, expected: targetBytes };
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Main ───

console.log('');
console.log('🌪️  Windy Pro v2.0 — Test Model Generator');
console.log(`   Output: ${MODELS_DIR}`);
console.log(`   Scale:  1/${SIZE_DIVISOR} of real sizes`);
console.log('');

// Clean if requested
if (process.argv.includes('--clean')) {
    if (fs.existsSync(MODELS_DIR)) {
        const files = fs.readdirSync(MODELS_DIR).filter(f => f.endsWith('.wpr'));
        files.forEach(f => fs.unlinkSync(path.join(MODELS_DIR, f)));
        console.log(`   🧹 Cleaned ${files.length} existing model files`);
        console.log('');
    }
}

// Create models directory
fs.mkdirSync(MODELS_DIR, { recursive: true });

console.log('   Generating models:');
console.log('');

const results = [];
let totalBytes = 0;

for (const model of MODELS) {
    const result = generateModel(model);
    results.push(result);
    totalBytes += result.size;
}

console.log('');
console.log(`   ✅ Generated ${results.length} test model files`);
console.log(`   📊 Total size: ${formatBytes(totalBytes)}`);
console.log('');

// Verify all headers
let verified = 0;
for (const result of results) {
    const fd = fs.openSync(result.path, 'r');
    const header = Buffer.alloc(8);
    fs.readSync(fd, header, 0, 8, 0);
    fs.closeSync(fd);
    if (header.toString('ascii', 0, 8) === 'WNDY0001') {
        verified++;
    } else {
        console.error(`   ❌ HEADER VERIFICATION FAILED: ${result.id}`);
    }
}

console.log(`   🔍 Header verification: ${verified}/${results.length} passed`);
console.log('');
console.log('   Done! Start the server:');
console.log('     node server.js');
console.log('');
