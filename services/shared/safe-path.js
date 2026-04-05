/**
 * L9: Path Traversal Protection Utility
 *
 * Shared helper to validate that resolved paths don't escape allowed directories.
 * Use this across all handlers that accept user-supplied file paths.
 */
'use strict';

const path = require('path');

/**
 * Validate that a file path resolves within the allowed base directory.
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 *
 * @param {string} userPath - The user-supplied path or filename
 * @param {string} baseDir - The allowed base directory (must be absolute)
 * @returns {{ safe: boolean, resolved: string, error?: string }}
 */
function validatePath(userPath, baseDir) {
    if (!userPath || typeof userPath !== 'string') {
        return { safe: false, resolved: '', error: 'Path is required' };
    }
    if (!baseDir || !path.isAbsolute(baseDir)) {
        return { safe: false, resolved: '', error: 'Base directory must be an absolute path' };
    }

    // Resolve the full path
    const resolved = path.resolve(baseDir, userPath);
    // Normalize the base directory to ensure consistent trailing separator comparison
    const normalizedBase = path.resolve(baseDir) + path.sep;

    // Check that the resolved path starts with the base directory
    if (!resolved.startsWith(normalizedBase) && resolved !== path.resolve(baseDir)) {
        return {
            safe: false,
            resolved,
            error: 'Path escapes the allowed directory'
        };
    }

    // Reject null bytes (common attack vector)
    if (userPath.includes('\0')) {
        return { safe: false, resolved, error: 'Path contains null bytes' };
    }

    return { safe: true, resolved };
}

/**
 * Express middleware factory that validates a path parameter or body field.
 *
 * @param {string} baseDir - The allowed base directory
 * @param {string} [field='path'] - The request body/query field containing the path
 * @returns {Function} Express middleware
 */
function pathGuard(baseDir, field = 'path') {
    return (req, _res, next) => {
        const userPath = req.body?.[field] || req.query?.[field] || req.params?.[field];
        if (userPath) {
            const result = validatePath(userPath, baseDir);
            if (!result.safe) {
                return _res.status(400).json({ error: result.error || 'Invalid path' });
            }
            // Attach the safe resolved path for downstream handlers
            req._safePath = result.resolved;
        }
        next();
    };
}

module.exports = { validatePath, pathGuard };
