import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EJSON } from "bson";
import { connectDb, closeDb, col } from "../db";
import { config } from "../config";
import { categorySubFor, OLD_CATEGORIES } from "../students/followups";

/**
 * Follow-ups from before the CSE client stages and categories (the user, 2026-11-08), moved to the new ones:
 *   - stage: Qualified → Interested, Session with CM → Mentor Call Requested, Objection Stage → Concern – In Progress,
 *     Converted → Payment Completed, Lost → Not Interested. New (not called yet) and Contacted stay as they are — the
 *     CS picks a client stage on the next call;
 *   - category: New Data → Calls for Assigned Leads from Campaigns, Class Completion → Feedback Call (Class
 *     Completion Feedback), Onboarding → Onboarding Call; Course Pitch stays, with its course as the sub-category
 *     when it is DWT, MSNR, DSLP, DSLP PRO, DQMP or DGMP.
 * The log of each follow-up (student_followup_events) keeps the stages as they were.
 *
 *   cd backend
 *   bun src/scripts/backfill-client-stages.ts                        dry run: what would change
 *   bun src/scripts/backfill-client-stages.ts --apply                does it; an undo file in your home folder first
 *   bun src/scripts/backfill-client-stages.ts --undo=<file> --apply  puts every one back
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Running it again changes nothing.
 */

const STAGE_MAP: Record<string, string> = {
  Qualified: "Interested",
  "Session with CM": "Mentor Call Requested",
  "Objection Stage": "Concern – In Progress",
  Converted: "Payment Completed",
  Lost: "Not Interested",
};

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}\n`);
try {
  const undo = option("undo");
  if (undo) {
    const u = EJSON.parse(readFileSync(undo, "utf8")) as any;
    console.log(`${u.followups.length} follow-up(s) ${apply ? "put back" : "would be put back — add --apply"}.`);
    if (apply) {
      for (const b of u.followups) {
        const set: Record<string, unknown> = {}, unset: Record<string, ""> = {};
        for (const k of ["stage", "category", "category_sub"]) {
          if (k in b.before) set[k] = b.before[k];
          else unset[k] = "";
        }
        await col("student_followups").updateOne({ _id: b.id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
      }
    }
  } else {
    const all = (await col("student_followups").find({}, { projection: { stage: 1, category: 1, category_sub: 1, target_outcome: 1 } }).toArray()) as any[];
    const changes: { id: any; before: Record<string, unknown>; set: Record<string, string> }[] = [];
    const tally = new Map<string, number>();
    const count = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
    for (const f of all) {
      const set: Record<string, string> = {};
      const stage = STAGE_MAP[String(f.stage ?? "")];
      if (stage) { set.stage = stage; count(`stage   ${f.stage} → ${stage}`); }
      const old = OLD_CATEGORIES[String(f.category ?? "")];
      const category = old ? old.category : String(f.category ?? "");
      if (old) { set.category = old.category; count(`category ${f.category} → ${old.category}`); }
      if (category && !f.category_sub) {
        const sub = old?.sub || categorySubFor(category, { outcome: String(f.target_outcome ?? "") });
        if (sub) { set.category_sub = sub; count(`sub      ${category} → ${sub}`); }
      }
      if (!Object.keys(set).length) continue;
      const before: Record<string, unknown> = {};
      for (const k of ["stage", "category", "category_sub"]) if (k in f) before[k] = f[k];
      changes.push({ id: f._id, before, set });
    }
    for (const [k, n] of [...tally].sort()) console.log(`  ${String(n).padStart(5)}  ${k}`);
    console.log(`\n${changes.length} of ${all.length} follow-up(s) to change.`);
    if (changes.length && apply) {
      const file = join(homedir(), `backfill-client-stages-undo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      writeFileSync(file, EJSON.stringify({ database: config.mongoDb, host, followups: changes.map((c) => ({ id: c.id, before: c.before })) }));
      for (let i = 0; i < changes.length; i += 1000) {
        await col("student_followups").bulkWrite(changes.slice(i, i + 1000).map((c) => ({ updateOne: { filter: { _id: c.id }, update: { $set: c.set } } })), { ordered: false });
      }
      console.log(`\nDone.\nUndo file: ${file}\n  bun src/scripts/backfill-client-stages.ts --undo=${file} --apply`);
    } else if (changes.length) console.log("\nNothing was written. Run again with --apply to do it.");
  }
} finally {
  await closeDb();
}
