// Admin API access for the scripts in this repo. Reads `.env` when present,
// with the same local defaults as docker-compose.yml, and refuses any
// Keycloak that is not on this machine unless `--target-host <host>` names it.

import { existsSync } from "node:fs";

const DEFAULTS: Record<string, string> = {
  AUTH_URL: "http://localhost:3001",
  WEBSITE_URL: "http://localhost:5173",
  KC_ADMIN_USERNAME: "admin",
  KC_ADMIN_PASSWORD: "admin",
  RECOVERY_EMAIL_INTERVAL: "30s",
  RECOVERY_EMAIL_BATCH_SIZE: "2",
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

if (existsSync(".env")) process.loadEnvFile(".env");

export function env(name: string): string {
  const value = process.env[name] || DEFAULTS[name];
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}

export const REALM = "intechstudio";

export type Admin = (path: string, init?: RequestInit) => Promise<Response>;

// Returns a fetch for `<AUTH_URL>/admin/realms/intechstudio<path>`.
export async function connect(targetHost: string | undefined): Promise<Admin> {
  const base = new URL(env("AUTH_URL"));
  if (!LOCAL_HOSTS.has(base.hostname) && base.hostname !== targetHost) {
    throw new Error(
      `Refusing ${base.origin}: not local. Pass --target-host ${base.hostname} to confirm.`,
    );
  }

  const tokenResponse = await fetch(new URL("/realms/master/protocol/openid-connect/token", base), {
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
    fetch(new URL(`/admin/realms/${REALM}${path}`, base), {
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
