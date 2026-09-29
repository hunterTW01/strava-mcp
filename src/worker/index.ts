import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";

import { registerWorkerTools, type ToolDefinition } from "../core/tools.js";
import { runWithStravaTokenRuntime } from "../runtime/stravaTokenRuntime.js";
import { StravaAccountDO } from "../storage/StravaAccountDO.js";
import { getServerInfo, SERVER_NAME } from "../serverInfo.js";
import { handleOAuthRequest } from "./auth/index.js";
import type { AuthProps, Env } from "./auth/types.js";
import {
  createWorkerStravaTokenRuntime,
  getWorkerStravaStatus,
} from "./stravaTokenRuntime.js";

export { StravaAccountDO };

const profileOutputSchema = z.object({
  id: z.string().min(1).regex(/\S/),
  name: z.string().optional(),
  email: z.string().optional(),
  nickname: z.string().optional(),
});

function authProps(): AuthProps {
  const props = getMcpAuthContext()?.props as Partial<AuthProps> | undefined;
  if (!props?.userId) {
    throw new Error("Authenticated user context is missing");
  }
  return props as AuthProps;
}

function createWorkerMcpServer(env: Env): McpServer {
  const { version } = getServerInfo();
  const server = new McpServer({ name: SERVER_NAME, version });

  registerWorkerTools(server, async (tool: ToolDefinition, input: unknown) => {
    const props = authProps();
    const runtime = createWorkerStravaTokenRuntime(env, props.userId);
    return runWithStravaTokenRuntime(runtime, () => tool.execute(input as never));
  });

  server.registerTool(
    "get-profile",
    {
      description: "Return the Strava profile represented by the authenticated connection.",
      inputSchema: z.object({}),
      outputSchema: profileOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        "openai/profile": true,
        securitySchemes: [{ type: "oauth2", scopes: ["mcp:read"] }],
      },
    },
    async () => {
      const props = authProps();
      const status = await getWorkerStravaStatus(env, props.userId);
      if (!status.connected || !status.athlete?.id) {
        return {
          isError: true,
          content: [{ type: "text", text: "The Strava account is no longer linked." }],
        };
      }

      const fullName = [status.athlete.firstname, status.athlete.lastname]
        .filter(Boolean)
        .join(" ");
      const profile = {
        id: `strava:${status.athlete.id}`,
        ...(fullName ? { name: fullName } : props.name ? { name: props.name } : {}),
        ...(props.email ? { email: props.email } : {}),
        ...(status.athlete.username ? { nickname: status.athlete.username } : {}),
      };

      return {
        isError: false,
        structuredContent: profile,
        content: [{ type: "text", text: JSON.stringify(profile) }],
      };
    },
  );

  return server;
}

const apiHandler = {
  fetch(request, env, ctx) {
    const handler = createMcpHandler(() => createWorkerMcpServer(env), {
      route: "/mcp",
      corsOptions: false,
    });
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

const defaultHandler = {
  fetch: handleOAuthRequest,
} satisfies ExportedHandler<Env>;

function createProvider(origin: string): OAuthProvider<Env> {
  const resource = `${origin}/mcp`;
  return new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler,
    defaultHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    scopesSupported: ["mcp:read", "mcp:write", "offline_access"],
    requiredScopes: ["mcp:read", "mcp:write"],
    resourceMetadata: {
      resource,
      authorization_servers: [origin],
      resource_name: SERVER_NAME,
    },
    clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: 60 * 60,
    refreshTokenTTL: 30 * 24 * 60 * 60,
  });
}

function publicOrigin(request: Request, env: Env): string {
  const url = new URL(env.PUBLIC_BASE_URL?.trim() || request.url);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !isLocal) {
    throw new Error("PUBLIC_BASE_URL must use HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("PUBLIC_BASE_URL must be an origin without credentials, query data, or a fragment");
  }
  return url.origin;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return createProvider(publicOrigin(request, env)).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
