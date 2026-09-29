# Troubleshooting JSONRPC Error After Package Name Change

If you're getting `JSONRPC.ProtocolTransportError fout 3` after updating to `@r-huijts/strava-mcp-server`, try these steps:

## Step 1: Clear npx Cache

The old package might be cached. Clear it:

```bash
rm -rf ~/.npm/_npx
```

## Step 2: Verify Your Claude Desktop Config

Make sure your `~/Library/Application Support/Claude/claude_desktop_config.json` has:

```json
{
  "mcpServers": {
    "strava": {
      "command": "npx",
      "args": ["-y", "@r-huijts/strava-mcp-server"]
    }
  }
}
```

**Important:** Remove any old references to `strava-mcp-server` (without the `@r-huijts/` prefix).

## Step 3: Restart Claude Desktop

1. Quit Claude Desktop completely
2. Reopen it
3. The MCP server should start automatically

## Step 4: Test Manually

Test if the package works:

```bash
npx -y @r-huijts/strava-mcp-server
```

You should see: "Starting Strava MCP Server v1.2.1..."

## Step 5: Check Claude Desktop Logs

If it still doesn't work, check Claude Desktop's developer console for error messages.

---

# Cloudflare Worker Deployment

This section covers the in-progress stateless Streamable HTTP Worker at `/mcp`. The local stdio setup above remains independent and should be used for `connect-strava`, GPX export, and TCX export.

## KV placeholder or binding error

Run `npx wrangler kv namespace create OAUTH_KV`, then replace the all-zero `OAUTH_KV` ID in `wrangler.jsonc` with the returned namespace ID. The `STRAVA_ACCOUNTS` Durable Object binding and migration must also remain present. KV stores OAuth provider state; per-user Strava tokens belong in the Durable Object.

## OAuth callback mismatch

Use the exact deployed origin in both systems:

- Access for SaaS OIDC callback: `https://<your-domain>/auth/access/callback`
- Strava callback domain: `<your-domain>`
- Strava callback URL: `https://<your-domain>/auth/strava/callback`

Also check that `ACCESS_AUTHORIZATION_URL`, `ACCESS_TOKEN_URL`, `ACCESS_JWKS_URL`, and `ACCESS_ISSUER` all belong to the same Access OIDC application and issuer.

When a production Worker is exposed through a custom domain, set `PUBLIC_BASE_URL` to that HTTPS origin (for example, `https://strava-mcp.example.com`) so OAuth discovery and both callback URLs use one canonical host.

## Missing Worker secrets

Check the deployed environment with the exact names used by the Worker: `ACCESS_CLIENT_ID`, `ACCESS_CLIENT_SECRET`, `ACCESS_AUTHORIZATION_URL`, `ACCESS_TOKEN_URL`, `ACCESS_JWKS_URL`, `ACCESS_ISSUER`, `COOKIE_ENCRYPTION_KEY`, `STRAVA_CLIENT_ID`, and `STRAVA_CLIENT_SECRET`. Set each with `npx wrangler secret put <NAME>`. `ALLOWED_EMAILS` and `STRAVA_SCOPES` are optional variables, not substitutes for required secrets.

For local Worker testing, put the same names in an untracked `.dev.vars`, start `npm run dev:worker`, and connect MCP Inspector to `http://localhost:8788/mcp`.

## Access succeeds but Strava is not linked

The intended first-use flow is Access authentication followed by one-time Strava linking. Confirm that the Access identity is allowed by `ALLOWED_EMAILS` when that variable is set, that the Strava callback uses the public Worker hostname, and that the callback can reach the `STRAVA_ACCOUNTS` Durable Object. After linking, later MCP calls should use the existing MCP connection and the Durable Object should refresh Strava tokens when needed.

## Verify before deployment

Run:

```bash
npm test
npm run typecheck
npm run build:worker
```

The Worker build command is a dry-run. Use `npm run deploy:worker` only after the tests, dry-run, and MCP Inspector checks pass. No deployment is performed by this documentation.
