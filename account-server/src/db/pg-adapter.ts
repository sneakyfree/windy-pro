/**
 * PostgreSQL adapter — drop-in replacement for better-sqlite3 interface.
 * Used when DATABASE_URL starts with 'postgres'.
 *
 * NOTE: This is a migration shim. For simplicity, it wraps pg queries
 * to match the better-sqlite3 synchronous API using a connection pool.
 * In production, gradually migrate to async pg queries.
 *
 * The actual implementation lives in postgres-adapter.ts. This file
 * re-exports it for convenience and backward compatibility.
 */
export { PostgresAdapter, translateSQL } from './postgres-adapter';
