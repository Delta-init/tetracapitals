/**
 * Two people on one 3CX extension (the user, 2026-11-07): arya.mol's calls on 404 were all given to ananya, who had 404
 * from 3CX before her; haritha.kg (switched off) and Ayna both had 412. For every extension more than one person has:
 *   - its owner = the active person 3CX names on most of its calls ("ARYA MOL (404)"), else an active CS, else an
 *     active one (a switched-off person never keeps it);
 *   - every call on it goes to the person 3CX names on that call, else the owner (the extension's voicemail too);
 *   - the extension is taken off everyone else (Personnel can give them their own).
 * students/calls.ts now keeps this from happening again.
 *
 *   cd backend
 *   bun src/scripts/fix-shared-extensions.ts                         shows what it would do
 *   bun src/scripts/fix-shared-extensions.ts --apply                 does it; saves an undo file in your home folder
 *   bun src/scripts/fix-shared-extensions.ts --undo=<file> [--apply] puts back what --apply did
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";
import { CALLS, extensionUser, namesUser, usersByExtension } from "../students/calls";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const MISSING = { $missing: true };

await connectDb();
try {
  console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}\n`);
  const undo = option("undo");
  if (undo) {
    const saved = await Bun.file(undo).json();
    for (const c of saved.changes) {
      const $set: any = {}, $unset: any = {};
      for (const [k, v] of Object.entries(c.before)) (v && typeof v === "object" && (v as any).$missing ? ($unset[k] = "") : ($set[k] = v));
      if (apply) await col(c.coll).updateOne({ _id: toObjectId(c.id) as any }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) });
    }
    console.log(`${saved.changes.length} change(s) ${apply ? "put back" : "would be put back — add --apply"}.`);
  } else {
    const users = await usersByExtension();
    const log = { database: config.mongoDb, host, applied_at: now, changes: [] as any[] };
    const change = async (coll: string, doc: any, data: Record<string, unknown>) => {
      log.changes.push({ coll, id: String(doc._id), before: Object.fromEntries(Object.keys(data).map((k) => [k, k in doc ? doc[k] : MISSING])) });
      if (apply) await col(coll).updateOne({ _id: doc._id }, { $set: data });
    };
    let shared = 0;
    for (const [ext, on] of users) {
      if (on.length < 2) continue;
      shared++;
      const calls = (await col(CALLS).find({ extension: ext }, { projection: { agent_name: 1, user_id: 1, user_name: 1, started_at: 1 } }).toArray()) as any[];
      // A switched-off person never keeps it (their own calls stay theirs, by name).
      const live = on.filter((u) => u.status !== "inactive");
      const named = (live.length ? live : on).map((u) => ({ u, n: calls.filter((c) => namesUser(c.agent_name, u)).length }));
      const best = named.sort((a, b) => b.n - a.n)[0];
      const owner = best.n > 0 ? best.u : extensionUser(users, ext);
      console.log(`Extension ${ext}: ${on.map((u) => `${u.full_name} (${u.app_role}${u.status === "inactive" ? ", off" : ""})`).join(" · ")}`);
      console.log(`  3CX's names on its ${calls.length} call(s): ${[...new Set(calls.map((c) => c.agent_name))].join(", ") || "—"}`);
      console.log(`  keeps it: ${owner.full_name}`);
      const moved = new Map<string, number>();
      for (const c of calls) {
        const to = on.find((u) => namesUser(c.agent_name, u)) ?? owner;
        if (c.user_id === String(to._id)) continue;
        moved.set(`${c.user_name || "nobody"} → ${to.full_name}`, (moved.get(`${c.user_name || "nobody"} → ${to.full_name}`) ?? 0) + 1);
        await change(CALLS, c, { user_id: String(to._id), user_name: String(to.full_name ?? "") });
      }
      for (const [k, n] of moved) console.log(`  calls ${k}: ${n}`);
      for (const u of on) {
        if (u === owner) continue;
        const doc: any = await col("users").findOne({ _id: u._id }, { projection: { extension: 1, extension_source: 1, extension_cleared_from: 1, updated_date: 1 } });
        console.log(`  ${u.full_name}: extension ${ext} taken off`);
        await change("users", doc, { extension: "", extension_source: "3cx", extension_cleared_from: ext, updated_date: now });
      }
      console.log();
    }
    if (!shared) console.log("No extension is shared — nothing to do.");
    else if (apply) {
      const file = join(homedir(), `shared-extensions-undo-${now.replace(/[:.]/g, "-")}.json`);
      await Bun.write(file, JSON.stringify(log));
      console.log(`Done: ${log.changes.length} change(s).\nUndo file: ${file}\n  bun src/scripts/fix-shared-extensions.ts --undo=${file} --apply`);
    } else console.log("Nothing was written. Run again with --apply to do it.");
  }
} finally {
  await closeDb();
}
