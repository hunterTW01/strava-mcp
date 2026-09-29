import { describe, expect, it } from 'vitest';
import {
  authProps,
  constantTimeEqual,
  escapeHtml,
  isEmailAllowed,
  renderConsentPage,
} from '../src/worker/auth/helpers.js';
import {
  randomBase64Url,
  signOAuthState,
  verifyOAuthState,
} from '../src/worker/auth/state.js';

const SECRET = '0123456789abcdef0123456789abcdef';

describe('worker OAuth helpers', () => {
  it('round-trips a signed state and binds it to its flow kind', async () => {
    const nonce = randomBase64Url();
    const token = await signOAuthState(SECRET, 'access', nonce);

    await expect(verifyOAuthState(SECRET, token, 'access')).resolves.toMatchObject({
      kind: 'access',
      nonce,
    });
    await expect(verifyOAuthState(SECRET, token, 'strava')).rejects.toThrow('Invalid or expired OAuth state');
    await expect(verifyOAuthState(SECRET, `${token.slice(0, -1)}x`, 'access')).rejects.toThrow('Invalid or expired OAuth state');
  });

  it('escapes all HTML-sensitive client-controlled values', () => {
    expect(escapeHtml(`<img src="x" onerror='bad'> &`)).toBe('&lt;img src=&quot;x&quot; onerror=&#39;bad&#39;&gt; &amp;');

    const html = renderConsentPage(
      {
        clientId: 'client',
        clientName: '<client>',
        clientUri: 'https://example.test/?q=<bad>',
        redirectUri: 'https://client.test/callback',
        redirectHost: '<client.test>',
        redirectIsLoopback: false,
        scope: ['read', '<script>'],
      },
      'handle',
      'csrf',
    );

    expect(html).toContain('&lt;client&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('keeps MCP props limited to the documented identity fields', () => {
    expect(authProps({ sub: 'access-sub', email: 'User@Example.test', name: 'User' }, 123)).toEqual({
      userId: 'access-sub',
      email: 'User@Example.test',
      name: 'User',
      athleteId: 123,
    });
  });

  it('applies the optional email allowlist case-insensitively', () => {
    expect(isEmailAllowed(undefined, undefined)).toBe(true);
    expect(isEmailAllowed('USER@example.test', 'admin@example.test, user@example.test')).toBe(true);
    expect(isEmailAllowed('other@example.test', 'admin@example.test, user@example.test')).toBe(false);
  });

  it('compares CSRF values without early string equality', () => {
    expect(constantTimeEqual('csrf-value', 'csrf-value')).toBe(true);
    expect(constantTimeEqual('csrf-value', 'csrf-valuf')).toBe(false);
    expect(constantTimeEqual('csrf-value', 'csrf')).toBe(false);
  });
});
