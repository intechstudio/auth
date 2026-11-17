// Creates or updates the workflows in this directory. `${NAME}` in a
// definition is replaced from `.env`. A new workflow is created disabled; an
// existing one keeps its enabled state, which only --enable or --disable (or
// the admin console) changes.
//
//   node workflows/apply.ts [--enable <name> | --disable <name>] [--target-host <host>]

import { readdirSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { check, connect, env } from "../lib/admin.ts";

type Step = { uses: string; after?: string; with?: Record<string, string | string[]> };
type Workflow = {
  id?: string;
  name: string;
  enabled?: boolean;
  on?: string;
  if?: string;
  schedule?: { after: string; "batch-size": string | number };
  steps: Step[];
};

const { values } = parseArgs({
  options: {
    enable: { type: "string" },
    disable: { type: "string" },
    "target-host": { type: "string" },
  },
});

const dir = new URL(".", import.meta.url);
const definitions: Workflow[] = readdirSync(dir)
  .filter((file) => file.endsWith(".json"))
  .map((file) =>
    JSON.parse(
      readFileSync(new URL(file, dir), "utf8").replace(/\$\{(\w+)\}/g, (_, name) => env(name)),
    ),
  );

for (const name of [values.enable, values.disable]) {
  if (name && !definitions.some((d) => d.name === name)) {
    throw new Error(`No workflow named ${name} in ${dir.pathname}`);
  }
}

const admin = await connect(values["target-host"]);
const existing: Workflow[] = await (await check(await admin("/workflows?max=1000"))).json();

for (const definition of definitions) {
  const current = existing.find((w) => w.name === definition.name);
  const enabled =
    values.enable === definition.name ? true
    : values.disable === definition.name ? false
    : current?.enabled ?? false;
  const desired = { ...definition, enabled };
  const state = enabled ? "enabled" : "disabled";

  if (!current) {
    await check(await admin("/workflows", { method: "POST", body: JSON.stringify(desired) }));
    console.log(`${definition.name}: created, ${state}`);
  } else if (canonical(current) === canonical(desired)) {
    console.log(`${definition.name}: unchanged, ${state}`);
  } else {
    await check(
      await admin(`/workflows/${current.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...desired, id: current.id }),
      }),
    );
    console.log(`${definition.name}: updated, ${state}`);
  }
}

// The fields a definition sets. Keycloak returns a single step parameter
// without a list and may reorder lists, so parameters compare as sorted lists.
function canonical(w: Workflow): string {
  return JSON.stringify({
    name: w.name,
    enabled: w.enabled ?? true,
    on: w.on ?? null,
    if: w.if ?? null,
    schedule: w.schedule ? [String(w.schedule.after), String(w.schedule["batch-size"])] : null,
    steps: w.steps.map((s) => ({
      uses: s.uses,
      after: s.after ?? null,
      with: Object.entries(s.with ?? {})
        .map(([key, value]) => [key, [value].flat().sort()])
        .sort(),
    })),
  });
}
