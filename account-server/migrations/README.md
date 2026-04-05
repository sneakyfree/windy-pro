# Database Migrations

## Strategy

Windy Pro uses SQLite as the default database for local development and
single-server deployments. PostgreSQL is supported as an opt-in alternative
for production environments that need horizontal scaling, managed backups,
or multi-service shared access.

### How It Works

1. **SQLite (default):** Schema is managed automatically by
   `src/db/schema.ts` using `CREATE TABLE IF NOT EXISTS` and
   `ALTER TABLE ADD COLUMN` migrations that run at startup. No migration
   files are needed -- the app bootstraps itself.

2. **PostgreSQL (opt-in):** Set `DATABASE_URL=postgres://...` in your
   environment. The PostgreSQL schema lives in `src/db/postgres-schema.sql`
   and must be applied manually before first run. The migration file in
   this directory (`001-sqlite-to-postgres.sql`) is the same schema
   formatted as a numbered migration for tools like `psql`, `flyway`, or
   `golang-migrate`.

### Running the PostgreSQL Migration

```bash
# First time setup -- create all tables
psql "$DATABASE_URL" -f account-server/migrations/001-sqlite-to-postgres.sql

# Or use the schema file directly (identical content)
psql "$DATABASE_URL" -f account-server/src/db/postgres-schema.sql
```

### Adapter Architecture

The codebase uses a `DbAdapter` interface (`src/db/adapter.ts`) with two
implementations:

- **`SqliteAdapter`** (`src/db/sqlite-adapter.ts`) -- wraps `better-sqlite3`
- **`PostgresAdapter`** (`src/db/postgres-adapter.ts`) -- wraps `pg` via
  synchronous child-process bridge (transitional; async migration planned)

Selection happens in `src/db/schema.ts` based on `DATABASE_URL`.

### Adding New Tables or Columns

1. Add the SQLite DDL to `initSchema()` in `src/db/schema.ts`.
2. Add the PostgreSQL equivalent to `src/db/postgres-schema.sql`.
3. Create a new numbered migration file here (e.g., `002-add-foo-table.sql`)
   with the PostgreSQL DDL for existing deployments.
4. Column additions for SQLite go in the `migrations` array in `schema.ts`
   (they use try/catch to skip if the column already exists).

### Data Migration (SQLite to PostgreSQL)

If you have an existing SQLite database and want to migrate its data to
PostgreSQL:

1. Apply the PostgreSQL schema (`001-sqlite-to-postgres.sql`).
2. Export data from SQLite: `sqlite3 accounts.db .dump > dump.sql`
3. Transform the dump for PostgreSQL compatibility (datetime formats,
   boolean values, etc.).
4. Import into PostgreSQL.

A full data migration script is planned but not yet implemented.
