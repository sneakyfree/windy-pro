/**
 * @jest-environment node
 *
 * Unit tests for src/client/desktop/renderer/transcript-format.js.
 *
 * Pure functions — no jsdom needed. Covers every export path exercised
 * by app.js _exportTranscript: txt, md, srt, defaultFilenameFor.
 */

'use strict';

const { formatSrtTime, toTxt, toMd, toSrt, defaultFilenameFor } =
  require('../src/client/desktop/renderer/transcript-format');

describe('formatSrtTime', () => {
  test.each([
    [0, '00:00:00,000'],
    [1, '00:00:01,000'],
    [59, '00:00:59,000'],
    [60, '00:01:00,000'],
    [3599, '00:59:59,000'],
    [3600, '01:00:00,000'],
    [86399, '23:59:59,000'],
  ])('%i seconds → %s', (s, expected) => {
    expect(formatSrtTime(s)).toBe(expected);
  });

  test('coerces invalid input to 00:00:00,000', () => {
    expect(formatSrtTime(-1)).toBe('00:00:00,000');
    expect(formatSrtTime(NaN)).toBe('00:00:00,000');
    expect(formatSrtTime(undefined)).toBe('00:00:00,000');
    expect(formatSrtTime('abc')).toBe('00:00:00,000');
  });
});

describe('toTxt', () => {
  test('returns string verbatim', () => {
    expect(toTxt('hello world')).toBe('hello world');
    expect(toTxt('multi\nline\ntext')).toBe('multi\nline\ntext');
  });
  test('returns empty string for non-strings', () => {
    expect(toTxt(null)).toBe('');
    expect(toTxt(undefined)).toBe('');
    expect(toTxt(123)).toBe('');
  });
});

describe('toMd', () => {
  test('builds H1 header + paragraphs separated by blank lines', () => {
    const fixedDate = new Date('2026-04-15T12:00:00Z');
    const out = toMd('first paragraph\n\nsecond paragraph\nstill second', fixedDate);
    expect(out).toMatch(/^# Transcript — /);
    expect(out).toContain('first paragraph');
    expect(out).toContain('second paragraph');
    expect(out.endsWith('\n')).toBe(true);
  });
  test('handles empty input', () => {
    const out = toMd('', new Date('2026-04-15T12:00:00Z'));
    expect(out).toMatch(/^# Transcript — /);
  });
  test('handles non-string input', () => {
    const out = toMd(null, new Date('2026-04-15T12:00:00Z'));
    expect(out).toMatch(/^# Transcript — /);
  });
});

describe('toSrt', () => {
  test('returns empty string for empty input', () => {
    expect(toSrt('')).toBe('');
    expect(toSrt(null)).toBe('');
    expect(toSrt('   ')).toBe('');
  });

  test('chunks at 15 words per cue', () => {
    const words = Array.from({ length: 32 }, (_, i) => `word${i}`).join(' ');
    const srt = toSrt(words);
    // 32 words / 15 per chunk = 3 cues (15, 15, 2)
    const cues = srt.split(/\n\n/);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toMatch(/^1\n00:00:00,000 --> 00:00:06,000\n/);
    expect(cues[2]).toMatch(/^3\n/);
  });

  test('single cue for ≤15 words', () => {
    const srt = toSrt('one two three four five');
    expect(srt.startsWith('1\n')).toBe(true);
    expect(srt.split(/\n\n/)).toHaveLength(1);
  });

  test('uses 2.5 words/sec rate (60 words = ~24s)', () => {
    const words = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
    const srt = toSrt(words);
    // Last cue's end time should be 60/2.5 = 24s
    expect(srt).toContain('00:00:24,000');
  });

  test('cue numbering starts at 1 and increments', () => {
    const words = Array.from({ length: 50 }, () => 'x').join(' ');
    const srt = toSrt(words);
    const numbers = srt.split(/\n\n/).map(c => c.split('\n')[0]);
    expect(numbers).toEqual(['1', '2', '3', '4']);
  });

  test('every cue has the SRT format: number, timecode, text', () => {
    const srt = toSrt('hello world');
    const parts = srt.split('\n');
    expect(parts[0]).toBe('1');
    expect(parts[1]).toMatch(/^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$/);
    expect(parts[2]).toBe('hello world');
  });
});

describe('defaultFilenameFor', () => {
  test('builds transcript-<iso>.<ext>', () => {
    const d = new Date('2026-04-15T12:34:56Z');
    expect(defaultFilenameFor('txt', d)).toBe('transcript-2026-04-15T12-34-56.txt');
    expect(defaultFilenameFor('md', d)).toBe('transcript-2026-04-15T12-34-56.md');
    expect(defaultFilenameFor('srt', d)).toBe('transcript-2026-04-15T12-34-56.srt');
  });
  test('falls back to txt for unknown formats', () => {
    const d = new Date('2026-04-15T12:34:56Z');
    expect(defaultFilenameFor('docx', d)).toBe('transcript-2026-04-15T12-34-56.txt');
    expect(defaultFilenameFor(undefined, d)).toBe('transcript-2026-04-15T12-34-56.txt');
  });
  test('uses current time when no date passed', () => {
    const fn = defaultFilenameFor('txt');
    expect(fn).toMatch(/^transcript-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.txt$/);
  });
});
