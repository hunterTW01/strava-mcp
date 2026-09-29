import type {
  AuthRequest,
  OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';

/** The only application data exposed to authenticated MCP handlers. */
export interface AuthProps {
  userId: string;
  email?: string;
  name?: string;
  athleteId?: number;
}

export interface AccessIdentity {
  sub: string;
  email?: string;
  name?: string;
}

export type OAuthStateKind = 'access' | 'strava';

export interface OAuthStateRecord {
  kind: OAuthStateKind;
  nonce: string;
  authRequest: AuthRequest;
  pkceVerifier?: string;
  oidcNonce?: string;
  identity?: AccessIdentity;
}

export interface AccountStatus {
  connected?: boolean;
  userId?: string;
  athlete?: StravaAthlete;
  scopes?: string[];
  expiresAt?: number;
}

export interface StravaAthlete {
  id: number;
  [key: string]: unknown;
}

export interface StravaTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  athlete: StravaAthlete;
  createdAt: number;
  updatedAt: number;
}

export interface StoredStravaAccount {
  userId: string;
  tokens: StravaTokenSet;
}

/** Bindings required by the one-Worker OAuthProvider default handler. */
export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  STRAVA_ACCOUNTS: DurableObjectNamespace;
  COOKIE_ENCRYPTION_KEY: string;
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  ACCESS_TOKEN_URL: string;
  ACCESS_JWKS_URL: string;
  ACCESS_ISSUER: string;
  ACCESS_CLIENT_ID: string;
  ACCESS_AUTHORIZATION_URL?: string;
  ACCESS_CLIENT_SECRET?: string;
  ALLOWED_EMAILS?: string;
  PUBLIC_BASE_URL?: string;
  STRAVA_SCOPES?: string;
}
