import { base64url, jwtVerify, SignJWT } from 'jose';
import type { JWTPayload } from 'jose';
import type { OAuthStateKind, OAuthStateRecord } from './types.js';

export const STATE_TTL_SECONDS = 10 * 60;
const STATE_ISSUER = 'strava-mcp-browser-flow';
const STATE_AUDIENCE = 'strava-mcp-browser-flow';

export interface OAuthStateClaims extends JWTPayload {
  kind: OAuthStateKind;
  nonce: string;
}

export class OAuthStateError extends Error {
  constructor(message = 'Invalid or expired OAuth state') {
    super(message);
    this.name = 'OAuthStateError';
  }
}

function stateKey(secret: string): Uint8Array {
  const key = new TextEncoder().encode(secret);
  if (key.byteLength < 32) {
    throw new Error('COOKIE_ENCRYPTION_KEY must contain at least 32 UTF-8 bytes');
  }
  return key;
}

export function stateStorageKey(nonce: string): string {
  return `oauth:browser-state:${nonce}`;
}

export async function signOAuthState(
  secret: string,
  kind: OAuthStateKind,
  nonce: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  if (!nonce || !/^[A-Za-z0-9_-]{32,}$/.test(nonce)) {
    throw new Error('OAuth state nonce must be a cryptographically random base64url value');
  }

  return new SignJWT({ kind, nonce })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(STATE_ISSUER)
    .setAudience(STATE_AUDIENCE)
    .setJti(nonce)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + STATE_TTL_SECONDS)
    .sign(stateKey(secret));
}

export async function verifyOAuthState(
  secret: string,
  token: string,
  expectedKind?: OAuthStateKind,
): Promise<OAuthStateClaims> {
  try {
    const { payload } = await jwtVerify<OAuthStateClaims>(token, stateKey(secret), {
      algorithms: ['HS256'],
      issuer: STATE_ISSUER,
      audience: STATE_AUDIENCE,
    });

    if (
      (payload.kind !== 'access' && payload.kind !== 'strava') ||
      typeof payload.nonce !== 'string' ||
      !/^[A-Za-z0-9_-]{32,}$/.test(payload.nonce) ||
      (expectedKind !== undefined && payload.kind !== expectedKind)
    ) {
      throw new OAuthStateError();
    }

    return payload;
  } catch (error) {
    if (error instanceof OAuthStateError) {
      throw error;
    }
    throw new OAuthStateError();
  }
}

export function randomBase64Url(byteLength = 32): string {
  if (!Number.isInteger(byteLength) || byteLength < 16) {
    throw new Error('Random values must contain at least 16 bytes');
  }
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url.encode(bytes);
}

export async function putOneTimeState(
  kv: KVNamespace,
  secret: string,
  kind: OAuthStateKind,
  record: OAuthStateRecord,
): Promise<string> {
  const token = await signOAuthState(secret, kind, record.nonce);
  await kv.put(stateStorageKey(record.nonce), JSON.stringify(record), {
    expirationTtl: STATE_TTL_SECONDS,
  });
  return token;
}

export async function consumeOneTimeState(
  kv: KVNamespace,
  secret: string,
  token: string,
  expectedKind: OAuthStateKind,
): Promise<OAuthStateRecord> {
  const claims = await verifyOAuthState(secret, token, expectedKind);
  const key = stateStorageKey(claims.nonce);
  const raw = await kv.get(key);

  if (raw === null) {
    throw new OAuthStateError();
  }

  // KV has no compare-and-delete primitive. Delete before any downstream work so a
  // replay cannot repeat an upstream exchange even when the first request fails later.
  await kv.delete(key);

  try {
    const record = JSON.parse(raw) as Partial<OAuthStateRecord>;
    if (
      record.kind !== expectedKind ||
      record.nonce !== claims.nonce ||
      typeof record.authRequest !== 'object' ||
      record.authRequest === null
    ) {
      throw new OAuthStateError();
    }
    return record as OAuthStateRecord;
  } catch (error) {
    if (error instanceof OAuthStateError) {
      throw error;
    }
    throw new OAuthStateError();
  }
}
