// Writes the Firebase uid -> Keycloak id map of every imported user, read from
// the `firebaseUid` attribute convert.ts sets. Apps that keyed data on the
// Firebase uid remap with it. Ids only, no addresses.
//
//   node importer/uid-map.ts <uid-map.json>

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { check, connect } from "../lib/admin.ts";

const PAGE = 500;

const { positionals } = parseArgs({ allowPositionals: true });
if (positionals.length !== 1) {
  console.error("usage: node importer/uid-map.ts <uid-map.json>");
  process.exit(2);
}

const admin = await connect();
const map: Record<string, string> = {};
let users = 0;
for (let first = 0; ; first += PAGE) {
  const page: { id: string; attributes?: Record<string, string[]> }[] = await (
    await check(await admin(`/users?briefRepresentation=false&first=${first}&max=${PAGE}`))
  ).json();
  for (const user of page) {
    const uid = user.attributes?.firebaseUid?.[0];
    if (uid) map[uid] = user.id;
  }
  users += page.length;
  if (page.length < PAGE) break;
}

mkdirSync(dirname(positionals[0]), { recursive: true });
writeFileSync(positionals[0], JSON.stringify(map, null, 2) + "\n");
console.log(`Keycloak users: ${users}, with a Firebase uid: ${Object.keys(map).length}`);
console.log(`Wrote ${positionals[0]}`);
