import { describe, expect, it, vi } from "vitest";
import { stravaApi } from "../src/stravaClient.js";

describe("Strava API Cloudflare compatibility", () => {
    it("does not pass Axios's unsupported default cache mode to Request", async () => {
        let requestCache: RequestCache | undefined;

        class CloudflareRequest extends Request {
            constructor(input: RequestInfo | URL, init?: RequestInit) {
                if (init?.cache === "default") {
                    throw new TypeError("Unsupported cache mode: default");
                }
                requestCache = init?.cache;
                super(input, init);
            }
        }

        const fetchMock = vi.fn(async () => new Response("{}", {
            headers: { "content-type": "application/json" },
            status: 200,
        }));

        await stravaApi.get("athlete", {
            adapter: "fetch",
            env: {
                fetch: fetchMock,
                Request: CloudflareRequest,
                Response,
            },
        });

        expect(requestCache).toBe("no-store");
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});
