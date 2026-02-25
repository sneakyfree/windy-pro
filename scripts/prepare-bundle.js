#!/usr/bin/env node
// Prepares platform-specific bundled dependencies for electron-builder
// For cross-compile (win/mac from linux): bundles Python + ffmpeg + model only
// Venv gets created at first-run by the dependency-installer using bundled Python
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const platform = process.argv[2];
if (!['win', 'mac', 'linux'].includes(platform)) {
  console.error('Usage: node prepare-bundle.js <win|mac|linux>');
  process.exit(1);
}

const bundledDir = path.join(__dirname, '..', 'bundled');
const targetDir = path.join(__dirname, '..', 'extraResources');

if (fs.existsSync(targetDir)) {
  execSync(`rm -rf "${targetDir}"`);
}
fs.mkdirSync(targetDir, { recursive: true });

// 1. Copy Python
const pythonMap = { win: 'win64', mac: 'macos', linux: 'linux' };
const pythonSrc = path.join(bundledDir, 'python', pythonMap[platform], 'python');
const pythonDst = path.join(targetDir, 'python');
console.log(`Copying Python (${platform})...`);
execSync(`cp -r "${pythonSrc}" "${pythonDst}"`);

// 2. Copy ffmpeg
const ffmpegDst = path.join(targetDir, 'ffmpeg');
fs.mkdirSync(ffmpegDst, { recursive: true });
if (platform === 'win') {
  fs.copyFileSync(
    path.join(bundledDir, 'ffmpeg', 'extracted-win', 'ffmpeg-8.0.1-essentials_build', 'bin', 'ffmpeg.exe'),
    path.join(ffmpegDst, 'ffmpeg.exe')
  );
} else if (platform === 'mac') {
  fs.copyFileSync(path.join(bundledDir, 'ffmpeg', 'extracted-mac', 'ffmpeg'), path.join(ffmpegDst, 'ffmpeg'));
  fs.chmodSync(path.join(ffmpegDst, 'ffmpeg'), 0o755);
} else {
  fs.copyFileSync(
    path.join(bundledDir, 'ffmpeg', 'extracted-linux', 'ffmpeg-7.0.2-amd64-static', 'ffmpeg'),
    path.join(ffmpegDst, 'ffmpeg')
  );
  fs.chmodSync(path.join(ffmpegDst, 'ffmpeg'), 0o755);
}

// 3. Copy Whisper model
const modelDst = path.join(targetDir, 'model', 'faster-whisper-base');
console.log('Copying Whisper model...');
execSync(`mkdir -p "${path.dirname(modelDst)}" && cp -r "${path.join(bundledDir, 'model', 'faster-whisper-base')}" "${modelDst}"`);

// 4. For native platform, also create venv with faster-whisper
if ((platform === 'linux' && process.platform === 'linux') ||
    (platform === 'mac' && process.platform === 'darwin')) {
  const venvDir = path.join(targetDir, 'venv');
  const pyBin = path.join(pythonDst, 'bin', 'python3');
  console.log('Creating venv...');
  execSync(`"${pyBin}" -m venv "${venvDir}"`, { stdio: 'inherit' });
  console.log('Installing faster-whisper...');
  execSync(`"${path.join(venvDir, 'bin', 'pip')}" install faster-whisper`, { stdio: 'inherit', timeout: 300000 });
} else {
  console.log(`Cross-compile: skipping venv (will be created at first-run)`);
}

const getSize = (dir) => {
  try { return execSync(`du -sh "${dir}" 2>/dev/null`).toString().split('\t')[0].trim(); }
  catch { return '?'; }
};
console.log(`\nBundle: Python=${getSize(pythonDst)} ffmpeg=${getSize(ffmpegDst)} Model=${getSize(modelDst)} Total=${getSize(targetDir)}`);
console.log('Done!');
