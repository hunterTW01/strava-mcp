---
name: manage-connection
description: Check, troubleshoot, or remove the user's Strava connection for this plugin. Use when tools report expired authorization, missing scopes, an unlinked account, or when the user asks to disconnect.
---

# Manage the Strava connection

1. Start with `check-strava-connection` and report the returned status plainly.
2. If the connection is absent or expired, ask the user to reconnect through
   the plugin's OAuth connection flow. Never request or display access tokens,
   refresh tokens, client secrets, or fixed authorization headers.
3. After reconnection, verify with `get-athlete-profile` or a small
   `get-recent-activities` request before attempting a large analysis.
4. Explain missing-scope errors using the operation that requires the scope;
   do not claim data is absent when authorization prevented access.
5. Call `disconnect-strava` only after the user explicitly asks to disconnect
   and understands that subsequent Strava tools will require reconnection.

Do not confuse the plugin's MCP OAuth identity profile with a successful Strava
API connection; verify both when troubleshooting.
