/**
 * Build a safe summary of an arbitrary thrown value for the crash
 * log. Allow-list approach (CR-006) — only known fields make it
 * out, any library-specific attached objects (axios `response`,
 * node-fetch headers, etc.) get dropped entirely instead of
 * stringified with potentially sensitive content.
 *
 * Also applies line-level pattern-based redaction as a belt-and-
 * suspenders pass for the allow-listed fields.
 *
 * Used by main.js writeCrashLog + unit-tested here.
 */

'use strict';

const SECRET_PATTERNS = [
  { re: /Bearer\s+\S+/gi,              label: 'Bearer [REDACTED]' },
  { re: /sk-[a-zA-Z0-9]+/g,            label: 'sk-[REDACTED]' },
  { re: /ghp_[a-zA-Z0-9]{10,}/g,       label: 'ghp_[REDACTED]' },
  { re: /xoxb-[a-zA-Z0-9-]{10,}/g,     label: 'xoxb-[REDACTED]' },
  { re: /AKIA[A-Z0-9]{16}/g,           label: 'AKIA[REDACTED]' },
  { re: /glpat-[a-zA-Z0-9_-]+/g,       label: 'glpat-[REDACTED]' },
  { re: /key[_-]?[a-zA-Z0-9]{10,}/gi,  label: 'key_[REDACTED]' },
];

function redactLine(line) {
  let out = String(line);
  for (const { re, label } of SECRET_PATTERNS) out = out.replace(re, label);
  return out;
}

/**
 * @param {unknown} err — anything thrown (Error, string, plain object, number)
 * @param {{ stackFrames?: number }} [opts]
 * @returns {{name:string|null, message:string|null, code:string|null, stack:string|null}}
 */
function safeErrorSummary(err, opts) {
  const stackFrames = (opts && typeof opts.stackFrames === 'number')
    ? opts.stackFrames : 8;
  const out = { name: null, message: null, code: null, stack: null };

  if (err && typeof err === 'object') {
    if (typeof err.name === 'string') out.name = err.name.slice(0, 80);
    if (typeof err.message === 'string') out.message = err.message.slice(0, 500);
    if (typeof err.code === 'string') out.code = err.code.slice(0, 80);
    if (typeof err.stack === 'string') {
      out.stack = err.stack.split('\n').slice(0, stackFrames).join('\n');
    }
  } else {
    out.message = String(err).slice(0, 500);
  }

  out.name = out.name ? redactLine(out.name) : null;
  out.message = out.message ? redactLine(out.message) : null;
  out.code = out.code ? redactLine(out.code) : null;
  out.stack = out.stack ? redactLine(out.stack) : null;
  return out;
}

module.exports = { safeErrorSummary, redactLine, SECRET_PATTERNS };
