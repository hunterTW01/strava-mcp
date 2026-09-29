import { describe, expect, it } from "vitest";

import { getServerInfo, SERVER_NAME } from "../src/serverInfo.js";

describe("getServerInfo", () => {
  it("reads package metadata without a Node-only module loader", () => {
    expect(getServerInfo()).toEqual({
      name: SERVER_NAME,
      version: "1.2.1",
      packageName: "@r-huijts/strava-mcp-server",
      mcpName: "io.github.r-huijts/strava-mcp",
    });
  });
});
