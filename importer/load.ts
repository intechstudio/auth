// Loads a users file written by convert.ts into the realm through the Admin
// API's partial import. Users that already exist (same id, username or email)
// are skipped, never overwritten.
//
//   node importer/load.ts <users.json>

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { check, connect } from "../lib/admin.ts";

const CHUNK = 500;

const { positionals } = parseArgs({ allowPositionals: true });
if (positionals.length !== 1) {
  console.error("usage: node importer/load.ts <users.json>");
  process.exit(2);
}

const { users } = JSON.parse(readFileSync(positionals[0], "utf8"));
const admin = await connect();

let added = 0;
let skipped = 0;
for (let i = 0; i < users.length; i += CHUNK) {
  const response = await check(
    await admin("/partialImport", {
      method: "POST",
      body: JSON.stringify({ ifResourceExists: "SKIP", users: users.slice(i, i + CHUNK) }),
    }),
  );
  const result = await response.json();
  added += result.added;
  skipped += result.skipped;
  for (const r of result.results.filter((r: { action: string }) => r.action === "SKIPPED")) {
    console.log(`  skipped, exists: ${r.resourceName}`);
  }
}
console.log(`Users in file: ${users.length}, added: ${added}, skipped: ${skipped}`);
