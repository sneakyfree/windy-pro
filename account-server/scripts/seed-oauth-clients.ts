/**
 * Seed OAuth Clients — Pre-register first-party Windy ecosystem products.
 *
 * Phase 6B: Idempotently registers the ecosystem products as OAuth2 clients.
 * All first-party clients get auto-approve consent (is_first_party: 1).
 * Public clients (desktop, mobile, CLI) use PKCE and have no client secret.
 *
 * Usage:
 *   npx ts-node scripts/seed-oauth-clients.ts
 *
 * This script is idempotent — safe to run multiple times.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb, closeDb } from '../src/db/schema';

interface ClientSeed {
  clientId: string;
  name: string;
  redirectUris: string[];
  allowedScopes: string[];
  isFirstParty: boolean;
  isPublic: boolean;
}

const FIRST_PARTY_CLIENTS: ClientSeed[] = [
  {
    clientId: 'windy_chat',
    name: 'Windy Chat',
    redirectUris: ['https://windychat.com/auth/callback', 'https://chat.windypro.com/auth/callback'],
    allowedScopes: ['windy_chat:*'],
    isFirstParty: true,
    isPublic: false,
  },
  {
    clientId: 'windy_mail',
    name: 'Windy Mail',
    redirectUris: ['https://windymail.ai/auth/callback'],
    allowedScopes: ['windy_mail:*'],
    isFirstParty: true,
    isPublic: false,
  },
  {
    clientId: 'windy_fly',
    name: 'Windy Fly',
    redirectUris: ['http://localhost:3000/auth/callback'],
    allowedScopes: ['windy_fly:*', 'windy_chat:*', 'windy_mail:*'],
    isFirstParty: true,
    isPublic: true, // CLI tool — uses PKCE, no client secret
  },
  {
    clientId: 'eternitas',
    name: 'Eternitas',
    redirectUris: ['https://eternitas.ai/auth/callback'],
    allowedScopes: ['eternitas:verify', 'eternitas:register'],
    isFirstParty: true,
    isPublic: false,
  },
  {
    clientId: 'windy_pro_desktop',
    name: 'Windy Pro Desktop',
    redirectUris: ['windy-pro://auth/callback'],
    allowedScopes: ['windy_pro:*'],
    isFirstParty: true,
    isPublic: true, // Desktop app — uses PKCE, no client secret
  },
  {
    clientId: 'windy_pro_mobile',
    name: 'Windy Pro Mobile',
    redirectUris: ['windypro://auth/callback'],
    allowedScopes: ['windy_pro:*'],
    isFirstParty: true,
    isPublic: true, // Mobile app — uses PKCE, no client secret
  },
];

function seedOAuthClients(): void {
  const db = getDb();

  console.log('');
  console.log('=== Seeding First-Party OAuth Clients ===');
  console.log('');

  let created = 0;
  let existing = 0;

  for (const client of FIRST_PARTY_CLIENTS) {
    // Check if already exists
    const row = db.prepare('SELECT client_id FROM oauth_clients WHERE client_id = ?').get(client.clientId) as any;

    if (row) {
      // Update in place (idempotent — update name, redirect URIs, scopes, flags)
      db.prepare(`
        UPDATE oauth_clients SET
          name = ?,
          redirect_uris = ?,
          allowed_scopes = ?,
          is_first_party = ?,
          is_public = ?
        WHERE client_id = ?
      `).run(
        client.name,
        JSON.stringify(client.redirectUris),
        JSON.stringify(client.allowedScopes),
        client.isFirstParty ? 1 : 0,
        client.isPublic ? 1 : 0,
        client.clientId,
      );
      console.log(`  [EXISTS] ${client.clientId} (${client.name}) — updated`);
      existing++;
      continue;
    }

    // Generate client secret for confidential clients
    let clientSecretHash: string | null = null;
    let clientSecret: string | null = null;

    if (!client.isPublic) {
      clientSecret = `wcs_${crypto.randomBytes(32).toString('hex')}`;
      clientSecretHash = bcrypt.hashSync(clientSecret, 12);
    }

    db.prepare(`
      INSERT INTO oauth_clients (client_id, client_secret_hash, name, redirect_uris, allowed_scopes, is_first_party, is_public)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      client.clientId,
      clientSecretHash,
      client.name,
      JSON.stringify(client.redirectUris),
      JSON.stringify(client.allowedScopes),
      client.isFirstParty ? 1 : 0,
      client.isPublic ? 1 : 0,
    );

    console.log(`  [CREATED] ${client.clientId} (${client.name})`);
    if (clientSecret) {
      console.log(`            Secret: ${clientSecret}`);
      console.log(`            (Store this securely — it will not be shown again.)`);
    } else {
      console.log(`            Public client (PKCE required, no secret)`);
    }
    created++;
  }

  console.log('');
  console.log(`Done: ${created} created, ${existing} updated.`);
  console.log('');
}

// Run if executed directly
seedOAuthClients();
closeDb();
