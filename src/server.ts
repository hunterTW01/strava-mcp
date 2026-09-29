#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";
import { createLocalMcpServer } from "./core/createLocalServer.js";
import { getServerInfo, SERVER_NAME } from "./serverInfo.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDirectory, "..", ".env") });

async function startServer(): Promise<void> {
  try {
    const { version } = getServerInfo();
    console.error(`Starting ${SERVER_NAME} v${version}...`);

    const config = await loadConfig();
    if (config.accessToken && !process.env.STRAVA_ACCESS_TOKEN) {
      process.env.STRAVA_ACCESS_TOKEN = config.accessToken;
    }
    if (config.refreshToken && !process.env.STRAVA_REFRESH_TOKEN) {
      process.env.STRAVA_REFRESH_TOKEN = config.refreshToken;
    }
    if (config.clientId && !process.env.STRAVA_CLIENT_ID) {
      process.env.STRAVA_CLIENT_ID = config.clientId;
    }
    if (config.clientSecret && !process.env.STRAVA_CLIENT_SECRET) {
      process.env.STRAVA_CLIENT_SECRET = config.clientSecret;
    }

    const server = createLocalMcpServer();
    await server.connect(new StdioServerTransport());
    console.error(`${SERVER_NAME} v${version} connected via stdio.`);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exitCode = 1;
  }
}

void startServer();
