import { DurableObject } from "cloudflare:workers";

import type { StoredStravaAccount, StravaTokenSet } from "./types.js";

interface StravaAccountEnv {
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
}

interface StravaRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

const STORAGE_KEY = "account";
const EXPIRY_BUFFER_SECONDS = 300;

export class StravaAccountDO extends DurableObject<StravaAccountEnv> {
  private refreshPromise: Promise<string> | undefined;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/status") {
      const account = await this.loadAccount();
      return Response.json(account ? this.publicStatus(account) : { connected: false });
    }

    if (request.method === "PUT" && url.pathname === "/tokens") {
      const account = await this.parseAccount(request);
      await this.ctx.storage.put(STORAGE_KEY, account);
      return Response.json(this.publicStatus(account));
    }

    if (request.method === "GET" && url.pathname === "/access-token") {
      const force = url.searchParams.get("force") === "true";
      try {
        const token = await this.getValidAccessToken(force);
        return Response.json({ accessToken: token });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load Strava token";
        const status = message === "Strava account is not linked" ? 401 : 502;
        return Response.json({ error: message }, { status });
      }
    }

    if (request.method === "DELETE" && url.pathname === "/tokens") {
      const account = await this.loadAccount();
      await this.ctx.storage.delete(STORAGE_KEY);
      if (!account) {
        return new Response(null, { status: 204 });
      }

      try {
        await this.revokeToken(account.tokens.refreshToken);
        return new Response(null, { status: 204 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Strava token revocation failed";
        return Response.json({ error: message, disconnected: true }, { status: 502 });
      }
    }

    return new Response("Not found", { status: 404 });
  }

  private async loadAccount(): Promise<StoredStravaAccount | undefined> {
    return this.ctx.storage.get<StoredStravaAccount>(STORAGE_KEY);
  }

  private async parseAccount(request: Request): Promise<StoredStravaAccount> {
    const value = await request.json<StoredStravaAccount>();
    if (
      typeof value.userId !== "string" || value.userId.length === 0 ||
      typeof value.tokens?.accessToken !== "string" || value.tokens.accessToken.length === 0 ||
      typeof value.tokens.refreshToken !== "string" || value.tokens.refreshToken.length === 0 ||
      !Number.isSafeInteger(value.tokens.expiresAt) || value.tokens.expiresAt <= 0 ||
      !Number.isSafeInteger(value.tokens.createdAt) || value.tokens.createdAt <= 0 ||
      !Number.isSafeInteger(value.tokens.updatedAt) || value.tokens.updatedAt <= 0 ||
      !Number.isSafeInteger(value.tokens.athlete?.id) || value.tokens.athlete.id <= 0 ||
      !Array.isArray(value.tokens.scopes) ||
      value.tokens.scopes.some((scope) => typeof scope !== "string" || scope.length === 0)
    ) {
      throw new Error("Invalid Strava account payload");
    }
    return value;
  }

  private publicStatus(account: StoredStravaAccount) {
    return {
      connected: true,
      userId: account.userId,
      athlete: account.tokens.athlete,
      scopes: account.tokens.scopes,
      expiresAt: account.tokens.expiresAt,
    };
  }

  private async getValidAccessToken(forceRefresh: boolean): Promise<string> {
    const account = await this.loadAccount();
    if (!account) {
      throw new Error("Strava account is not linked");
    }

    const now = Math.floor(Date.now() / 1000);
    if (!forceRefresh && account.tokens.expiresAt > now + EXPIRY_BUFFER_SECONDS) {
      return account.tokens.accessToken;
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshTokens(account).finally(() => {
        this.refreshPromise = undefined;
      });
    }
    return this.refreshPromise;
  }

  private async refreshTokens(account: StoredStravaAccount): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.env.STRAVA_CLIENT_ID,
      client_secret: this.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: account.tokens.refreshToken,
    });
    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      throw new Error(`Strava token refresh failed (${response.status})`);
    }

    const refreshed = await response.json<StravaRefreshResponse>();
    if (!refreshed.access_token || !refreshed.refresh_token || !refreshed.expires_at) {
      throw new Error("Strava token refresh returned an invalid payload");
    }

    const current = await this.loadAccount();
    if (
      !current ||
      current.userId !== account.userId ||
      current.tokens.updatedAt !== account.tokens.updatedAt ||
      current.tokens.refreshToken !== account.tokens.refreshToken
    ) {
      throw new Error("Strava account changed while its token was refreshing");
    }

    const updatedTokens: StravaTokenSet = {
      ...account.tokens,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: refreshed.expires_at,
      updatedAt: Date.now(),
    };
    await this.ctx.storage.put(STORAGE_KEY, { ...account, tokens: updatedTokens });
    return updatedTokens.accessToken;
  }

  private async revokeToken(token: string): Promise<void> {
    const credentials = btoa(`${this.env.STRAVA_CLIENT_ID}:${this.env.STRAVA_CLIENT_SECRET}`);
    const response = await fetch("https://www.strava.com/oauth/revoke", {
      method: "POST",
      headers: {
        authorization: `Basic ${credentials}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token, token_type_hint: "refresh_token" }),
    });
    if (!response.ok) {
      throw new Error(`Strava token revocation failed (${response.status})`);
    }
  }
}
