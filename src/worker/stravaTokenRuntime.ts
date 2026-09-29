import type {
  StravaConnectionStatus,
  StravaTokenRuntime,
} from "../runtime/stravaTokenRuntime.js";
import type { StravaAthleteSummary } from "../storage/types.js";

export interface WorkerStravaEnv {
  STRAVA_ACCOUNTS: DurableObjectNamespace;
}

export interface WorkerStravaStatus extends StravaConnectionStatus {
  athlete?: StravaAthleteSummary;
  scopes?: string[];
  userId?: string;
}

function accountStub(env: WorkerStravaEnv, userId: string): DurableObjectStub {
  return env.STRAVA_ACCOUNTS.get(env.STRAVA_ACCOUNTS.idFromName(userId));
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Strava account storage failed (${response.status})`);
  }
  return response.json<T>();
}

export async function getWorkerStravaStatus(
  env: WorkerStravaEnv,
  userId: string,
): Promise<WorkerStravaStatus> {
  const response = await accountStub(env, userId).fetch("https://account/status");
  return parseJsonResponse<WorkerStravaStatus>(response);
}

export function createWorkerStravaTokenRuntime(
  env: WorkerStravaEnv,
  userId: string,
): StravaTokenRuntime {
  const stub = accountStub(env, userId);

  async function accessToken(force: boolean): Promise<string | undefined> {
    const url = `https://account/access-token${force ? "?force=true" : ""}`;
    const response = await stub.fetch(url);
    if (response.status === 401 || response.status === 404) {
      return undefined;
    }
    const body = await parseJsonResponse<{ accessToken: string }>(response);
    return body.accessToken;
  }

  return {
    getValidAccessToken: () => accessToken(false),

    async forceRefresh(): Promise<string> {
      const token = await accessToken(true);
      if (!token) {
        throw new Error("Strava account is not linked");
      }
      return token;
    },

    getConnectionStatus: () => getWorkerStravaStatus(env, userId),

    async disconnect(): Promise<void> {
      const response = await stub.fetch("https://account/tokens", { method: "DELETE" });
      if (response.status === 502) {
        return;
      }
      if (!response.ok && response.status !== 404) {
        const detail = await response.text();
        throw new Error(detail || `Unable to disconnect Strava (${response.status})`);
      }
    },
  };
}
