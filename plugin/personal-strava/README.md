# Strava plugin

This private plugin connects ChatGPT to the Strava MCP server deployed at
`https://strava-mcp.suhome.net/mcp`.

Authentication is handled by the MCP server's OAuth flow. The package contains
no Strava tokens, OAuth credentials, Cloudflare secrets, or fixed authorization
headers.

Included skills cover training-period review, individual activity analysis,
athlete insights, route and segment workflows, and connection recovery.
