import { readFile } from "node:fs/promises";
import { isDeepStrictEqual, parseArgs } from "node:util";

import {
  createManagementApi,
  ManagementApiError,
  requireEnv,
} from "./management-api.ts";

const SMTP_CONNECTOR_FACTORY_ID = "simple-mail-transfer-protocol";
const GRID_EDITOR_NATIVE_REDIRECT_URI = "grid-editor://auth/callback";

type AppType = "Traditional" | "Native";
type App = {
  id: string;
  name: string;
  type: AppType;
  oidcClientMetadata: {
    redirectUris: string[];
    postLogoutRedirectUris: string[];
  };
};
type Named = { id: string; name: string };
type Connector = {
  id: string;
  connectorId: string;
  config: Record<string, unknown>;
};
type ConfiguredCaptcha = { config: Record<string, unknown> };

const { values: args } = parseArgs({
  options: { "show-secrets": { type: "boolean", default: false } },
});

const api = createManagementApi();
const changes: string[] = [];

function record(object: string, outcome: "created" | "updated" | "unchanged") {
  console.log(`${outcome.padEnd(9)} ${object}`);
  if (outcome !== "unchanged") changes.push(object);
}

function uriList(
  name: string,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): string[] {
  const value = process.env[name];
  if (value === undefined) throw new Error(`Missing env ${name}`);
  const uris = value
    .split(",")
    .map((uri) => uri.trim())
    .filter(Boolean);
  if (uris.length === 0 && !allowEmpty) {
    throw new Error(`Env ${name} needs at least one URI`);
  }
  return uris;
}

/** Server responses carry defaults and read-only fields we do not manage. */
function coversDesired(actual: unknown, desired: unknown): boolean {
  if (
    typeof desired !== "object" ||
    desired === null ||
    Array.isArray(desired)
  ) {
    return isDeepStrictEqual(actual, desired);
  }
  if (typeof actual !== "object" || actual === null) return false;
  return Object.entries(desired).every(([key, value]) =>
    coversDesired((actual as Record<string, unknown>)[key], value),
  );
}

function findOneByName<T extends Named>(
  items: T[],
  name: string,
): T | undefined {
  const matches = items.filter((item) => item.name === name);
  if (matches.length > 1) {
    throw new Error(`${matches.length} objects named ${name}, expected one`);
  }
  return matches[0];
}

async function upsertApp(
  existingApps: App[],
  name: string,
  type: AppType,
  redirectUris: string[],
  postLogoutRedirectUris: string[],
): Promise<App> {
  const oidcClientMetadata = { redirectUris, postLogoutRedirectUris };
  const existing = findOneByName(existingApps, name);

  if (!existing) {
    const created = await api.post<App>("/applications", {
      name,
      type,
      oidcClientMetadata,
    });
    record(`app ${name}`, "created");
    return created;
  }
  if (existing.type !== type) {
    throw new Error(`App ${name} is ${existing.type}, expected ${type}`);
  }
  if (coversDesired(existing.oidcClientMetadata, oidcClientMetadata)) {
    record(`app ${name}`, "unchanged");
    return existing;
  }
  const updated = await api.patch<App>(`/applications/${existing.id}`, {
    oidcClientMetadata,
  });
  record(`app ${name}`, "updated");
  return updated;
}

function smtpConnectorConfig() {
  const template = (usageType: string, subject: string) => ({
    usageType,
    contentType: "text/plain",
    subject,
    content: `Your Intech Studio verification code is {{code}}. It expires in 10 minutes.`,
  });
  return {
    host: requireEnv("SMTP_HOST"),
    port: Number(requireEnv("SMTP_PORT")),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      type: "login",
      user: requireEnv("SMTP_USER"),
      pass: requireEnv("SMTP_PASS"),
    },
    fromEmail: requireEnv("SMTP_FROM"),
    templates: [
      template("Register", "Finish creating your Intech Studio account"),
      template("SignIn", "Sign in to Intech Studio"),
      template("ForgotPassword", "Reset your Intech Studio password"),
      template("Generic", "Your Intech Studio verification code"),
    ],
  };
}

async function upsertSmtpConnector() {
  const config = smtpConnectorConfig();
  const existing = (await api.get<Connector[]>("/connectors")).find(
    ({ connectorId }) => connectorId === SMTP_CONNECTOR_FACTORY_ID,
  );

  if (!existing) {
    await api.post("/connectors", {
      connectorId: SMTP_CONNECTOR_FACTORY_ID,
      config,
    });
    record("connector smtp", "created");
  } else if (coversDesired(existing.config, config)) {
    record("connector smtp", "unchanged");
  } else {
    await api.patch(`/connectors/${existing.id}`, { config });
    record("connector smtp", "updated");
  }
}

async function findCaptchaProvider(): Promise<ConfiguredCaptcha | undefined> {
  try {
    return await api.get<ConfiguredCaptcha>("/captcha-provider");
  } catch (error) {
    if (error instanceof ManagementApiError && error.status === 404) {
      return undefined;
    }
    throw error;
  }
}

async function upsertTurnstile(): Promise<boolean> {
  const siteKey = process.env.TURNSTILE_SITE_KEY;
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!siteKey || !secretKey) return false;

  const config = { type: "Turnstile", siteKey, secretKey };
  const existing = await findCaptchaProvider();
  if (existing && coversDesired(existing.config, config)) {
    record("captcha turnstile", "unchanged");
  } else {
    await api.put("/captcha-provider", { config });
    record("captcha turnstile", existing ? "updated" : "created");
  }
  return true;
}

/** Inter Bold as Google Fonts serves it, by unicode range. License: fonts/OFL.txt. */
const BRANDING_FONTS = [
  [
    "Inter-Bold-latin.woff2",
    "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  ],
  [
    "Inter-Bold-latin-ext.woff2",
    "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
  ],
];

/** The font is embedded, so the hosted pages load nothing from another origin. */
async function loadBrandingCss() {
  const css = await readFile(new URL("./branding.css", import.meta.url), "utf8");
  const fontFaces = await Promise.all(
    BRANDING_FONTS.map(async ([file, unicodeRange]) => {
      const font = await readFile(new URL(`./fonts/${file}`, import.meta.url));
      return `@font-face { font-family: Inter; font-weight: 700; src: url(data:font/woff2;base64,${font.toString("base64")}) format("woff2"); unicode-range: ${unicodeRange}; }`;
    }),
  );
  return `${fontFaces.join("\n")}\n${css}`;
}

async function upsertSignInExperience(
  captchaEnabled: boolean,
  customCss: string,
) {
  const signInExperience = {
    signInMode: "SignInAndRegister",
    signUp: { identifiers: ["email"], password: true, verify: true },
    signIn: {
      methods: [
        {
          identifier: "email",
          password: true,
          verificationCode: true,
          isPasswordPrimary: true,
        },
      ],
    },
    color: {
      primaryColor: requireEnv("BRANDING_PRIMARY_COLOR"),
      isDarkModeEnabled: true,
      darkPrimaryColor: requireEnv("BRANDING_DARK_PRIMARY_COLOR"),
    },
    branding: {
      logoUrl: requireEnv("BRANDING_LOGO_URL"),
      darkLogoUrl: requireEnv("BRANDING_DARK_LOGO_URL"),
    },
    customCss,
    ...(captchaEnabled ? { captchaPolicy: { enabled: true } } : {}),
  };

  const existing = await api.get("/sign-in-exp");
  if (coversDesired(existing, signInExperience)) {
    record("sign-in experience", "unchanged");
  } else {
    await api.patch("/sign-in-exp", signInExperience);
    record("sign-in experience", "updated");
  }
}

/** Hosted account page: the website links here for email and password changes. */
async function upsertAccountCenter(customCss: string) {
  const accountCenter = {
    enabled: true,
    customCss,
    fields: {
      name: "Off",
      avatar: "Edit",
      email: "Edit",
      password: "Edit",
      social: "Edit",
    },
  };

  const existing = await api.get("/account-center");
  if (coversDesired(existing, accountCenter)) {
    record("account center", "unchanged");
  } else {
    await api.patch("/account-center", accountCenter);
    record("account center", "updated");
  }
}

async function upsertHqApiResource() {
  const name = "hq-api";
  const indicator = requireEnv("HQ_API_RESOURCE_INDICATOR");
  const existing = findOneByName(
    await api.get<(Named & { indicator: string })[]>("/resources"),
    name,
  );

  if (!existing) {
    await api.post("/resources", { name, indicator });
    record(`api resource ${name}`, "created");
    return;
  }
  // Logto does not allow editing an indicator after creation.
  if (existing.indicator !== indicator) {
    throw new Error(
      `Resource ${name} has indicator ${existing.indicator}, expected ${indicator}`,
    );
  }
  record(`api resource ${name}`, "unchanged");
}

async function printApps(apps: App[], showSecrets: boolean) {
  console.log("\nApplications:");
  for (const app of apps) {
    console.log(`  ${app.name}`);
    console.log(`    id:     ${app.id}`);
    if (!showSecrets) continue;
    const secrets =
      app.type === "Native"
        ? []
        : await api.get<{ value: string }[]>(
            `/applications/${app.id}/secrets`,
          );
    console.log(`    secret: ${secrets[0]?.value ?? "none (public client)"}`);
  }
}

const desiredApps: [string, AppType, string[], string[]][] = [
  [
    "website",
    "Traditional",
    uriList("WEBSITE_REDIRECT_URIS"),
    uriList("WEBSITE_POST_LOGOUT_REDIRECT_URIS"),
  ],
  [
    "discourse",
    "Traditional",
    uriList("DISCOURSE_REDIRECT_URIS", { allowEmpty: true }),
    uriList("DISCOURSE_POST_LOGOUT_REDIRECT_URIS", { allowEmpty: true }),
  ],
  [
    "grid-editor",
    "Native",
    [
      GRID_EDITOR_NATIVE_REDIRECT_URI,
      ...uriList("GRID_EDITOR_WEB_REDIRECT_URIS"),
    ],
    uriList("GRID_EDITOR_POST_LOGOUT_REDIRECT_URIS"),
  ],
];

const existingApps = await api.get<App[]>("/applications");
const apps: App[] = [];
for (const desiredApp of desiredApps) {
  apps.push(await upsertApp(existingApps, ...desiredApp));
}

await upsertSmtpConnector();
const captchaEnabled = await upsertTurnstile();
const brandingCss = await loadBrandingCss();
await upsertSignInExperience(captchaEnabled, brandingCss);
await upsertAccountCenter(brandingCss);
await upsertHqApiResource();
await printApps(apps, args["show-secrets"]);

console.log(
  changes.length === 0
    ? "\nNo changes."
    : `\n${changes.length} changes: ${changes.join(", ")}`,
);
