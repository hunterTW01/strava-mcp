import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';
import type { AccessIdentity, AccountStatus, AuthProps } from './types.js';

export function renderConsentPage(details: ConsentDescription, handle: string, csrf: string): string {
  const scopes = details.scope.length === 0
    ? '<p>No additional permissions were requested.</p>'
    : details.scope.map((scope) => `<label><input type="checkbox" name="scope" value="${escapeHtml(scope)}" checked> ${escapeHtml(scope)}</label>`).join('<br>');
  const verification = details.clientDomain === undefined ? 'This client name is self-asserted.' : `Published by ${escapeHtml(details.clientDomain)}.`;
  const clientUri = details.clientUri === undefined ? '' : `<p>Client website: ${escapeHtml(details.clientUri)}</p>`;
  const loopbackWarning = details.redirectIsLoopback ? '<p><strong>This sends the authorization to an app on this computer.</strong></p>' : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Authorize ${escapeHtml(details.clientName)}</title></head>
<body><main><h1>Allow ${escapeHtml(details.clientName)} to access Strava MCP?</h1>
<p>${verification}</p>${clientUri}<p>After approval, authorization returns to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>${loopbackWarning}
<form method="post" action="/authorize"><input type="hidden" name="handle" value="${escapeHtml(handle)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><fieldset><legend>Requested permissions</legend>${scopes}</fieldset>
<p><button type="submit" name="decision" value="approve">Allow</button> <button type="submit" name="decision" value="deny">Deny</button></p></form></main></body></html>`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return character;
    }
  });
}

export function isEmailAllowed(email: string | undefined, configured: string | undefined): boolean {
  const values = configured?.split(',').map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0) ?? [];
  return values.length === 0 || (email !== undefined && values.includes(email.toLowerCase()));
}

export function authProps(identity: AccessIdentity, athleteId?: number): AuthProps {
  return { userId: identity.sub, ...(identity.email === undefined ? {} : { email: identity.email }), ...(identity.name === undefined ? {} : { name: identity.name }), ...(athleteId === undefined ? {} : { athleteId }) };
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return difference === 0;
}

export function getCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader === null) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator >= 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

export function serializeCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

export function isLinkedStatus(status: AccountStatus): boolean {
  return status.connected === true && status.athlete !== undefined && status.athlete.id > 0;
}

export function validAthleteId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export async function codeChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
