/**
 * @windy-pro/contracts — Unified Windy Identity types
 *
 * Type definitions for the cross-product identity system.
 * Used by account-server, chat-onboarding, mobile app, and web client.
 */

// ═══════════════════════════════════════════
//  IDENTITY CORE
// ═══════════════════════════════════════════

/** Branded string type for Windy Identity IDs (UUIDv4) */
export type WindyIdentityId = string & { readonly __brand: 'WindyIdentityId' };

/** Identity type discriminator — human user or bot agent */
export type IdentityType = 'human' | 'bot';

/** All products in the Windy ecosystem */
export enum EcosystemProduct {
  WindyWord = 'windy_word',
  WindyTraveler = 'windy_traveler',
  WindyChat = 'windy_chat',
  WindyMail = 'windy_mail',
  WindyFly = 'windy_fly',
  WindyClone = 'windy_clone',
  WindyCloud = 'windy_cloud',
  HiFly = 'hifly',
  Eternitas = 'eternitas',
}

/** Products that support provisioned identity accounts */
export type WindyProduct = 'windy_pro' | 'windy_chat' | 'windy_mail' | 'windy_fly' | 'windy_word' | 'windy_traveler' | 'windy_clone' | 'windy_cloud' | 'eternitas';

/** Account status within a product */
export type ProductAccountStatus = 'active' | 'suspended' | 'pending' | 'deprovisioned';

/** Eternitas passport status */
export type PassportStatus = 'active' | 'suspended' | 'revoked';

/** The extended user record with identity fields */
export interface WindyIdentity {
  id: WindyIdentityId;
  email: string;
  name: string;
  tier: string;
  identityType: IdentityType;
  phone?: string;
  displayName?: string;
  avatarUrl?: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  passportId?: string;           // ET-XXXXX for bots
  preferredLang: string;         // ISO 639-1
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ═══════════════════════════════════════════
//  PRODUCT ACCOUNTS
// ═══════════════════════════════════════════

/** Maps an identity to a specific product (e.g., Windy Chat, Windy Mail) */
export interface ProductAccount {
  id: string;
  identityId: WindyIdentityId;
  product: WindyProduct;
  externalId?: string;           // Matrix user ID, email address, etc.
  status: ProductAccountStatus;
  provisionedAt: string;
  metadata: Record<string, unknown>;
}

/** Request to provision a new product account for an identity */
export interface ProvisionProductRequest {
  identityId: WindyIdentityId;
  product: WindyProduct;
  externalId?: string;
  metadata?: Record<string, unknown>;
}

/** Response after provisioning */
export interface ProvisionProductResponse {
  account: ProductAccount;
  provisioned: boolean;
}

// ═══════════════════════════════════════════
//  SCOPED TOKENS
// ═══════════════════════════════════════════

/**
 * JWT scope format: `product:permission`
 *
 * Examples:
 *   - `windy_pro:*` — full access to Windy Pro
 *   - `windy_chat:read` — read-only Windy Chat
 *   - `windy_chat:write` — write access to Windy Chat
 *   - `windy_mail:send` — send mail permission
 *   - `admin:*` — superuser
 *
 * Wildcard `*` matches any permission within a product.
 */
export type IdentityScope = string;

/** Scope record from the database */
export interface IdentityScopeRecord {
  id: string;
  identityId: WindyIdentityId;
  scope: IdentityScope;
  grantedAt: string;
  grantedBy?: string;
}

/** Extended JWT payload with identity scopes */
export interface WindyIdentityToken {
  /** User/identity ID (subject) */
  sub: string;
  /** Email address */
  email: string;
  /** Display name */
  name: string;
  /** License tier */
  tier: string;
  /** Identity type */
  type: IdentityType;
  /** Granted scopes (product:permission) */
  scopes: IdentityScope[];
  /** Products with active accounts */
  products: WindyProduct[];
  /** Issuer */
  iss: 'windy-identity';
  /** Issued at (epoch seconds) */
  iat: number;
  /** Expiration (epoch seconds) */
  exp: number;
}

// ═══════════════════════════════════════════
//  AUDIT LOG
// ═══════════════════════════════════════════

/** Identity audit event types */
export type IdentityAuditEvent =
  | 'login'
  | 'login_failed'
  | 'register'
  | 'logout'
  | 'password_change'
  | 'scope_grant'
  | 'scope_revoke'
  | 'device_add'
  | 'device_remove'
  | 'token_refresh'
  | 'account_freeze'
  | 'account_unfreeze'
  | 'passport_register'
  | 'passport_revoke'
  | 'passport_suspend'
  | 'product_provision'
  | 'product_deprovision'
  | 'email_verify'
  | 'phone_verify'
  | 'verification_send'
  | 'verification_check'
  | 'api_key_create'
  | 'api_key_revoke'
  | 'secretary_consent_granted'
  | 'secretary_consent_revoked'
  | 'secretary_email_sent'
  | 'identity_created'
  | 'trust_updated'
  | 'passport_reinstate'
  | 'revocation_cascade'
  | 'chat_login'
  | 'chat_login_failed'
  | 'account_self_deleted'
  // Wave 1 — PR1 (email verification) + PR2 (password reset) + PR3 (MFA)
  | 'login_blocked'
  | 'verification_email_sent'
  | 'email_verified'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'mfa_setup_started'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'mfa_login_challenge'
  | 'mfa_login_success'
  | 'mfa_login_failed'
  // Wave 1 — PR4 (webhook fan-out)
  | 'webhook_delivered'
  | 'webhook_failed'
  | 'webhook_dead_lettered'
  // Wave 8 — Grandma Ribbon (managed-credential broker + Pro-hosted hatch)
  | 'broker_token_issue'
  | 'broker_token_revoke'
  | 'agent_hatch_complete';

/** Audit log entry */
export interface IdentityAuditEntry {
  id: string;
  identityId?: WindyIdentityId;  // Nullable for failed login attempts
  event: IdentityAuditEvent;
  details: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

// ═══════════════════════════════════════════
//  ETERNITAS BOT IDENTITY
// ═══════════════════════════════════════════

/** Eternitas passport — bot identity verification record */
export interface EternitasPassport {
  id: string;
  identityId: WindyIdentityId;
  passportNumber: string;        // ET-XXXXX format
  operatorIdentityId?: WindyIdentityId;   // Human who owns/operates the bot
  status: PassportStatus;
  trustScore: number;            // 0.0 to 1.0
  birthCertificate: Record<string, unknown>;
  registeredAt: string;
  lastVerifiedAt: string;
}

/** Base fields shared by all webhook payloads */
export interface WebhookPayloadBase {
  passportNumber: string;
  timestamp: string;
  signature: string;             // HMAC-SHA256 for webhook verification
}

/** Webhook payload: passport.registered — new bot passport created */
export interface WebhookPassportRegistered extends WebhookPayloadBase {
  event: 'passport.registered';
  agentName: string;
  operatorEmail: string;
  payload: {
    trustScore: number;
    birthCertificate: Record<string, unknown>;
  };
}

/** Webhook payload: passport.revoked — bot passport permanently revoked */
export interface WebhookPassportRevoked extends WebhookPayloadBase {
  event: 'passport.revoked';
  agentName: string;
  operatorEmail?: string;
  payload: {
    reason: string;
    revokedBy: string;
  };
}

/** Webhook payload: identity.created — new Windy identity provisioned */
export interface WebhookIdentityCreated extends WebhookPayloadBase {
  event: 'identity.created';
  agentName: string;
  operatorEmail?: string;
  payload: {
    identityId: WindyIdentityId;
    identityType: IdentityType;
    products: WindyProduct[];
  };
}

/** Webhook payload: passport.suspended */
export interface WebhookPassportSuspended extends WebhookPayloadBase {
  event: 'passport.suspended';
  agentName: string;
  operatorEmail?: string;
  payload: {
    reason: string;
  };
}

/** Webhook payload: passport.verified */
export interface WebhookPassportVerified extends WebhookPayloadBase {
  event: 'passport.verified';
  agentName: string;
  operatorEmail?: string;
  payload: {
    trustScore: number;
  };
}

/** Union of all typed webhook payloads */
export type EternitasWebhookPayload =
  | WebhookPassportRegistered
  | WebhookPassportRevoked
  | WebhookIdentityCreated
  | WebhookPassportSuspended
  | WebhookPassportVerified;

/** Response to Eternitas webhook */
export interface EternitasWebhookResponse {
  received: boolean;
  identityId?: string;
  productsProvisioned?: WindyProduct[];
}

// ═══════════════════════════════════════════
//  CHAT PROFILE
// ═══════════════════════════════════════════

/** Chat profile — links Matrix account to Windy identity */
export interface ChatProfile {
  identityId: WindyIdentityId;
  chatUserId?: string;
  matrixUserId?: string;         // @windy_abc123:chat.windypro.com
  displayName?: string;
  languages: string[];           // ISO 639-1 codes
  primaryLanguage: string;
  onboardingComplete: boolean;
  createdAt: string;
}

// ═══════════════════════════════════════════
//  API — IDENTITY ENDPOINTS
// ═══════════════════════════════════════════

/** GET /api/v1/identity/me — extended identity info */
export interface IdentityMeResponse {
  identity: WindyIdentity;
  products: ProductAccount[];
  scopes: IdentityScope[];
  chatProfile?: ChatProfile;
  passport?: EternitasPassport;
}

/** POST /api/v1/identity/products/provision */
export interface IdentityProvisionRequest {
  product: WindyProduct;
  metadata?: Record<string, unknown>;
}

/** POST /api/v1/identity/scopes/grant */
export interface IdentityScopeGrantRequest {
  identityId: WindyIdentityId;
  scopes: IdentityScope[];
}

/** POST /api/v1/identity/eternitas/webhook */
export type IdentityEternitasWebhookRequest = EternitasWebhookPayload;

/** GET /api/v1/identity/audit?limit=50&offset=0&event=login */
export interface IdentityAuditQuery {
  limit?: number;
  offset?: number;
  event?: IdentityAuditEvent;
  from?: string;
  to?: string;
}

export interface IdentityAuditResponse {
  entries: IdentityAuditEntry[];
  total: number;
}

// ═══════════════════════════════════════════
//  VERIFICATION (Phase 1 — promoted from chat-onboarding)
// ═══════════════════════════════════════════

/** OTP verification send request */
export interface VerificationSendRequest {
  type: 'phone' | 'email';
  identifier: string;
  countryCode?: string;
}

/** OTP verification check request */
export interface VerificationCheckRequest {
  type?: 'phone' | 'email';
  identifier: string;
  code: string;
  countryCode?: string;
}

/** Verification send response */
export interface VerificationSendResponse {
  success: boolean;
  type: 'phone' | 'email';
  identifier: string;
  message: string;
  expiresInSeconds: number;
}

/** Verification check response */
export interface VerificationCheckResponse {
  success: boolean;
  verified: boolean;
  verificationToken: string;
  identifier: string;
  type: 'phone' | 'email';
  message: string;
}

// ═══════════════════════════════════════════
//  BOT API KEYS (Phase 3)
// ═══════════════════════════════════════════

/** Bot API key record — long-lived key for bot agents */
export interface BotApiKey {
  id: string;
  identityId: WindyIdentityId;
  keyHash: string;            // SHA-256 hash (never store raw key)
  keyPrefix: string;          // First 8 chars for identification: "wk_xxxx"
  label?: string;
  scopes: string[];
  status: 'active' | 'revoked';
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  createdBy: WindyIdentityId;  // Identity that created this key
}

/** Create bot API key request */
export interface BotApiKeyCreateRequest {
  identityId: WindyIdentityId;
  scopes: string[];
  label?: string;
  expiresInDays?: number;
}

/** Create bot API key response — raw key only returned once */
export interface BotApiKeyCreateResponse {
  apiKey: string;             // Full key (only shown once): "wk_xxxxxxxxxxxxxxxx"
  keyPrefix: string;
  id: string;
  scopes: string[];
  expiresAt?: string;
}

// ═══════════════════════════════════════════
//  SECRETARY MODE (Phase 3)
// ═══════════════════════════════════════════

/** Secretary consent record */
export interface SecretaryConsent {
  id: string;
  ownerIdentityId: WindyIdentityId;    // Human who grants consent
  botIdentityId: WindyIdentityId;      // Bot that receives consent
  grantedAt: string;
  revokedAt?: string;
  active: boolean;
}

/** Secretary consent request */
export interface SecretaryConsentRequest {
  botIdentityId: WindyIdentityId;
  consent: boolean;
}

// ═══════════════════════════════════════════
//  HATCH FLOW (Phase 3 — credential output)
// ═══════════════════════════════════════════

/** Structured credential output for newly hatched agents */
export interface WindyIdentityCredentials {
  version: 1;
  identityId: WindyIdentityId;
  passportNumber: string;     // ET-XXXXX
  identityType: 'bot';
  apiKey: string;             // wk_xxxxxxxxxxxxxxxx
  scopes: string[];
  products: {
    windyChat?: {
      matrixUserId: string;
      accessToken: string;
      deviceId: string;
      homeServer: string;
    };
    windyMail?: {
      emailAddress: string;
    };
  };
  operatorIdentityId: WindyIdentityId;
  createdAt: string;
  expiresAt?: string;
}

// ═══════════════════════════════════════════
//  OAUTH2 / SSO — "Sign in with Windy" (Phase 5)
// ═══════════════════════════════════════════

/** Registered OAuth2 client */
export interface OAuthClient {
  clientId: string;
  name: string;
  redirectUris: string[];
  allowedScopes: string[];
  isFirstParty: boolean;
  isPublic: boolean;
  createdAt: string;
}

/** GET /api/v1/oauth/authorize query parameters */
export interface OAuthAuthorizeRequest {
  client_id: string;
  redirect_uri: string;
  response_type: 'code';
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: 'S256';
}

/** POST /api/v1/oauth/token request body */
export interface OAuthTokenRequest {
  grant_type: 'authorization_code' | 'client_credentials' | 'refresh_token' | 'urn:ietf:params:oauth:grant-type:device_code';
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  code_verifier?: string;
  refresh_token?: string;
  device_code?: string;
  scope?: string;
}

/** POST /api/v1/oauth/token response */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/** POST /api/v1/oauth/device request */
export interface DeviceCodeRequest {
  client_id: string;
  scope?: string;
}

/** POST /api/v1/oauth/device response */
export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/** GET /.well-known/openid-configuration */
export interface OIDCDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  device_authorization_endpoint: string;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  code_challenge_methods_supported: string[];
}

/** GET /api/v1/oauth/userinfo response (OIDC standard claims) */
export interface UserInfoResponse {
  sub: string;
  name?: string;
  preferred_username?: string;
  picture?: string;
  locale?: string;
  email?: string;
  email_verified?: boolean;
  phone_number?: string;
  phone_number_verified?: boolean;
  identity_type?: 'human' | 'bot';
}

/** JWKS Document */
export interface JWKSDocument {
  keys: JWKKey[];
}

/** JSON Web Key */
export interface JWKKey {
  kty: 'RSA';
  use: 'sig';
  alg: 'RS256';
  kid: string;
  n: string;
  e: string;
}
