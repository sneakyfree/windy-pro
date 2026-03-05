/**
 * Typed prepared statements for all database operations.
 */
import { getDb } from './schema';

export function getStatements(): Record<string, any> {
    const db = getDb();

    return {
        // Users
        findUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
        findUserById: db.prepare('SELECT id, email, name, tier, created_at, updated_at FROM users WHERE id = ?'),
        createUser: db.prepare('INSERT INTO users (id, email, name, password_hash, tier) VALUES (?, ?, ?, ?, ?)'),
        updateUserSeen: db.prepare("UPDATE users SET updated_at = datetime('now') WHERE id = ?"),

        // Devices
        getDevices: db.prepare('SELECT id, name, platform, registered_at, last_seen FROM devices WHERE user_id = ?'),
        findDevice: db.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?'),
        countDevices: db.prepare('SELECT COUNT(*) as count FROM devices WHERE user_id = ?'),
        addDevice: db.prepare("INSERT OR REPLACE INTO devices (id, user_id, name, platform, last_seen) VALUES (?, ?, ?, ?, datetime('now'))"),
        removeDevice: db.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?'),
        touchDevice: db.prepare("UPDATE devices SET last_seen = datetime('now') WHERE id = ? AND user_id = ?"),

        // Refresh tokens
        saveRefreshToken: db.prepare('INSERT INTO refresh_tokens (token, user_id, device_id, expires_at) VALUES (?, ?, ?, ?)'),
        findRefreshToken: db.prepare('SELECT * FROM refresh_tokens WHERE token = ?'),
        deleteRefreshToken: db.prepare('DELETE FROM refresh_tokens WHERE token = ?'),
        deleteUserRefreshTokens: db.prepare('DELETE FROM refresh_tokens WHERE user_id = ? AND device_id = ?'),
        cleanExpiredTokens: db.prepare("DELETE FROM refresh_tokens WHERE expires_at < datetime('now')"),

        // Translations
        insertTranslation: db.prepare(
            'INSERT INTO translations (id, user_id, source_lang, target_lang, source_text, translated_text, confidence, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ),
        getTranslationHistory: db.prepare(
            `SELECT t.*, CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
       FROM translations t LEFT JOIN favorites f ON t.id = f.translation_id AND f.user_id = t.user_id
       WHERE t.user_id = ? ORDER BY t.created_at DESC LIMIT ? OFFSET ?`
        ),
        countTranslations: db.prepare('SELECT COUNT(*) as count FROM translations WHERE user_id = ?'),
        insertFavorite: db.prepare('INSERT OR IGNORE INTO favorites (id, user_id, translation_id) VALUES (?, ?, ?)'),
        removeFavorite: db.prepare('DELETE FROM favorites WHERE user_id = ? AND translation_id = ?'),
        findTranslation: db.prepare('SELECT * FROM translations WHERE id = ? AND user_id = ?'),
    };
}
