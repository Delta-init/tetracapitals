import { col } from "../db";
import { callLms, lmsConfigured } from "../lib/lms";

/* ────────────────────────────────────────────────────────────────────────────
   Each student's CS and CS team, told to the Delta LMS — whose admin shows them
   beside the student wherever it shows one: the Students table, Bookings, the
   student's details, and every other list (the user, 2026-10-07: "show the cs
   name and team name also show in lms student table and bookings and student
   details … every student showing area").

   Every EVERY_MS, the students with an LMS account whose CS, team, student
   code or open-pool state is not what the LMS was last told (lms_cs_sent) —
   every one of them the first time — go to the LMS's POST /service/student-cs,
   BATCH at a time (LMS_API_URL / LMS_SERVICE_SECRET, as the hourly enrolment
   check). What a batch's answer took is remembered as told; a batch the LMS
   refused, and a student it did not find, are tried again next time. The LMS
   writes only what changed.

   The CS is the primary mentor — "" while the student waits in Delta Open
   Students (open) — and the team their team, as finance's lookup reads them
   (finance/studentLookup.ts).

   LMS_CS_SYNC=off keeps a server out of it.
──────────────────────────────────────────────────────────────────────────── */

const BATCH = 500;                      // the LMS's limit per call
const EVERY_MS = 10 * 60_000;
const LEASE_MS = 9 * 60_000;            // one run at a time, however many API processes
const SETTINGS_ID = "lms_cs";

/** What the LMS is told about one student, and keeps as told. */
interface CsTold {
  cs: string;
  team: string;
  code: string;
  open: boolean;
}

export interface LmsCsRun {
  at: string;
  by: string;
  ok: boolean;
  error?: string;
  /** Students with an LMS account. */
  students: number;
  /** Sent now: new, or changed since last told. */
  sent: number;
  /** Of those, written by the LMS (the rest it already had as they are). */
  updated: number;
  /** Not a student in the LMS by that email or id — asked again next time. */
  not_found: number;
}

/** Hold the run for LEASE_MS — true for exactly one caller. */
async function takeLease(): Promise<boolean> {
  const now = Date.now();
  try {
    const res = await col("app_settings").updateOne(
      { _id: SETTINGS_ID, $or: [{ running_until: { $lt: new Date(now).toISOString() } }, { running_until: { $exists: false } }, { running_until: null }] } as any,
      { $set: { running_until: new Date(now + LEASE_MS).toISOString() } },
      { upsert: true },
    );
    return res.modifiedCount === 1 || res.upsertedCount === 1;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;   // somebody else holds it
    throw err;
  }
}

/** Who looks after them now, as the LMS is to be told. */
export function csOf(s: { primary_mentor_name?: unknown; team_name?: unknown; student_code?: unknown; assignment_status?: unknown }): CsTold {
  const open = s.assignment_status === "open_pool";
  return {
    cs: open ? "" : String(s.primary_mentor_name ?? "").trim(),
    team: String(s.team_name ?? "").trim(),
    code: String(s.student_code ?? "").trim(),
    open,
  };
}

const same = (a: CsTold | undefined | null, b: CsTold) =>
  !!a && a.cs === b.cs && a.team === b.team && a.code === b.code && !!a.open === b.open;

/** Tell the LMS whoever's CS or team changed since it was last told. */
export async function syncLmsCs(by = "Schedule"): Promise<LmsCsRun> {
  const at = new Date().toISOString();
  const run: LmsCsRun = { at, by, ok: false, students: 0, sent: 0, updated: 0, not_found: 0 };
  if (!lmsConfigured()) {
    run.error = "The LMS link is not set up on this server (LMS_API_URL, LMS_SERVICE_SECRET)";
    return run;
  }
  if (!(await takeLease())) {
    run.error = "A run is already going";
    return run;
  }
  try {
    const students = (await col("students")
      .find(
        { $or: [{ "lms_account.exists": true }, { lms_user_id: { $exists: true, $nin: [null, ""] } }] },
        { projection: { email: 1, lms_user_id: 1, student_code: 1, primary_mentor_name: 1, team_name: 1, assignment_status: 1, lms_cs_sent: 1 } },
      )
      .toArray()) as any[];
    run.students = students.length;

    const due = students
      .map((s) => ({ s, now: csOf(s), email: String(s.email ?? "").trim().toLowerCase(), lmsUserId: /^[0-9a-f]{24}$/i.test(String(s.lms_user_id ?? "")) ? String(s.lms_user_id) : "" }))
      .filter((d) => (d.email.includes("@") || d.lmsUserId) && !same(d.s.lms_cs_sent, d.now));

    for (let i = 0; i < due.length; i += BATCH) {
      const batch = due.slice(i, i + BATCH);
      const answer = await callLms<{ updated?: number; unchanged?: number; notFound?: string[] }>("/student-cs", {
        method: "POST",
        body: { students: batch.map((d) => ({ email: d.email, ...(d.lmsUserId ? { lmsUserId: d.lmsUserId } : {}), ...d.now })) },
        verb: "take the students' CS",
      });
      run.sent += batch.length;
      run.updated += Number(answer?.updated) || 0;
      const missing = new Set((Array.isArray(answer?.notFound) ? answer.notFound : []).map((e) => String(e).toLowerCase()));
      run.not_found += missing.size;
      // Told: whatever it found. One it did not find is asked about again next time.
      const told = batch.filter((d) => !missing.has(d.email) && !missing.has(d.lmsUserId));
      if (told.length) {
        await col("students").bulkWrite(
          told.map((d) => ({ updateOne: { filter: { _id: d.s._id }, update: { $set: { lms_cs_sent: { ...d.now, at } } } } })),
          { ordered: false },
        );
      }
    }
    run.ok = true;
    await col("app_settings").updateOne({ _id: SETTINGS_ID } as any, { $set: { last_run: run, last_ok_run: run, running_until: null } }, { upsert: true });
    return run;
  } catch (err) {
    run.error = err instanceof Error ? err.message : String(err);
    await col("app_settings").updateOne({ _id: SETTINGS_ID } as any, { $set: { last_run: run, running_until: null } }, { upsert: true });
    return run;
  }
}

export const lmsCsOn = () => lmsConfigured() && !/^(off|false|0|no)$/i.test(process.env.LMS_CS_SYNC ?? "");

/** Every 10 minutes (the first a few minutes after start). LMS_CS_SYNC=off keeps this server out of it. */
export function startLmsCsWorker(): void {
  if (!lmsCsOn()) {
    console.log(`[lms cs] off on this server (${lmsConfigured() ? "LMS_CS_SYNC=off" : "no LMS link: LMS_API_URL / LMS_SERVICE_SECRET"})`);
    return;
  }
  const tick = async () => {
    const r = await syncLmsCs("Schedule").catch((err) => ({ ok: false, error: String(err) }) as LmsCsRun);
    if (r.ok) { if (r.sent) console.log(`[lms cs] told the LMS ${r.sent} students' CS (${r.updated} changed there${r.not_found ? `, ${r.not_found} not found` : ""})`); }
    else if (r.error !== "A run is already going") console.error(`[lms cs] not run: ${r.error}`);
  };
  setTimeout(() => void tick(), 4 * 60_000);
  setInterval(() => void tick(), EVERY_MS);
}
