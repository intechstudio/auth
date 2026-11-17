// Test users for other repos' end-to-end tests, so no app needs Keycloak's
// API. Only JSON or a token goes to stdout; diagnostics go to stderr.
//
//   node e2e/test-user.ts create [--first-name <x>] [--last-name <y>]   -> {"id","email","password"}
//   node e2e/test-user.ts token <email> <password>                      -> ID token
//   node e2e/test-user.ts delete <id>
//
// Each takes --target-host <host> for a Keycloak that is not on this machine.

import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { authUrl, check, connect, REALM } from "../lib/admin.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    "first-name": { type: "string" },
    "last-name": { type: "string" },
    "target-host": { type: "string" },
  },
});
const [command, ...args] = positionals;
const targetHost = values["target-host"];

if (command === "create" && args.length === 0) {
  const admin = await connect(targetHost);
  const email = `e2e-${randomBytes(6).toString("hex")}@example.com`;
  const password = `e2e-${randomBytes(16).toString("hex")}-Aa1!`;
  const response = await check(
    await admin("/users", {
      method: "POST",
      body: JSON.stringify({
        username: email,
        email,
        emailVerified: true,
        enabled: true,
        firstName: values["first-name"],
        lastName: values["last-name"],
        requiredActions: [],
        credentials: [{ type: "password", value: password, temporary: false }],
      }),
    }),
  );
  const id = response.headers.get("location")!.split("/").pop();
  console.log(JSON.stringify({ id, email, password }));
} else if (command === "token" && args.length === 2) {
  console.log(await signIn(authUrl(targetHost), args[0], args[1]));
} else if (command === "delete" && args.length === 1) {
  const admin = await connect(targetHost);
  const response = await admin(`/users/${encodeURIComponent(args[0])}`, { method: "DELETE" });
  if (response.status === 404) {
    console.error(`No user ${args[0]}`);
  } else {
    await check(response);
    console.error(`Deleted ${args[0]}`);
  }
} else {
  console.error(
    "usage: node e2e/test-user.ts create [--first-name <x>] [--last-name <y>]\n" +
      "       node e2e/test-user.ts token <email> <password>\n" +
      "       node e2e/test-user.ts delete <id>",
  );
  process.exit(2);
}

// What a browser does on the hosted login page: the code flow with PKCE for
// the public grid-editor client, ending at a loopback redirect nobody listens
// on; the code is read from the redirect itself.
async function signIn(base: URL, email: string, password: string): Promise<string> {
  const realm = new URL(`/realms/${REALM}/protocol/openid-connect/`, base);
  const redirectUri = `http://127.0.0.1:${49152 + Math.floor(Math.random() * 16384)}/auth/callback`;
  const verifier = randomBytes(32).toString("base64url");

  // Keycloak's cookies are Secure, which fetch has no jar for; keep them by hand.
  const cookies = new Map<string, string>();
  const call = async (url: string | URL, init: RequestInit = {}) => {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: { ...init.headers, cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      cookies.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
    }
    return response;
  };

  const loginPage = await call(
    new URL(
      `auth?${new URLSearchParams({
        client_id: "grid-editor",
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state: randomBytes(8).toString("hex"),
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
      })}`,
      realm,
    ),
  );
  const action = (await loginPage.text()).match(/<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/);
  if (!action) throw new Error(`No login form (${loginPage.status})`);

  const submitted = await call(action[1].replaceAll("&amp;", "&"), {
    method: "POST",
    body: new URLSearchParams({ username: email, password }),
  });
  const location = submitted.headers.get("location") ?? "";
  if (!location.startsWith(redirectUri)) {
    const page = await submitted.text();
    const error = page.match(/id="input-error-username"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    const message = error?.replace(/<[^>]*>/g, "").trim();
    throw new Error(`Sign-in did not finish (${submitted.status}): ${message ?? "unexpected page"}`);
  }
  const code = new URL(location).searchParams.get("code");
  if (!code) throw new Error(`No code in the redirect: ${location}`);

  const tokens = await check(
    await fetch(new URL("token", realm), {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: "grid-editor",
        code_verifier: verifier,
      }),
    }),
  );
  return (await tokens.json()).id_token;
}
