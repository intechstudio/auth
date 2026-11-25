// Admin API access for the scripts in this repo. Reads `.env` when present,
// with the same local defaults as docker-compose.yml. `AUTH_URL` picks the
// Keycloak: the local one unless set, also while a tunnel is up.

import { existsSync } from "node:fs";

const DEFAULTS: Record<string, string> = {
  AUTH_URL: "http://localhost:3001",
  WEBSITE_URL: "http://localhost:5173",
  KC_ADMIN_USERNAME: "admin",
  KC_ADMIN_PASSWORD: "admin",
};

if (existsSync(".env")) process.loadEnvFile(".env");

export function env(name: string): string {
  const value = process.env[name] || DEFAULTS[name];
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}

export const AUTH_URL = new URL(env("AUTH_URL"));
export const REALM = "intechstudio";

export type Admin = (path: string, init?: RequestInit) => Promise<Response>;

// Returns a fetch for `<AUTH_URL>/admin/realms/intechstudio<path>`.
export async function connect(): Promise<Admin> {
  console.error(`Keycloak: ${AUTH_URL.origin}`);
  const tokenUrl = new URL("/realms/master/protocol/openid-connect/token", AUTH_URL);
  const tokenResponse = await fetch(tokenUrl, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: env("KC_ADMIN_USERNAME"),
      password: env("KC_ADMIN_PASSWORD"),
    }),
  });
  if (!tokenResponse.ok) throw new Error(`Admin sign-in failed: ${tokenResponse.status}`);
  const { access_token } = await tokenResponse.json();

  return (path, init = {}) =>
    fetch(new URL(`/admin/realms/${REALM}${path}`, AUTH_URL), {
      ...init,
      headers: {
        authorization: `Bearer ${access_token}`,
        accept: "application/json",
        ...(init.body && { "content-type": "application/json" }),
        ...init.headers,
      },
    });
}

export async function check(response: Response): Promise<Response> {
  if (!response.ok) {
    throw new Error(`${response.status} ${response.url}: ${await response.text()}`);
  }
  return response;
}
