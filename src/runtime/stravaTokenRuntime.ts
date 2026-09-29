import { AsyncLocalStorage } from "node:async_hooks";
import axios from "axios";
import {
    clearConfig,
    hasValidTokens,
    loadConfig,
    updateTokens,
} from "../config.js";

const TOKEN_EXPIRY_SAFETY_WINDOW_SECONDS = 300;

export interface StravaConnectionStatus {
    connected: boolean;
    expiresAt?: number;
}

/**
 * Supplies the Strava credentials for one request or local process.
 * Worker code can provide its own implementation and run a request inside
 * runWithStravaTokenRuntime().
 */
export interface StravaTokenRuntime {
    getValidAccessToken(): Promise<string | undefined>;
    forceRefresh(): Promise<string>;
    getConnectionStatus(): Promise<StravaConnectionStatus>;
    disconnect(): Promise<void>;
}

const runtimeStorage = new AsyncLocalStorage<StravaTokenRuntime>();
let localRuntime: StravaTokenRuntime | undefined;
let localRefreshPromise: Promise<string> | undefined;

function isUsableToken(token: string | undefined): token is string {
    return Boolean(token && token !== "YOUR_STRAVA_ACCESS_TOKEN_HERE");
}

function createLocalStravaTokenRuntime(): StravaTokenRuntime {
    const runtime: StravaTokenRuntime = {
        async getValidAccessToken(): Promise<string | undefined> {
            const config = await loadConfig();

            if (!isUsableToken(config.accessToken)) {
                return undefined;
            }

            const expiresAt = config.expiresAt;
            const refreshNeeded = expiresAt !== undefined
                && expiresAt <= Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SAFETY_WINDOW_SECONDS;

            if (!refreshNeeded || !config.refreshToken) {
                return config.accessToken;
            }

            try {
                return await runtime.forceRefresh();
            } catch (error) {
                console.error("Failed to refresh the local Strava token:", error);
                return undefined;
            }
        },

        async forceRefresh(): Promise<string> {
            if (localRefreshPromise) {
                return localRefreshPromise;
            }

            localRefreshPromise = (async () => {
                const config = await loadConfig();
                const refreshToken = config.refreshToken;
                const clientId = config.clientId;
                const clientSecret = config.clientSecret;

                if (!refreshToken || !clientId || !clientSecret) {
                    throw new Error("Missing refresh credentials. Please connect your Strava account first using the 'connect-strava' tool.");
                }

                const response = await axios.post("https://www.strava.com/oauth/token", {
                    client_id: clientId,
                    client_secret: clientSecret,
                    refresh_token: refreshToken,
                    grant_type: "refresh_token",
                });

                const newAccessToken = response.data?.access_token;
                const newRefreshToken = response.data?.refresh_token || refreshToken;
                const expiresAt = response.data?.expires_at;

                if (!newAccessToken || !newRefreshToken) {
                    throw new Error("Refresh response missing required tokens");
                }

                await updateTokens(newAccessToken, newRefreshToken, expiresAt);
                return newAccessToken as string;
            })().finally(() => {
                localRefreshPromise = undefined;
            });

            return localRefreshPromise;
        },

        async getConnectionStatus(): Promise<StravaConnectionStatus> {
            const config = await loadConfig();
            return {
                connected: hasValidTokens(config),
                expiresAt: config.expiresAt,
            };
        },

        async disconnect(): Promise<void> {
            await clearConfig();

            // Keep the legacy stdio process from reusing credentials loaded by dotenv.
            delete process.env.STRAVA_ACCESS_TOKEN;
            delete process.env.STRAVA_REFRESH_TOKEN;
        },
    };

    return runtime;
}

export function getStravaTokenRuntime(): StravaTokenRuntime {
    return runtimeStorage.getStore() ?? (localRuntime ??= createLocalStravaTokenRuntime());
}

export function runWithStravaTokenRuntime<T>(
    runtime: StravaTokenRuntime,
    callback: () => T,
): T {
    return runtimeStorage.run(runtime, callback);
}

export async function getValidAccessToken(): Promise<string | undefined> {
    return getStravaTokenRuntime().getValidAccessToken();
}
