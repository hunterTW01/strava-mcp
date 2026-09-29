import { AxiosError } from "axios";
import { describe, expect, it, vi } from "vitest";

import {
    getValidAccessToken,
    runWithStravaTokenRuntime,
    type StravaTokenRuntime,
} from "../src/runtime/stravaTokenRuntime.js";
import { getRecentActivities, stravaApi } from "../src/stravaClient.js";

function createRuntime(token: string): StravaTokenRuntime {
    return {
        getValidAccessToken: vi.fn(async () => token),
        forceRefresh: vi.fn(async () => token),
        getConnectionStatus: vi.fn(async () => ({ connected: true })),
        disconnect: vi.fn(async () => undefined),
    };
}

describe("Strava token runtime", () => {
    it("keeps concurrent request scopes isolated", async () => {
        const first = createRuntime("token-a");
        const second = createRuntime("token-b");

        const [firstToken, secondToken] = await Promise.all([
            runWithStravaTokenRuntime(first, async () => {
                await new Promise(resolve => setTimeout(resolve, 5));
                return getValidAccessToken();
            }),
            runWithStravaTokenRuntime(second, async () => getValidAccessToken()),
        ]);

        expect(firstToken).toBe("token-a");
        expect(secondToken).toBe("token-b");
    });

    it("passes the refreshed request token to a 401 retry", async () => {
        const runtime = createRuntime("refreshed-token");
        const unauthorized = new AxiosError("Unauthorized");
        unauthorized.response = {
            status: 401,
            statusText: "Unauthorized",
            headers: {},
            config: {} as never,
            data: {},
        };

        const get = vi.spyOn(stravaApi, "get")
            .mockRejectedValueOnce(unauthorized)
            .mockResolvedValueOnce({
                data: [{
                    id: 1,
                    name: "Test Ride",
                    distance: 1000,
                    start_date: "2024-01-01T00:00:00.000Z",
                }],
            } as never);

        try {
            const activities = await runWithStravaTokenRuntime(runtime, () =>
                getRecentActivities("expired-token"),
            );

            expect(activities).toHaveLength(1);
            expect(runtime.forceRefresh).toHaveBeenCalledOnce();
            expect(get.mock.calls[0]?.[1]?.headers).toEqual({
                Authorization: "Bearer expired-token",
            });
            expect(get.mock.calls[1]?.[1]?.headers).toEqual({
                Authorization: "Bearer refreshed-token",
            });
        } finally {
            get.mockRestore();
        }
    });
});
