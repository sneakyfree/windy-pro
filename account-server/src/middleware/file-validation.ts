/**
 * File Upload Validation — Magic byte verification.
 *
 * Bonus: Validates that uploaded file magic bytes match the declared MIME type.
 * Prevents content-type spoofing attacks where a malicious file is uploaded
 * with an innocent MIME type.
 *
 * Uses the built-in `fs` and manual magic byte checking to avoid
 * adding the `file-type` ESM-only dependency to a CommonJS project.
 */
import fs from 'fs';
import { Request, Response, NextFunction } from 'express';

// ═══════════════════════════════════════════
//  MAGIC BYTE SIGNATURES
// ═══════════════════════════════════════════

interface MagicSignature {
  bytes: number[];
  offset?: number;
  mime: string;
}

const MAGIC_SIGNATURES: MagicSignature[] = [
  // Audio
  { bytes: [0x49, 0x44, 0x33], mime: 'audio/mpeg' },             // ID3 (MP3)
  { bytes: [0xFF, 0xFB], mime: 'audio/mpeg' },                   // MP3 frame sync
  { bytes: [0xFF, 0xF3], mime: 'audio/mpeg' },                   // MP3 frame sync
  { bytes: [0xFF, 0xF2], mime: 'audio/mpeg' },                   // MP3 frame sync
  { bytes: [0x66, 0x4C, 0x61, 0x43], mime: 'audio/flac' },      // fLaC
  { bytes: [0x4F, 0x67, 0x67, 0x53], mime: 'audio/ogg' },       // OggS
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'audio/wav' },       // RIFF (WAV/AVI/WebP)

  // Video / Containers
  { bytes: [0x1A, 0x45, 0xDF, 0xA3], mime: 'video/webm' },      // WebM/MKV (EBML)
  { bytes: [0x00, 0x00, 0x00], mime: 'video/mp4' },              // MP4/M4A (ftyp box at offset 4)

  // Images
  { bytes: [0x89, 0x50, 0x4E, 0x47], mime: 'image/png' },       // PNG
  { bytes: [0xFF, 0xD8, 0xFF], mime: 'image/jpeg' },             // JPEG
  { bytes: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif' },       // GIF
  { bytes: [0x42, 0x4D], mime: 'image/bmp' },                    // BMP

  // Documents
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf' }, // PDF
  { bytes: [0x50, 0x4B, 0x03, 0x04], mime: 'application/zip' }, // ZIP (also DOCX, XLSX, etc.)

  // Text-based formats (JSON, plain text) — can't be validated by magic bytes
];

// MIME type family groupings — allows related types to match
const MIME_FAMILIES: Record<string, string[]> = {
  'audio': ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/webm',
            'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp4', 'audio/m4a', 'audio/x-m4a'],
  'video': ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/mpeg',
            'video/ogg', 'video/x-matroska'],
  'image': ['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp', 'image/svg+xml'],
  'document': ['application/pdf', 'application/zip', 'application/octet-stream'],
};

// ═══════════════════════════════════════════
//  DETECTION
// ═══════════════════════════════════════════

/**
 * Detect MIME type from file magic bytes.
 * Returns null if the file type cannot be determined.
 */
export function detectMimeFromMagicBytes(filePath: string): string | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    // Check for MP4/M4A (ftyp box)
    if (buffer.length >= 8) {
      const ftypMarker = buffer.toString('ascii', 4, 8);
      if (ftypMarker === 'ftyp') {
        // Could be video/mp4 or audio/mp4 — report as video/mp4
        return 'video/mp4';
      }
    }

    for (const sig of MAGIC_SIGNATURES) {
      const offset = sig.offset || 0;
      if (buffer.length < offset + sig.bytes.length) continue;

      let match = true;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (buffer[offset + i] !== sig.bytes[i]) {
          match = false;
          break;
        }
      }
      if (match) return sig.mime;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if two MIME types are compatible (same family).
 */
function areMimeTypesCompatible(declared: string, detected: string): boolean {
  if (declared === detected) return true;

  // application/octet-stream is a wildcard — always compatible
  if (declared === 'application/octet-stream') return true;

  // Get family
  const declaredFamily = declared.split('/')[0];
  const detectedFamily = detected.split('/')[0];

  // Same family (audio/* with audio/*, video/* with video/*)
  if (declaredFamily === detectedFamily) return true;

  // Special cases: RIFF can be audio or video
  if (detected === 'audio/wav' && (declared.startsWith('video/') || declared.startsWith('audio/'))) return true;

  // WebM can be audio or video
  if (detected === 'video/webm' && declared.startsWith('audio/')) return true;

  // MP4 container can be audio or video
  if (detected === 'video/mp4' && declared.startsWith('audio/')) return true;

  return false;
}

// ═══════════════════════════════════════════
//  MIDDLEWARE
// ═══════════════════════════════════════════

/**
 * Express middleware that validates uploaded file magic bytes.
 *
 * Must be used AFTER multer processes the upload.
 * Rejects with 415 Unsupported Media Type if magic bytes don't match.
 *
 * @param allowedFamilies — optional list of allowed MIME families ('audio', 'video', 'image')
 */
export function validateFileMagicBytes(allowedFamilies?: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      next();
      return;
    }

    const detectedMime = detectMimeFromMagicBytes(file.path);

    // If we can't detect (e.g., plain text, JSON), allow through
    if (!detectedMime) {
      next();
      return;
    }

    // Check if detected MIME is compatible with declared MIME
    if (!areMimeTypesCompatible(file.mimetype, detectedMime)) {
      // Remove the suspicious file
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }

      res.status(415).json({
        error: 'Unsupported Media Type',
        message: `File content (${detectedMime}) does not match declared type (${file.mimetype})`,
      });
      return;
    }

    // Check against allowed families if specified
    if (allowedFamilies) {
      const detectedFamily = detectedMime.split('/')[0];
      if (!allowedFamilies.includes(detectedFamily)) {
        try { fs.unlinkSync(file.path); } catch { /* ignore */ }

        res.status(415).json({
          error: 'Unsupported Media Type',
          message: `File type ${detectedMime} is not allowed. Expected: ${allowedFamilies.join(', ')}`,
        });
        return;
      }
    }

    next();
  };
}
