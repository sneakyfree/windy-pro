-- Windy Admin RBAC (ADR-WA-001 §6): role claims live in account-server,
-- the human-identity SoT. Four tiers super_admin|admin|support|analyst;
-- NULL = no admin access. Launch is super_admin-only (Grant); the column
-- exists from day one so later tiers are data, not schema work.
--
-- Apply manually on prod (auto-deploy runs code only):
--   sudo docker exec -i windypro-prod-pro-postgres-1 psql -U <user> -d <db> < 006-admin-role-2026-07-06.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role TEXT;
