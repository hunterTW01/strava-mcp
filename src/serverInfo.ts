import pkg from "../package.json" with { type: "json" };

export const SERVER_NAME = "Strava MCP Server";

export function getServerInfo(): {
  name: string;
  version: string;
  packageName: string;
  mcpName?: string;
} {
  return {
    name: SERVER_NAME,
    version: pkg.version,
    packageName: pkg.name,
    mcpName: pkg.mcpName,
  };
}
