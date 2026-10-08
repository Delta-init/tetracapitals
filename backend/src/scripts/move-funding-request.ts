/**
 * Anwar Nissar's latest funding request onto his anwarnissar55@ record (the user, 2026-10-07): the PENDING bonus
 * Ajna Hamza raised on 7 Oct ($544.96, MT5 922418) sits on STU-2821 (anwarnissar5@) and moves to STU-4022
 * (anwarnissar55@) — its student id, code and name; nothing else on it changes (still PENDING for a broker admin or
 * Super Admin, Delta finance's approval on it). A history line on both students. Everything else stays as it is.
 *
 *   cd backend
 *   bun src/scripts/move-funding-request.ts                         dry run
 *   bun src/scripts/move-funding-request.ts --apply                 does it; an undo file first
 *   bun src/scripts/move-funding-request.ts --undo=<file> [--apply] puts it back
 *
 * Refuses unless exactly that request is there, still PENDING. Uses the API's database (from this folder's .env).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EJSON } from "bson";
import { ObjectId } from "mongodb";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const now = new Date().toISOString();
const BY = "Funding request move";
const FROM = { id: "69b669a0bc67ffb5542fa21c", code: "STU-2821", email: "anwarnissar5@gmail.com" };
const TO = { id: "69fd050dfe93c4352e53cb06", code: "STU-4022", email: "anwarnissar55@gmail.com" };

async function run() {
  console.log(`${host}/${config.mongoDb}`);
  const [from, to]: any[] = await Promise.all([FROM, TO].map((s) => col("students").findOne({ _id: new ObjectId(s.id) })));
  if (!from || String(from.email).trim().toLowerCase() !== FROM.email) return console.log(`Refusing: ${FROM.code} isn't ${FROM.email} any more.`);
  if (!to || String(to.email).trim().toLowerCase() !== TO.email) return console.log(`Refusing: ${TO.code} isn't ${TO.email} any more.`);
  const found = (await col("funding_transactions").find({ student_id: FROM.id, type: "BONUS", status: "PENDING", mt5_login: "922418" }).toArray()) as any[];
  if (found.length !== 1) return console.log(`Refusing: expected one PENDING bonus with MT5 922418 on ${FROM.code}, found ${found.length}.`);
  const tx = found[0];
  const money = `$${Number(tx.amount_usd).toFixed(2)}`;
  console.log(`Move: ${tx.type} ${tx.status} ${money} (${String(tx.requested_at).slice(0, 10)}, MT5 ${tx.mt5_login}, by ${tx.requested_by_name})`);
  console.log(`  from ${FROM.code} ${String(from.full_name).trim()} <${FROM.email}>  →  to ${TO.code} ${String(to.full_name).trim()} <${TO.email}>`);
  if (!apply) return console.log("Dry run — add --apply to do it.");

  const undoFile = join(homedir(), `move-funding-request-undo-${now.replace(/[:.]/g, "-")}.json`);
  writeFileSync(undoFile, EJSON.stringify({ tx }, { relaxed: false }));
  console.log(`Undo file: ${undoFile}`);
  await col("funding_transactions").updateOne({ _id: tx._id, student_id: FROM.id }, {
    $set: { student_id: TO.id, student_code: to.student_code ?? TO.code, student_name: String(to.full_name ?? "").trim(), updated_date: now },
  });
  const text = `Bonus request ${money} (${String(tx.requested_at).slice(0, 10)}, MT5 ${tx.mt5_login}) moved from ${FROM.code} (${FROM.email}) to ${TO.code} (${TO.email})`;
  await col("student_history").insertMany([FROM.id, TO.id].map((student_id) => ({
    student_id, at: now, type: "details_changed", text, by_id: null, by_name: BY, via: "move-funding-request", funding_id: String(tx._id),
  })) as any[]);
  console.log("Done.");
}

async function undo(file: string) {
  const { tx } = EJSON.parse(readFileSync(file, "utf8")) as { tx: any };
  console.log(`Undo on ${host}/${config.mongoDb}: the request back on ${tx.student_code} (${tx.student_name})`);
  if (!apply) return console.log("Dry run — add --apply to do it.");
  await col("funding_transactions").updateOne({ _id: tx._id }, { $set: { student_id: tx.student_id, student_code: tx.student_code, student_name: tx.student_name } });
  await col("student_history").deleteMany({ via: "move-funding-request", funding_id: String(tx._id) });
  console.log("Done.");
}

await connectDb();
try {
  const u = option("undo");
  if (u) await undo(u); else await run();
} finally {
  await closeDb();
}
