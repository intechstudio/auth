// Sends a notice email to every enabled user with an email in a
// `firebase auth:export --format=json` file, once per address. Dry run by
// default: prints counts and sends nothing. `--test-to` sends it to that one
// address only. `--commit` sends it to everyone not yet in the sent log, so a
// stopped run (Ctrl-C) continues where it left off; `--limit` sends the next
// <n> only.
//
//   node notice/send.ts <firebase-export.json> <notice.txt> [--test-to <address> | --commit [--limit <n>]]
//
// The notice file is plain text: the subject on the first line, an empty
// line, then paragraphs separated by empty lines. It goes out in the frame of
// the realm's emails, from the realm's sender, through the SMTP server in
// SMTP_* (unset: local Mailpit). The sent log is `<notice.txt>.<host>.sent`.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import nodemailer from "nodemailer";

// Emails a second. SES allows 14, shared with every other sender.
const RATE = 12;
const CONNECTIONS = 10;
// The realm's sender (smtpServer in realm/intechstudio.json).
const FROM = { name: "Intech Studio", address: "system@intech.studio" };
const REPLY_TO = "support@intech.studio";

type FirebaseUser = { email?: string; disabled?: boolean };

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    "test-to": { type: "string" },
    commit: { type: "boolean" },
    limit: { type: "string" },
  },
});
const limit = values.limit === undefined ? Infinity : Number(values.limit);
if (
  positionals.length !== 2 ||
  (values["test-to"] && values.commit) ||
  (values.limit !== undefined && !values.commit) ||
  !(limit > 0)
) {
  console.error(
    "usage: node notice/send.ts <firebase-export.json> <notice.txt> [--test-to <address> | --commit [--limit <n>]]",
  );
  process.exit(2);
}
const [exportPath, noticePath] = positionals;

const host = process.env.SMTP_HOST || "localhost";
const port = Number(process.env.SMTP_PORT || 1026);

const [subject, gap, ...body] = readFileSync(noticePath, "utf8").trim().split("\n");
if (!subject || gap?.trim() !== "" || body.length === 0) {
  throw new Error(`${noticePath}: the subject on the first line, an empty line, then the text`);
}
const paragraphs = body.join("\n").trim().split(/\n\s*\n/);
const text = paragraphs.join("\n\n") + "\n";
const html = frame(paragraphs.map((p) => `<p>${toHtml(p)}</p>`).join("\n"));

const exported: FirebaseUser[] = JSON.parse(readFileSync(exportPath, "utf8")).users;
const withEmail = exported.filter((u) => u.email);
const enabled = withEmail.filter((u) => u.disabled !== true);
const recipients = [...new Set(enabled.map((u) => u.email!.toLowerCase()))];

const sentLog = `${noticePath}.${host}.sent`;
const alreadySent = new Set(existsSync(sentLog) ? readFileSync(sentLog, "utf8").split("\n") : []);
const notSent = recipients.filter((r) => !alreadySent.has(r));
const pending = notSent.slice(0, limit);

console.log(`SMTP:                      ${host}:${port}`);
console.log(`From:                      ${FROM.name} <${FROM.address}>, replies to ${REPLY_TO}`);
console.log(`Subject:                   ${subject}`);
console.log(`Firebase users:            ${exported.length}`);
console.log(`Skipped, no email:         ${exported.length - withEmail.length}`);
console.log(`Skipped, disabled:         ${withEmail.length - enabled.length}`);
console.log(`Skipped, repeated email:   ${enabled.length - recipients.length}`);
console.log(`Recipients:                ${recipients.length}`);
console.log(`  already sent:            ${recipients.length - notSent.length}`);
console.log(`  to send now:             ${pending.length}, ${Math.ceil(pending.length / RATE / 60)} min at ${RATE} a second`);

if (!values["test-to"] && !values.commit) {
  console.log("Dry run; pass --test-to <address> to send one, --commit to send to all.");
  process.exit(0);
}

const transport = nodemailer.createTransport({
  host,
  port,
  requireTLS: process.env.SMTP_STARTTLS === "true",
  ...(process.env.SMTP_USER && {
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  }),
  pool: true,
  maxConnections: CONNECTIONS,
});
const send = (to: string) =>
  transport.sendMail({ from: FROM, replyTo: REPLY_TO, to, subject, text, html });

if (values["test-to"]) {
  await send(values["test-to"]);
  console.log(`Sent to ${values["test-to"]} only.`);
} else {
  let stopping = false;
  process.once("SIGINT", () => {
    stopping = true;
    console.log("Stopping after the sends in flight.");
  });

  let sent = 0;
  let failed = 0;
  // One send every 1/RATE second, never more than CONNECTIONS in flight, so
  // a stalled server cannot build a queue that later goes out in one burst.
  const inFlight = new Set<Promise<void>>();
  for (const to of pending) {
    if (stopping) break;
    const next = sleep(1000 / RATE);
    while (inFlight.size >= CONNECTIONS) await Promise.race(inFlight);
    const sending = send(to)
      .then(
        () => {
          appendFileSync(sentLog, to + "\n");
          sent++;
          if (sent % 500 === 0) console.log(`  sent ${sent}`);
        },
        (error) => {
          failed++;
          console.log(`  failed: ${to}: ${error.message}`);
        },
      )
      .finally(() => inFlight.delete(sending));
    inFlight.add(sending);
    await next;
  }
  await Promise.all(inFlight);

  console.log(`Sent: ${sent}, failed: ${failed}, left: ${notSent.length - sent}`);
  if (failed > 0) process.exitCode = 1;
}
transport.close();

// The frame of the realm's emails, without its FreeMarker.
function frame(content: string): string {
  const template = readFileSync(
    new URL("../themes/intechstudio/email/html/template.ftl", import.meta.url),
    "utf8",
  );
  const layout = template
    .slice(template.indexOf("<!DOCTYPE"), template.indexOf("</#macro>"))
    .replace("${locale.language}", "en")
    .replace("${(ltr)?then('ltr','rtl')}", "ltr");
  if (!layout.includes("<#nested>") || /\$\{|<#(?!nested>)/.test(layout)) {
    throw new Error("template.ftl has FreeMarker this script does not replace");
  }
  return layout.replace("<#nested>", () => content);
}

// Escaped text; a bare URL becomes a link, a line break stays one.
function toHtml(paragraph: string): string {
  return paragraph
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/https?:\/\/[^\s]*[^\s.,;:!?)"']/g, (url) => `<a href="${url}">${url}</a>`)
    .replace(/\n/g, "<br>\n");
}
