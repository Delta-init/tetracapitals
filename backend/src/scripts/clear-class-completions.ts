import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";

/**
 * Clears the Class Completions "Call needed" list (the user, 2026-11-24: "clear the class completion … current, clear
 * that for now"). Every completion already told to its CS and not called yet is taken back (withdrawn_at, as a
 * cancelled seat is) — not deleted — so the page and the sidebar count start from 0. Called ones stay; classes that
 * end from now on are told and listed as before.
 *
 *   cd backend
 *   bun src/scripts/clear-class-completions.ts                     dry run: how many, per CS
 *   bun src/scripts/clear-class-completions.ts --apply             clears them; an undo file first
 *   bun src/scripts/clear-class-completions.ts --undo=<file> [--apply]   puts back the ones nobody has called since
 */

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const REASON = "cleared (list reset)";
const OPEN = { notified_at: { $exists: true }, called_at: { $exists: false }, withdrawn_at: { $exists: false } };

async function clear() {
  const docs = (await col("class_completions").find(OPEN as any, { projection: { _id: 1, student_id: 1, ended_at: 1, told: 1 } }).toArray()) as any[];
  const per = new Map<string, number>();
  for (const d of docs) { const n = (d.told ?? []).map((t: any) => t.name).join(", ") || "nobody"; per.set(n, (per.get(n) ?? 0) + 1); }
  console.log(`\n${docs.length} class completion(s) waiting for a call${docs.length ? ` — ended ${String(docs.map((d) => d.ended_at).sort()[0]).slice(0, 10)} to ${String(docs.map((d) => d.ended_at).sort().at(-1)).slice(0, 10)}` : ""}\n`);
  for (const [n, c] of [...per].sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(4)}  ${n}`);
  if (!apply) { if (docs.length) console.log("\nNothing was written. Run again with --apply to clear them."); return; }
  if (!docs.length) return;
  const undoPath = join(homedir(), `clear-class-completions-undo-${now.replace(/[:.]/g, "-")}.json`);
  await Bun.write(undoPath, JSON.stringify({ database: config.mongoDb, host, applied_at: now, ids: docs.map((d) => d._id) }, null, 1));
  const r = await col("class_completions").updateMany({ _id: { $in: docs.map((d) => d._id) }, ...OPEN } as any, { $set: { withdrawn_at: now, withdrawn_reason: REASON } });
  console.log(`\nDone: ${r.modifiedCount} cleared.\nUndo file: ${undoPath}\n  bun src/scripts/clear-class-completions.ts --undo=${undoPath}          (shows what it would put back)`);
}

async function undo(file: string) {
  const saved = JSON.parse(await Bun.file(file).text());
  if (saved.database !== config.mongoDb || saved.host !== host) throw new Error(`That undo file is for "${saved.database}" on ${saved.host}, not this database.`);
  const filter = { _id: { $in: saved.ids }, withdrawn_at: saved.applied_at, withdrawn_reason: REASON, called_at: { $exists: false } };
  const n = await col("class_completions").countDocuments(filter as any);
  if (apply) await col("class_completions").updateMany(filter as any, { $unset: { withdrawn_at: "", withdrawn_reason: "" } });
  console.log(`\nUndo of the clear on ${saved.applied_at}: ${n} of ${saved.ids.length} ${apply ? "put back" : "would be put back — add --apply"}`);
}

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}`);
try {
  const undoFile = option("undo");
  if (undoFile) await undo(undoFile);
  else await clear();
} catch (err) {
  console.log(`\nStopped: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
