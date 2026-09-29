import type { CallToolResult, McpServer as WorkerMcpServer } from "@modelcontextprotocol/server";
import type { McpServer as LocalMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodObject, ZodRawShape, ZodType } from "zod";

import { connectStravaTool, disconnectStravaTool, checkStravaConnectionTool } from "../tools/connectStrava.js";
import { exploreSegments } from "../tools/exploreSegments.js";
import { exportRouteGpx } from "../tools/exportRouteGpx.js";
import { exportRouteTcx } from "../tools/exportRouteTcx.js";
import { getActivityDetailsTool } from "../tools/getActivityDetails.js";
import { getActivityLapsTool } from "../tools/getActivityLaps.js";
import { getActivityPhotosTool } from "../tools/getActivityPhotos.js";
import { getActivityStreamsTool } from "../tools/getActivityStreams.js";
import { getAllActivities } from "../tools/getAllActivities.js";
import { getAthleteProfile } from "../tools/getAthleteProfile.js";
import { getAthleteShoesTool } from "../tools/getAthleteShoes.js";
import { getAthleteStatsTool } from "../tools/getAthleteStats.js";
import { getAthleteZonesTool } from "../tools/getAthleteZones.js";
import { getRecentActivities } from "../tools/getRecentActivities.js";
import { getRouteTool } from "../tools/getRoute.js";
import { getSegmentTool } from "../tools/getSegment.js";
import { getSegmentEffortTool } from "../tools/getSegmentEffort.js";
import { getSegmentLeaderboardTool } from "../tools/getSegmentLeaderboard.js";
import { getServerVersionTool } from "../tools/getServerVersion.js";
import { listAthleteClubs } from "../tools/listAthleteClubs.js";
import { listAthleteRoutesTool } from "../tools/listAthleteRoutes.js";
import { listSegmentEffortsTool } from "../tools/listSegmentEfforts.js";
import { listStarredSegments } from "../tools/listStarredSegments.js";
import { starSegment } from "../tools/starSegment.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: ZodType;
  execute: (input: never) => Promise<unknown>;
}

const sharedTools = [
  getAthleteProfile,
  getAthleteStatsTool,
  getActivityDetailsTool,
  getRecentActivities,
  listAthleteClubs,
  listStarredSegments,
  getSegmentTool,
  exploreSegments,
  starSegment,
  getSegmentEffortTool,
  listSegmentEffortsTool,
  listAthleteRoutesTool,
  getRouteTool,
  getActivityStreamsTool,
  getActivityLapsTool,
  getAthleteZonesTool,
  getAthleteShoesTool,
  getAllActivities,
  getActivityPhotosTool,
  getServerVersionTool,
  getSegmentLeaderboardTool,
  checkStravaConnectionTool,
  disconnectStravaTool,
] as unknown as ToolDefinition[];

const localOnlyTools = [
  connectStravaTool,
  exportRouteGpx,
  exportRouteTcx,
] as unknown as ToolDefinition[];

const writeTools = new Set(["star-segment", "disconnect-strava"]);
const destructiveTools = new Set(["disconnect-strava"]);

export function registerLocalTools(server: LocalMcpServer): void {
  for (const tool of [...sharedTools, ...localOnlyTools]) {
    const shape = (tool.inputSchema as ZodObject<ZodRawShape> | undefined)?.shape ?? {};
    server.tool(
      tool.name,
      tool.description,
      shape,
      tool.execute as never,
    );
  }
}

export function registerWorkerTools(
  server: WorkerMcpServer,
  executeWithContext: (tool: ToolDefinition, input: unknown) => Promise<unknown>,
): void {
  for (const tool of sharedTools) {
    const scopes = writeTools.has(tool.name) ? ["mcp:write"] : ["mcp:read"];
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: !writeTools.has(tool.name),
          destructiveHint: destructiveTools.has(tool.name),
          idempotentHint: tool.name !== "star-segment",
          openWorldHint: true,
        },
        _meta: {
          securitySchemes: [{ type: "oauth2", scopes }],
        },
      },
      async (input: unknown) => executeWithContext(tool, input) as Promise<CallToolResult>,
    );
  }
}

export function getWorkerToolNames(): string[] {
  return sharedTools.map((tool) => tool.name);
}
