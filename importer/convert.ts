// Converts a `firebase auth:export --format=json` file into a Keycloak users
// file for the intechstudio realm. Dry run by default: prints counts and
// writes nothing. `--write <path>` writes the file.
//
//   node importer/convert.ts <firebase-export.json> [--write <users.json>]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

// Admin-only user profile attributes. The recovery workflow selects on the
// marker; uid-map.ts reads the Firebase uid back once Keycloak has assigned ids.
const RECOVERY_MARKER = "recoveryEmail";
const FIREBASE_UID = "firebaseUid";

type FirebaseUser = {
  localId: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  passwordHash?: string;
  disabled?: boolean;
  providerUserInfo?: { providerId: string; rawId: string; email?: string }[];
};

type KeycloakUser = {
  username: string;
  email: string;
  emailVerified: boolean;
  enabled: boolean;
  realmRoles: string[];
  firstName?: string;
  lastName?: string;
  attributes: Record<string, string[]>;
  federatedIdentities?: { identityProvider: string; userId: string; userName: string }[];
};

function toKeycloakUser(user: FirebaseUser): KeycloakUser {
  const email = user.email!.toLowerCase();
  const displayName = user.displayName?.trim() ?? "";
  const space = displayName.indexOf(" ");
  const firstName = space === -1 ? displayName : displayName.slice(0, space);
  const lastName = space === -1 ? "" : displayName.slice(space + 1).trim();
  const google = (user.providerUserInfo ?? []).filter((p) => p.providerId === "google.com");

  return {
    username: email,
    email,
    emailVerified: user.emailVerified === true,
    enabled: user.disabled !== true,
    // Partial import does not grant the realm's default roles (offline_access,
    // account management) the way sign-up does.
    realmRoles: ["default-roles-intechstudio"],
    ...(firstName && { firstName }),
    ...(lastName && { lastName }),
    attributes: {
      [FIREBASE_UID]: [user.localId],
      ...(user.passwordHash && { [RECOVERY_MARKER]: ["pending"] }),
    },
    ...(google.length > 0 && {
      federatedIdentities: google.map((p) => ({
        identityProvider: "google",
        userId: p.rawId,
        userName: p.email ?? "",
      })),
    }),
  };
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { write: { type: "string" } },
});
if (positionals.length !== 1) {
  console.error("usage: node importer/convert.ts <firebase-export.json> [--write <users.json>]");
  process.exit(2);
}

const exported: FirebaseUser[] = JSON.parse(readFileSync(positionals[0], "utf8")).users;
const withEmail = exported.filter((u) => u.email);

const byEmail = Map.groupBy(withEmail, (u) => u.email!.toLowerCase());
const duplicates = [...byEmail].filter(([, users]) => users.length > 1);
const users = withEmail
  .filter((u) => byEmail.get(u.email!.toLowerCase())!.length === 1)
  .map(toKeycloakUser);

console.log(`Firebase users:            ${exported.length}`);
console.log(`Skipped, no email:         ${exported.length - withEmail.length}`);
console.log(`Skipped, duplicate email:  ${duplicates.reduce((n, [, dupes]) => n + dupes.length, 0)}`);
for (const [email, dupes] of duplicates) {
  console.log(`  ${email}: ${dupes.map((u) => u.localId).join(", ")}`);
}
console.log(`Importable:                ${users.length}`);
console.log(`  marked for recovery:     ${users.filter((u) => u.attributes[RECOVERY_MARKER]).length}`);
console.log(`  Google links:            ${users.reduce((n, u) => n + (u.federatedIdentities?.length ?? 0), 0)}`);
console.log(`  unverified email:        ${users.filter((u) => !u.emailVerified).length}`);
console.log(`  disabled:                ${users.filter((u) => !u.enabled).length}`);

if (values.write) {
  mkdirSync(dirname(values.write), { recursive: true });
  writeFileSync(values.write, JSON.stringify({ realm: "intechstudio", users }, null, 2) + "\n");
  console.log(`Wrote ${values.write}`);
} else {
  console.log("Dry run; pass --write <path> to write the users file.");
}
