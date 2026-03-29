/**
 * Tests for file magic byte validation.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { detectMimeFromMagicBytes } from '../middleware/file-validation';

describe('File Magic Byte Validation', () => {
  const tmpDir = path.join(os.tmpdir(), `file-val-test-${Date.now()}`);

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTestFile(name: string, bytes: number[]): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, Buffer.from(bytes));
    return filePath;
  }

  it('should detect PNG files', () => {
    const filePath = writeTestFile('test.png', [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectMimeFromMagicBytes(filePath)).toBe('image/png');
  });

  it('should detect JPEG files', () => {
    const filePath = writeTestFile('test.jpg', [0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectMimeFromMagicBytes(filePath)).toBe('image/jpeg');
  });

  it('should detect MP3 files with ID3 header', () => {
    const filePath = writeTestFile('test.mp3', [0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectMimeFromMagicBytes(filePath)).toBe('audio/mpeg');
  });

  it('should detect PDF files', () => {
    const filePath = writeTestFile('test.pdf', [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectMimeFromMagicBytes(filePath)).toBe('application/pdf');
  });

  it('should detect WebM/MKV files', () => {
    const filePath = writeTestFile('test.webm', [0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectMimeFromMagicBytes(filePath)).toBe('video/webm');
  });

  it('should detect MP4 files with ftyp box', () => {
    // MP4: bytes 4-7 = 'ftyp'
    const bytes = [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D, 0, 0, 0, 0];
    const filePath = writeTestFile('test.mp4', bytes);
    expect(detectMimeFromMagicBytes(filePath)).toBe('video/mp4');
  });

  it('should return null for unrecognized files', () => {
    const filePath = writeTestFile('test.txt', [0x48, 0x65, 0x6C, 0x6C, 0x6F, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // "Hello"
    expect(detectMimeFromMagicBytes(filePath)).toBeNull();
  });

  it('should return null for nonexistent files', () => {
    expect(detectMimeFromMagicBytes('/nonexistent/file.bin')).toBeNull();
  });

  it('should detect GIF files', () => {
    const filePath = writeTestFile('test.gif', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectMimeFromMagicBytes(filePath)).toBe('image/gif');
  });
});
