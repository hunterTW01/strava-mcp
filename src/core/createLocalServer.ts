import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getServerInfo, SERVER_NAME } from "../serverInfo.js";
import { registerLocalTools } from "./tools.js";

export function createLocalMcpServer(): McpServer {
  const { version } = getServerInfo();
  const server = new McpServer({ name: SERVER_NAME, version });
  registerLocalTools(server);
  return server;
}
