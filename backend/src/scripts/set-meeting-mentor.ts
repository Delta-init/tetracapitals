import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EJSON } from "bson";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";

/**
 * Who held the meeting, put on funding requests that don't say (the user, 2026-11-10: "backfill the meeting done by …
 * its commission go also"). A course payment names the mentor who met the student ("Meeting Conducted By"); it has been
 * required on the form since 2026-11-09, so earlier requests name nobody or the wrong person, and their Junior / Senior
 * 2% went to no one. This sets the person on each request named — then backfill-meeting-mentor.ts adds their Meeting
 * mentor credit (a Junior, Senior or Sub-junior Mentor; a Chief's own meeting pays nothing on top of their Chief %).
 *
 * Each change is given as <request id>=<staff email> (the request's _id, as on Funding Requests / MT5 Approvals). The
 * email must be one staff member whose role is a mentor's — whom the form offers. Any line refused: nothing is written.
 * The request keeps what it named before (meeting_mentor_backfill.from), and the undo file has it too.
 *
 *   cd backend
 *   bun src/scripts/set-meeting-mentor.ts --set=<id>=<email> --set=<id>=<email> …          dry run: what would change
 *   bun src/scripts/set-meeting-mentor.ts --set=… --apply                                   does it; an undo file in your home folder first
 *   bun src/scripts/set-meeting-mentor.ts --undo=<file> --apply                             puts every one back
 *
 * Then, for the commission:  bun src/scripts/backfill-meeting-mentor.ts --month=<YYYY-MM> [--apply]
 */

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const sets = process.argv.filter((a) => a.startsWith("--set=")).map((a) => a.slice("--set=".length));
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The Dubai month a request's commission is dated in (requested_at), for the backfill's --month. */
const monthOf = (iso: unknown) => (iso ? new Date(new Date(String(iso)).getTime() + 4 * 3600_000).toISOString().slice(0, 7) : "");
const FIELDS = ["meeting_mentor_id", "meeting_mentor_name", "meeting_mentor_none", "meeting_mentor_backfill"] as const;

await connectDb();
console.log(`Database "${config.mongoDb}" on ${host}${apply ? "" : "  — dry run, nothing is written"}\n`);
let failed = false;
try {
  const undo = option("undo");
  if (undo) {
    const u = EJSON.parse(readFileSync(undo, "utf8")) as { run: string; before: Record<string, any>[]; credits?: Record<string, any>[] };
    console.log(`${u.before.length} request(s) ${apply ? "put back" : "would be put back"} as they were${u.credits?.length ? `, and ${u.credits.length} Meeting mentor credit(s)` : ""}${apply ? "." : " — add --apply"}`);
    if (apply) {
      // The Meeting mentor credits as they were (moved or removed by that run).
      for (const c of u.credits ?? []) await col("commission_credits").replaceOne({ _id: c._id }, c, { upsert: true });
      for (const b of u.before) {
        const set: Record<string, unknown> = {}, unset: Record<string, ""> = {};
        for (const f of FIELDS) (b[f] === undefined ? (unset[f] = "") : (set[f] = b[f]));
        await col("funding_transactions").updateOne({ _id: b._id, "meeting_mentor_backfill.run": u.run }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
      }
      console.log(`Now run backfill-meeting-mentor.ts --undo=<its file> --apply too, if it was run after this.`);
    }
  } else {
    if (!sets.length) throw new Error("Nothing to do — give --set=<request id>=<staff email> (as many as needed)");
    const refused: string[] = [], changes: { tx: any; user: any; credits: any[]; paidRole: boolean }[] = [];
    let unchanged = 0;
    const seen = new Set<string>();
    for (const s of sets) {
      const eq = s.indexOf("=");
      const id = eq > 0 ? s.slice(0, eq).trim() : "", email = eq > 0 ? s.slice(eq + 1).trim().toLowerCase() : "";
      const oid = toObjectId(id);
      if (!oid || !email) { refused.push(`${s}: give it as <request id>=<staff email>`); continue; }
      if (seen.has(id)) { refused.push(`${id}: named twice`); continue; }
      seen.add(id);
      const tx: any = await col("funding_transactions").findOne({ _id: oid });
      if (!tx) { refused.push(`${id}: no such funding request`); continue; }
      const users = (await col("users").find({ email: { $regex: `^\\s*${escRe(email)}\\s*$`, $options: "i" } }, { projection: { full_name: 1, email: 1, app_role: 1, status: 1 } }).toArray()) as any[];
      if (users.length !== 1) { refused.push(`${id}: ${users.length ? "several staff have" : "no staff member has"} the email ${email}`); continue; }
      const user = users[0];
      // Whom the form offers as "Meeting Conducted By": a mentor — a Chief, Senior, Junior or Sub-junior.
      if (!/mentor/.test(String(user.app_role ?? ""))) { refused.push(`${id}: ${user.full_name} is ${user.app_role}, not a mentor`); continue; }
      const who = `${tx.student_name ?? "?"} · ${tx.type} ${tx.status} · ${tx.txn_id || tx.transaction_id || id} · ${String(tx.requested_at ?? "").slice(0, 10)}`;
      const now = tx.meeting_mentor_none === true ? "None" : tx.meeting_mentor_name || "(not set)";
      if (String(tx.meeting_mentor_id ?? "") === String(user._id) && tx.meeting_mentor_none !== true) {
        console.log(`   ${who}\n      already ${user.full_name} — unchanged`);
        unchanged++;
        continue;
      }
      const paidRole = /^(junior|senior|subjunior)_mentor$/.test(String(user.app_role));
      const paid = paidRole ? "" : "  (a Chief: no Meeting mentor commission)";
      console.log(`   ${who}\n      ${now} → ${user.full_name} · ${user.app_role}${user.status === "inactive" ? " · switched off" : ""}${paid}`);
      // Already credited (approved before): its Meeting mentor credit follows the new person (2026-11-18) — moved to
      // them, or taken off for a Chief — only while not paid out; one released or paid refuses the whole run.
      const credits = (await col("commission_credits").find({ transaction_id: { $in: [String(tx._id), tx._id] }, position: "Meeting mentor" }).toArray()) as any[];
      const outPaid = credits.filter((c) => !["accrued", "pooled"].includes(String(c.status)));
      if (outPaid.length) { refused.push(`${id}: its Meeting mentor credit to ${outPaid[0].recipient_name} is already ${outPaid[0].status} — not moved`); continue; }
      for (const c of credits) console.log(`      credit: Meeting mentor ${c.percentage}% USD ${Number(c.commission_usd).toFixed(2)} (AED ${(Number(c.commission_usd) * 3.67).toFixed(2)}) ${c.recipient_name} → ${paidRole ? user.full_name : "removed (a Chief gets none)"}`);
      changes.push({ tx, user, credits, paidRole });
    }
    if (refused.length) {
      console.log(`\nRefused — nothing is written until every line is right:`);
      for (const r of refused) console.log(`   ✗ ${r}`);
      failed = true;
    } else {
      console.log(`\n${changes.length} request(s) to change, ${unchanged} already right.`);
      if (apply && changes.length) {
        const at = new Date().toISOString();
        const run = `set-meeting-mentor-${at}`;
        const file = join(homedir(), `set-meeting-mentor-undo-${at.replace(/[:.]/g, "-")}.json`);
        const before = changes.map(({ tx }) => Object.fromEntries([["_id", tx._id], ...FIELDS.map((f) => [f, tx[f]])]));
        const creditsBefore = changes.flatMap((c) => c.credits);
        writeFileSync(file, EJSON.stringify({ database: config.mongoDb, host, run, before, credits: creditsBefore }));
        const back = EJSON.parse(readFileSync(file, "utf8")) as any;
        if (back.before?.length !== before.length || back.credits?.length !== creditsBefore.length) throw new Error(`The undo file ${file} didn't read back whole — nothing changed`);
        for (const { tx, user, credits, paidRole } of changes) {
          for (const c of credits) {
            if (paidRole) await col("commission_credits").updateOne({ _id: c._id, status: { $in: ["accrued", "pooled"] } }, { $set: { recipient_id: String(user._id), recipient_name: user.full_name ?? "", updated_date: at, moved_by_run: run, moved_from: { id: c.recipient_id, name: c.recipient_name } } });
            else await col("commission_credits").deleteOne({ _id: c._id, status: { $in: ["accrued", "pooled"] } });
          }
          await col("funding_transactions").updateOne({ _id: tx._id }, { $set: {
            meeting_mentor_id: String(user._id), meeting_mentor_name: user.full_name ?? "", meeting_mentor_none: false,
            meeting_mentor_backfill: { at, run, from: { id: tx.meeting_mentor_id ?? null, name: tx.meeting_mentor_name ?? null, none: tx.meeting_mentor_none === true } },
          } });
        }
        console.log(`Done.\nUndo file: ${file}\n  bun src/scripts/set-meeting-mentor.ts --undo=${file} --apply`);
      } else if (changes.length) console.log("Nothing was written. Run again with --apply to do it.");
      // Requests already credited had their credit moved above; the backfill is for the rest.
      const months = [...new Set(changes.filter((c) => !c.credits.length).map(({ tx }) => monthOf(tx.requested_at)).filter(Boolean))].sort();
      if (months.length) {
        console.log(`\nThen the commission — the Meeting mentor credits (dry run first, then --apply):`);
        for (const m of months) console.log(`  bun src/scripts/backfill-meeting-mentor.ts --month=${m}`);
      }
    }
  }
} finally {
  await closeDb();
}
process.exit(failed ? 1 : 0);
