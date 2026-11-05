const TOKEN_REFRESH_MARGIN_MS = 60_000;

export class ManagementApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${method} ${path} -> ${status}: ${body}`);
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}, see .env.example`);
  return value;
}

export function createManagementApi() {
  const endpoint = requireEnv("LOGTO_ENDPOINT");
  const resource = requireEnv("LOGTO_MANAGEMENT_API_RESOURCE");
  const basicAuth = Buffer.from(
    `${requireEnv("LOGTO_M2M_APP_ID")}:${requireEnv("LOGTO_M2M_APP_SECRET")}`,
  ).toString("base64");

  let token: { value: string; expiresAt: number } | undefined;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return token.value;
    }
    const response = await fetch(`${endpoint}/oidc/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${basicAuth}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        resource,
        scope: "all",
      }),
    });
    if (!response.ok) {
      throw new ManagementApiError(
        "POST",
        "/oidc/token",
        response.status,
        await response.text(),
      );
    }
    const { access_token, expires_in } = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    token = { value: access_token, expiresAt: Date.now() + expires_in * 1000 };
    return access_token;
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${endpoint}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new ManagementApiError(method, path, response.status, text);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
    patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
    put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  };
}

export type ManagementApi = ReturnType<typeof createManagementApi>;
