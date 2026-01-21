/**
 * OAuth2 token management for D365 Finance & Operations
 */

import type { D365Config, CachedToken, TokenResponse } from "./types.js";
import { log, logError } from "./config.js";

// Token expiry buffer: refresh 5 minutes before actual expiry
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * OAuth2 token manager with automatic caching and refresh
 */
export class TokenManager {
  private config: D365Config;
  private cachedToken: CachedToken | null = null;
  private refreshPromise: Promise<CachedToken> | null = null;

  constructor(config: D365Config) {
    this.config = config;
  }

  /**
   * Get a valid access token, refreshing if necessary
   * Uses a shared promise to prevent concurrent token refresh requests
   */
  async getToken(): Promise<string> {
    // Check if cached token is still valid
    if (this.cachedToken && this.isTokenValid(this.cachedToken)) {
      return this.cachedToken.accessToken;
    }

    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      const token = await this.refreshPromise;
      return token.accessToken;
    }

    // Start a new refresh and share the promise with concurrent callers
    log("Acquiring new OAuth2 token...");
    this.refreshPromise = this.fetchToken();
    try {
      const token = await this.refreshPromise;
      this.cachedToken = token;
      log("Token acquired successfully");
      return token.accessToken;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Check if a cached token is still valid (with buffer)
   */
  private isTokenValid(token: CachedToken): boolean {
    return Date.now() < token.expiresAt - TOKEN_EXPIRY_BUFFER_MS;
  }

  /**
   * Fetch a new token from Azure AD
   */
  private async fetchToken(): Promise<CachedToken> {
    const tokenUrl = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/token`;

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      resource: this.config.environmentUrl, // Resource URL without trailing slash
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError(`Token acquisition failed: ${response.status}`, errorText);
      throw new Error(`Failed to acquire token: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as TokenResponse;

    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  /**
   * Invalidate the cached token (force refresh on next request)
   */
  invalidateToken(): void {
    this.cachedToken = null;
    log("Token cache invalidated");
  }
}
