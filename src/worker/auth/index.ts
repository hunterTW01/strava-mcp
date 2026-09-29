import { authorizationErrorRedirect } from '@cloudflare/workers-oauth-provider';
import type {
  AuthRequest,
  AuthorizationErrorCode,
} from '@cloudflare/workers-oauth-provider';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import {
  consumeOneTimeState,
  OAuthStateError,
  putOneTimeState,
  randomBase64Url,
} from './state.js';
import type {
  AccessIdentity,
  AccountStatus,
  Env,
  OAuthStateRecord,
  StoredStravaAccount,
  StravaTokenSet,
} from './types.js';
import {
  authProps,
  codeChallenge,
  constantTimeEqual,
  getCookie,
  isEmailAllowed,
  isLinkedStatus,
  renderConsentPage,
  serializeCookie,
  validAthleteId,
} from './helpers.js';
export {
  authProps,
  codeChallenge,
  constantTimeEqual,
  escapeHtml,
  getCookie,
  isEmailAllowed,
  isLinkedStatus,
  renderConsentPage,
  serializeCookie,
  validAthleteId,
} from './helpers.js';

const CSRF_COOKIE_NAME = '__Host-strava-mcp-csrf';
const FLOW_TTL_SECONDS = 10 * 60;
const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const DEFAULT_STRAVA_SCOPE = 'read,activity:read_all';

interface AccessIdTokenClaims extends JWTPayload {
  sub?: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  nonce?: string;
  email_verified?: boolean;
}

export async function handleOAuthRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  void ctx;

  const url = new URL(request.url);

  try {
    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ ok: true, service: 'strava-mcp-auth' });
    }

    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(rootPage(), {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'",
          'Content-Type': 'text/html; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    if (url.pathname === '/authorize') {
      if (request.method === 'GET') return await handleAuthorizeGet(request, env);
      if (request.method === 'POST') return await handleAuthorizePost(request, env);
    }
    if (url.pathname === '/auth/access/callback' && request.method === 'GET') {
      return await handleAccessCallback(request, env);
    }
    if (url.pathname === '/auth/strava/callback' && request.method === 'GET') {
      return await handleStravaCallback(request, env);
    }
    return textResponse('Not Found', 404);
  } catch (error) {
    if (hasRedirectTo(error)) return responseRedirect(error.redirectTo);
    if (hasDescription(error)) return textResponse(error.description, 400);
    console.error('OAuth request failed', error instanceof Error ? error.message : 'unknown error');
    return textResponse('Authentication service unavailable', 500);
  }
}

async function handleAuthorizeGet(request: Request, env: Env): Promise<Response> {
  const oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const details = await env.OAUTH_PROVIDER.describeConsent(oauthRequest);
  const consent = await env.OAUTH_PROVIDER.beginConsent(oauthRequest);
  const csrf = getCookie(request, CSRF_COOKIE_NAME) ?? randomBase64Url();
  const headers = new Headers(consent.headers);

  // Allow the consent form's redirect chain to continue to
  // Cloudflare Access for SaaS after POST /authorize.
  const accessOrigin = new URL(
    requireHttpsUrl(
      env.ACCESS_AUTHORIZATION_URL,
      'ACCESS_AUTHORIZATION_URL',
    ),
  ).origin;

  headers.append(
    'Set-Cookie',
    serializeCookie(CSRF_COOKIE_NAME, csrf, FLOW_TTL_SECONDS),
  );
  headers.set('Cache-Control', 'no-store');
  headers.set(
    'Content-Security-Policy',
    `default-src 'none'; ` +
      `style-src 'unsafe-inline'; ` +
      `form-action 'self' ${accessOrigin}; ` +
      `base-uri 'none'; ` +
      `frame-ancestors 'none'`,
  );
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('X-Content-Type-Options', 'nosniff');

  return new Response(renderConsentPage(details, consent.handle, csrf), {
    headers,
  });
}

async function handleAuthorizePost(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const csrfCookie = getCookie(request, CSRF_COOKIE_NAME);
  const csrfForm = form.get('csrf');
  if (csrfCookie === undefined || typeof csrfForm !== 'string' || !constantTimeEqual(csrfCookie, csrfForm)) {
    return textResponse('Invalid authorization form', 403);
  }

  const handle = form.get('handle');
  if (typeof handle !== 'string' || handle.length === 0) return textResponse('Invalid authorization form', 400);

  if (form.get('decision') !== 'approve') {
    const denied = await env.OAUTH_PROVIDER.denyConsent(request, handle);
    const headers = new Headers(denied.headers);
    headers.append('Set-Cookie', serializeCookie(CSRF_COOKIE_NAME, '', 0));
    headers.set('Cache-Control', 'no-store');
    return new Response(null, { status: 302, headers });
  }

  const requestedScope = form.getAll('scope').filter((value): value is string => typeof value === 'string');
  const approved = await env.OAUTH_PROVIDER.approveConsent(request, handle, { scope: requestedScope });
  const pkceVerifier = randomBase64Url(48);
  const oidcNonce = randomBase64Url();
  const pendingState: OAuthStateRecord = {
    kind: 'access',
    nonce: randomBase64Url(),
    authRequest: approved.request,
    pkceVerifier,
    oidcNonce,
  };
  const state = await putOneTimeState(env.OAUTH_KV, env.COOKIE_ENCRYPTION_KEY, 'access', pendingState);
  const accessUrl = await buildAccessAuthorizationUrl(request, env, state, oidcNonce, pkceVerifier);
  const headers = new Headers(approved.headers);
  headers.append('Set-Cookie', serializeCookie(CSRF_COOKIE_NAME, '', 0));
  headers.set('Cache-Control', 'no-store');
  headers.set('Location', accessUrl);
  return new Response(null, { status: 302, headers });
}

async function handleAccessCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  let pending: OAuthStateRecord;
  try {
    pending = await consumeOneTimeState(env.OAUTH_KV, env.COOKIE_ENCRYPTION_KEY, url.searchParams.get('state') ?? '', 'access');
  } catch (error) {
    if (error instanceof OAuthStateError) return textResponse('Invalid or expired OAuth state', 400);
    throw error;
  }

  if (url.searchParams.has('error')) {
    return redirectToClient(pending.authRequest, 'access_denied', 'Access sign-in was denied');
  }
  const code = url.searchParams.get('code');
  if (code === null || code.length === 0 || pending.pkceVerifier === undefined || pending.oidcNonce === undefined) {
    return redirectToClient(pending.authRequest, 'server_error', 'Access sign-in did not return a valid authorization code');
  }

  try {
    const tokenResponse = await exchangeAccessCode(env, code, pending.pkceVerifier, callbackUrl(request, env, '/auth/access/callback'));
    const identity = await verifyAccessIdentity(env, tokenResponse.id_token, pending.oidcNonce);
    if (!isEmailAllowed(identity.email, env.ALLOWED_EMAILS)) {
      return redirectToClient(pending.authRequest, 'access_denied', 'This account is not allowed');
    }

    const status = await getAccountStatus(env, identity.sub);
    if (isLinkedStatus(status)) {
      return completePendingAuthorization(env, pending.authRequest, identity, status.athlete?.id);
    }

    const stravaState: OAuthStateRecord = {
      kind: 'strava',
      nonce: randomBase64Url(),
      authRequest: pending.authRequest,
      identity,
    };
    const stravaToken = await putOneTimeState(env.OAUTH_KV, env.COOKIE_ENCRYPTION_KEY, 'strava', stravaState);
    return responseRedirect(buildStravaAuthorizationUrl(request, env, stravaToken));
  } catch (error) {
    console.error('Access callback failed', error instanceof Error ? error.message : 'unknown error');
    return redirectToClient(pending.authRequest, 'server_error', 'Unable to complete Access sign-in');
  }
}

async function handleStravaCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  let pending: OAuthStateRecord;
  try {
    pending = await consumeOneTimeState(env.OAUTH_KV, env.COOKIE_ENCRYPTION_KEY, url.searchParams.get('state') ?? '', 'strava');
  } catch (error) {
    if (error instanceof OAuthStateError) return textResponse('Invalid or expired OAuth state', 400);
    throw error;
  }

  if (url.searchParams.has('error')) {
    return redirectToClient(pending.authRequest, 'access_denied', 'Strava account linking was denied');
  }
  const code = url.searchParams.get('code');
  if (code === null || code.length === 0 || pending.identity === undefined) {
    return redirectToClient(pending.authRequest, 'server_error', 'Strava did not return a valid authorization code');
  }

  try {
    const tokens = await exchangeStravaCode(
      env,
      code,
      callbackUrl(request, env, '/auth/strava/callback'),
      url.searchParams.get('scope'),
    );
    const account: StoredStravaAccount = { userId: pending.identity.sub, tokens };
    await persistStravaTokens(env, account);
    return completePendingAuthorization(env, pending.authRequest, pending.identity, tokens.athlete.id);
  } catch (error) {
    console.error('Strava callback failed', error instanceof Error ? error.message : 'unknown error');
    return redirectToClient(pending.authRequest, 'server_error', 'Unable to link the Strava account');
  }
}

async function exchangeAccessCode(env: Env, code: string, codeVerifier: string, redirectUri: string): Promise<{ id_token: string }> {
  const body = new URLSearchParams({
    client_id: requireNonEmpty(env.ACCESS_CLIENT_ID, 'ACCESS_CLIENT_ID'),
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  if (env.ACCESS_CLIENT_SECRET !== undefined && env.ACCESS_CLIENT_SECRET.length > 0) body.set('client_secret', env.ACCESS_CLIENT_SECRET);
  const response = await fetch(requireHttpsUrl(env.ACCESS_TOKEN_URL, 'ACCESS_TOKEN_URL'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const payload = await readJsonObject(response, 'Access token exchange');
  const idToken = stringValue(payload.id_token);
  if (!response.ok || idToken === undefined) throw new Error('Access token exchange failed');
  return { id_token: idToken };
}

async function exchangeStravaCode(
  env: Env,
  code: string,
  redirectUri: string,
  grantedScope: string | null,
): Promise<StravaTokenSet> {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: requireNonEmpty(env.STRAVA_CLIENT_ID, 'STRAVA_CLIENT_ID'),
      client_secret: requireNonEmpty(env.STRAVA_CLIENT_SECRET, 'STRAVA_CLIENT_SECRET'),
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const payload = await readJsonObject(response, 'Strava token exchange');
  const accessToken = stringValue(payload.access_token);
  const refreshToken = stringValue(payload.refresh_token);
  const expiresAt = validUnixSeconds(payload.expires_at);
  const athlete = isRecord(payload.athlete) ? payload.athlete : undefined;
  const athleteId = athlete === undefined ? undefined : validAthleteId(athlete.id);
  if (!response.ok || accessToken === undefined || refreshToken === undefined || expiresAt === undefined || athlete === undefined || athleteId === undefined) {
    throw new Error('Strava token exchange failed');
  }
  return {
    accessToken,
    refreshToken,
    expiresAt,
    scopes: parseScopes(grantedScope ?? payload.scope),
    athlete: { ...athlete, id: athleteId },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function verifyAccessIdentity(env: Env, idToken: string, expectedNonce: string): Promise<AccessIdentity> {
  const jwks = createRemoteJWKSet(new URL(requireHttpsUrl(env.ACCESS_JWKS_URL, 'ACCESS_JWKS_URL')));
  const { payload } = await jwtVerify<AccessIdTokenClaims>(idToken, jwks, {
    algorithms: ['RS256'],
    audience: requireNonEmpty(env.ACCESS_CLIENT_ID, 'ACCESS_CLIENT_ID'),
    issuer: requireNonEmpty(env.ACCESS_ISSUER, 'ACCESS_ISSUER'),
  });
  const sub = stringValue(payload.sub);
  const email = stringValue(payload.email);
  const name = stringValue(payload.name) ?? stringValue(payload.preferred_username);
  if (sub === undefined || payload.nonce !== expectedNonce) throw new Error('Invalid Access identity token');
  return { sub, ...(email === undefined ? {} : { email }), ...(name === undefined ? {} : { name }) };
}

async function getAccountStatus(env: Env, userSub: string): Promise<AccountStatus> {
  const id = env.STRAVA_ACCOUNTS.idFromName(userSub);
  const response = await env.STRAVA_ACCOUNTS.get(id).fetch('https://do/status');
  if (!response.ok) throw new Error('Strava account status lookup failed');
  const payload = await readJsonObject(response, 'Strava account status');
  const athlete = isRecord(payload.athlete) && validAthleteId(payload.athlete.id) !== undefined
    ? { ...payload.athlete, id: validAthleteId(payload.athlete.id) as number }
    : undefined;
  const storedUserId = stringValue(payload.userId);
  if (storedUserId !== undefined && storedUserId !== userSub) throw new Error('Strava account status user mismatch');
  return {
    connected: payload.connected === true,
    userId: storedUserId,
    athlete,
    scopes: Array.isArray(payload.scopes) ? payload.scopes.filter((scope): scope is string => typeof scope === 'string') : undefined,
    expiresAt: validUnixSeconds(payload.expiresAt),
  };
}

async function persistStravaTokens(env: Env, account: StoredStravaAccount): Promise<void> {
  const id = env.STRAVA_ACCOUNTS.idFromName(account.userId);
  const response = await env.STRAVA_ACCOUNTS.get(id).fetch('https://do/tokens', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  });
  if (!response.ok) throw new Error('Strava token persistence failed');
}

async function completePendingAuthorization(env: Env, authRequest: AuthRequest, identity: AccessIdentity, athleteId?: number): Promise<Response> {
  const result = await env.OAUTH_PROVIDER.completeAuthorization({
    request: authRequest,
    userId: encodeURIComponent(identity.sub),
    metadata: {},
    scope: authRequest.scope,
    props: authProps(identity, athleteId),
  });
  return responseRedirect(result.redirectTo);
}

async function buildAccessAuthorizationUrl(request: Request, env: Env, state: string, oidcNonce: string, codeVerifier: string): Promise<string> {
  const authorizationUrl = env.ACCESS_AUTHORIZATION_URL?.trim() || new URL('/authorize', requireHttpsUrl(env.ACCESS_ISSUER, 'ACCESS_ISSUER')).toString();
  const url = new URL(requireHttpsUrl(authorizationUrl, 'ACCESS_AUTHORIZATION_URL'));
  url.searchParams.set('client_id', requireNonEmpty(env.ACCESS_CLIENT_ID, 'ACCESS_CLIENT_ID'));
  url.searchParams.set('code_challenge', await codeChallenge(codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('nonce', oidcNonce);
  url.searchParams.set('redirect_uri', callbackUrl(request, env, '/auth/access/callback'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  return url.toString();
}

function buildStravaAuthorizationUrl(request: Request, env: Env, state: string): string {
  const url = new URL(STRAVA_AUTHORIZE_URL);
  url.searchParams.set('approval_prompt', 'auto');
  url.searchParams.set('client_id', requireNonEmpty(env.STRAVA_CLIENT_ID, 'STRAVA_CLIENT_ID'));
  url.searchParams.set('redirect_uri', callbackUrl(request, env, '/auth/strava/callback'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', env.STRAVA_SCOPES?.trim() || DEFAULT_STRAVA_SCOPE);
  url.searchParams.set('state', state);
  return url.toString();
}

function callbackUrl(request: Request, env: Env, path: string): string {
  return `${publicOrigin(request, env)}${path}`;
}

function publicOrigin(request: Request, env: Env): string {
  const url = new URL(env.PUBLIC_BASE_URL?.trim() || request.url);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') {
    throw new Error('OAuth callback origin must use HTTPS');
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('OAuth callback origin must not contain credentials or query data');
  return url.origin;
}

async function readJsonObject(response: Response, operation: string): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${operation} returned invalid JSON`);
  }
  if (!isRecord(payload)) throw new Error(`${operation} returned an invalid payload`);
  return payload;
}

function redirectToClient(authRequest: AuthRequest, code: AuthorizationErrorCode, description: string): Response {
  return responseRedirect(authorizationErrorRedirect(authRequest, code, description));
}

function responseRedirect(location: string): Response {
  return new Response(null, { status: 302, headers: { 'Cache-Control': 'no-store', Location: location } });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
}

function textResponse(value: string, status: number): Response {
  return new Response(value, { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
}

function requireHttpsUrl(value: string | undefined, name: string): string {
  const raw = requireNonEmpty(value, name);
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(`${name} must be an HTTPS URL`);
  return url.toString();
}

function requireNonEmpty(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) throw new Error(`Missing required OAuth configuration: ${name}`);
  return value.trim();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function validUnixSeconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((scope): scope is string => typeof scope === 'string' && scope.length > 0);
  if (typeof value !== 'string') return [];
  return value.split(/[\s,]+/).map((scope) => scope.trim()).filter((scope) => scope.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasRedirectTo(error: unknown): error is { redirectTo: string } {
  return isRecord(error) && typeof error.redirectTo === 'string';
}

function hasDescription(error: unknown): error is { description: string } {
  return isRecord(error) && typeof error.description === 'string';
}

function rootPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Strava MCP</title></head><body><main><h1>Strava MCP</h1><p>This endpoint provides OAuth authorization for the Strava MCP connection.</p><p><a href="/health">Service health</a></p></main></body></html>`;
}

export const defaultHandler = { fetch: handleOAuthRequest };
