/**
 * Change one portal account's email (the user, 2026-10-22: Shahba's photo was missing on the CS TV board — her HRMS
 * photo is found by her real email, shahba@deltainstitutions.com). The email is also what she signs in with from then on.
 *
 *   cd backend
 *   bun src/scripts/set-user-email.ts --name=shahba --email=shahba@deltainstitutions.com            dry run
 *   bun src/scripts/set-user-email.ts --name=shahba --email=shahba@deltainstitutions.com --apply    does it; an undo file first
 *   bun src/scripts/set-user-email.ts --undo=<undo file> [--apply]                                  puts the old email back
 *
 * --name matches the full name or the current email (any part, any case); exactly one account must match. Stops if
 * another account already has the new email. Uses the API's database (MONGO_URI / MONGO_DB, from this folder's .env).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EJSON } from "bson";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const now = new Date().toISOString();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FIELDS = { full_name: 1, email: 1, app_role: 1, status: 1 };

async function setEmail(match: any, email: string) {
  const users = (await col("users").find(match, { projection: FIELDS }).toArray()) as any[];
  if (users.length !== 1) {
    console.log(users.length ? `${users.length} accounts match — be more exact:` : "No account matches.");
    for (const u of users) console.log(`  ${u.full_name} <${u.email}> ${u.app_role}${u.status === "inactive" ? " (off)" : ""}`);
    return;
  }
  const user = users[0];
  console.log(`${user.full_name} <${user.email}> ${user.app_role}${user.status === "inactive" ? " (off)" : ""}`);
  if (String(user.email).toLowerCase() === email) return console.log("Already that email — nothing to do.");
  const taken: any = await col("users").findOne({ _id: { $ne: user._id }, email: { $regex: `^${esc(email)}$`, $options: "i" } }, { projection: FIELDS });
  if (taken) return console.log(`Stopped: ${taken.full_name} <${taken.email}> already has ${email}.`);
  console.log(`Will be: <${email}>`);
  if (!apply) return console.log("Dry run — add --apply to do it.");
  const undoFile = join(homedir(), `user-email-undo-${now.replace(/[:.]/g, "-")}.json`);
  writeFileSync(undoFile, EJSON.stringify({ before: user }, { relaxed: false }));
  console.log(`Undo file: ${undoFile}`);
  await col("users").updateOne({ _id: user._id }, { $set: { email, updated_date: now } });
  console.log("Done — the CS TV picks up the photo within a minute.");
}

await connectDb();
console.log(`${host}/${config.mongoDb}`);
try {
  const undo = option("undo");
  if (undo) {
    const { before } = EJSON.parse(readFileSync(undo, "utf8")) as any;
    await setEmail({ _id: before._id }, String(before.email).toLowerCase());
  } else {
    const name = option("name")?.trim(), email = option("email")?.trim().toLowerCase();
    if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) console.log("Give --name=<part of the name or email> and --email=<new email>.");
    else await setEmail({ $or: [{ full_name: { $regex: esc(name), $options: "i" } }, { email: { $regex: esc(name), $options: "i" } }] }, email);
  }
} finally {
  await closeDb();
}
