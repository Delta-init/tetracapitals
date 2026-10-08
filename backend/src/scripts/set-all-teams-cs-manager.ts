/**
 * A CS Manager over every team (the user, 2026-10-07): Doney — a Super Admin until now — becomes CS Manager, and every
 * CS reports to him as well as to their own chief (lib/scope isAllTeamsCsManager): he sees every CS's students,
 * follow-ups and chats, and is told of their overdue follow-ups, students not onboarded and new students. Nobody
 * else's Up Head or role changes; his own Up Head stays as it is.
 *
 *   cd backend
 *   bun src/scripts/set-all-teams-cs-manager.ts [--email=doney@deltainstitutions.com]           dry run
 *   bun src/scripts/set-all-teams-cs-manager.ts [--email=…] --apply                              does it; an undo file first
 *   bun src/scripts/set-all-teams-cs-manager.ts --undo=<undo file> [--apply]                     puts his role back
 *
 * Uses the API's database (MONGO_URI / MONGO_DB, from this folder's .env). Running it again changes nothing.
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
const FIELDS = { app_role: 1, all_teams_cs_manager: 1, full_name: 1, email: 1, status: 1, up_head_id: 1 };

async function run(email: string) {
  const user: any = await col("users").findOne({ email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }, { projection: FIELDS });
  console.log(`${host}/${config.mongoDb}`);
  if (!user) return console.log(`No account with the email ${email} — nothing to do.`);
  const csCount = await col("users").countDocuments({ app_role: "cs", status: { $ne: "inactive" } });
  console.log(`${user.full_name || user.email} <${user.email}>: role ${user.app_role}${user.all_teams_cs_manager ? " (over every team)" : ""}${user.status === "inactive" ? " — SWITCHED OFF" : ""}`);
  if (user.app_role === "cs_manager" && user.all_teams_cs_manager === true) return console.log("Already CS Manager over every team — nothing to do.");
  console.log(`Will be: CS Manager over every team — ${csCount} active CS report to them as well as to their own chief.`);
  if (user.app_role === "super_admin") console.log("Note: they stop being a Super Admin (the undo puts it back).");
  if (!apply) return console.log("Dry run — add --apply to do it.");
  const undoFile = join(homedir(), `all-teams-cs-manager-undo-${now.replace(/[:.]/g, "-")}.json`);
  writeFileSync(undoFile, EJSON.stringify({ before: user }, { relaxed: false }));
  console.log(`Undo file: ${undoFile}`);
  await col("users").updateOne({ _id: user._id }, { $set: { app_role: "cs_manager", all_teams_cs_manager: true, updated_date: now } });
  console.log("Done. Their next page load shows the CS Manager's pages; a sign-in already open picks it up at once.");
}

async function undo(file: string) {
  const { before } = EJSON.parse(readFileSync(file, "utf8")) as { before: any };
  console.log(`Undo on ${host}/${config.mongoDb}: ${before.email} back to role ${before.app_role}${before.all_teams_cs_manager ? " (over every team)" : ""}`);
  if (!apply) return console.log("Dry run — add --apply to do it.");
  await col("users").updateOne({ _id: before._id }, {
    $set: { app_role: before.app_role, updated_date: now },
    ...(before.all_teams_cs_manager === undefined ? { $unset: { all_teams_cs_manager: "" } } : {}),
  });
  if (before.all_teams_cs_manager !== undefined) await col("users").updateOne({ _id: before._id }, { $set: { all_teams_cs_manager: before.all_teams_cs_manager } });
  console.log("Done.");
}

await connectDb();
try {
  const undoFile = option("undo");
  if (undoFile) await undo(undoFile);
  else await run(option("email") || "doney@deltainstitutions.com");
} finally {
  await closeDb();
}
