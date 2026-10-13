import { col } from "../db";
import { callLms, lmsConfigured } from "../lib/lms";
import { recordHistory, type HistoryEntry } from "./history";

/* ────────────────────────────────────────────────────────────────────────────
   Enrolled = has a Delta LMS account. Every hour each student's email is
   looked up in the LMS (its service API, POST /service/accounts, 500 at a
   time — the Mentor Calendar's link, LMS_API_URL / LMS_SERVICE_SECRET), and:

     an account (any academy, active or not)  → Enrolled  — Old ones too
     no account                                → Not enrolled — Old stays Old

   The switch can still be flipped by hand. A hand-set enrolment that
   disagrees with the LMS stays (enrolment_manual) until the LMS agrees with
   it; then the LMS decides again. Each change goes in the student's history,
   by "Delta LMS".

   The same run also brings each student's LMS classes — how many attended,
   missed, upcoming… (POST /service/class-attendance) — kept on the student as
   lms_classes for the Students table; the student page asks for the classes
   themselves (functions/lmsClasses.ts). An LMS that doesn't answer that yet
   leaves the counts as they were and the enrolment check still runs.

   And the LMS courses each student is on (POST /service/enrolments) — the
   course, its programme, their progress, whether they finished or dropped it,
   how much the fee has opened — kept as lms_courses, shown under the Enrolled
   switch in the Students table and on the student page; the student page's
   Courses card asks for them fresh (functions/lmsCourses.ts). The same rule:
   an LMS that doesn't answer leaves them as they were.

   Safe by design: all of the LMS's answers are read before anything changes,
   so an LMS that is down or half-answers changes nobody; and a run that finds
   far fewer accounts than the last one stops and says so (the wrong LMS, a
   wrong key) instead of un-enrolling everybody.
──────────────────────────────────────────────────────────────────────────── */

const BATCH = 500;                      // the LMS's limit per call
const EVERY_MS = 60 * 60_000;
const LEASE_MS = 15 * 60_000;           // one run at a time, however many API processes
const SETTINGS_ID = "lms_enrolment";
const BY = "Delta LMS";

export interface LmsEnrolmentRun {
  at: string;
  by: string;
  ok: boolean;
  error?: string;
  students: number;
  with_account: number;
  enrolled: number;              // set to Enrolled now
  not_enrolled: number;          // set to Not enrolled now
  kept_by_hand: number;          // hand-set, disagreeing with the LMS — left
  back_to_lms: number;           // hand-set, now agreeing — the LMS decides again
  classes?: { ok: boolean; with_classes?: number; error?: string };
  courses?: { ok: boolean; with_courses?: number; error?: string };
}

/** One LMS course a student is on, as kept on them for the Students table. */
export interface LmsCourseSummary {
  course_id: string;
  title: string;
  program: string;
  academy: string;
  status: string;      // active, completed or dropped
  progress: number;    // percent
  access: string;      // paid, partial, unpaid — "" when no fee gates it
}

/** The fields a student made from an LMS account starts with (intake): Enrolled. */
export function lmsEnrolledFields(now = new Date().toISOString()) {
  return {
    enrolment_status: "closed",
    lms_account: { exists: true, since: now },
    enrolment_updated_at: now,
    enrolment_updated_by_name: BY,
  };
}

export async function getLmsEnrolmentSettings(): Promise<Record<string, any>> {
  const doc: any = await col("app_settings").findOne({ _id: SETTINGS_ID } as any);
  const { _id, ...rest } = doc ?? {};
  return rest;
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

/** Which of these emails have an LMS account — every batch answered, or it throws. */
async function lmsAccounts(emails: string[]): Promise<Map<string, { exists: boolean; active: boolean; in_org: boolean }>> {
  const out = new Map<string, { exists: boolean; active: boolean; in_org: boolean }>();
  for (let i = 0; i < emails.length; i += BATCH) {
    const data = await callLms<{ accounts: any[] }>("/accounts", { method: "POST", body: { emails: emails.slice(i, i + BATCH) }, verb: "look up the accounts" });
    if (!Array.isArray(data?.accounts)) throw new Error("The LMS did not list the accounts");
    for (const a of data.accounts) {
      out.set(String(a.email ?? "").toLowerCase(), { exists: !!a.exists, active: a.status !== "inactive", in_org: !!a.inOrganization });
    }
  }
  return out;
}

/** Look every student up in the LMS and set Enrolled / Not enrolled from it. */
export async function syncLmsEnrolment(by = "Schedule"): Promise<LmsEnrolmentRun> {
  const at = new Date().toISOString();
  const run: LmsEnrolmentRun = { at, by, ok: false, students: 0, with_account: 0, enrolled: 0, not_enrolled: 0, kept_by_hand: 0, back_to_lms: 0 };
  if (!lmsConfigured()) {
    run.error = "The LMS link is not set up on this server (LMS_API_URL, LMS_SERVICE_SECRET)";
    return run;
  }
  if (!(await takeLease())) {
    run.error = "A check is already running";
    return run;
  }
  try {
    const students = (await col("students")
      .find({}, { projection: { email: 1, enrolment_status: 1, enrolment_manual: 1, lms_account: 1, lms_classes: 1, lms_courses: 1 } })
      .toArray()) as any[];
    run.students = students.length;
    const emailOf = (s: any) => String(s.email ?? "").trim().toLowerCase();
    const emails = [...new Set(students.map(emailOf).filter((e) => e.includes("@")))];
    const accounts = await lmsAccounts(emails);   // everything first: nothing changes on a partial answer

    const found = students.filter((s) => accounts.get(emailOf(s))?.exists).length;
    const last = (await getLmsEnrolmentSettings()).last_ok_run as LmsEnrolmentRun | undefined;
    if (last && last.with_account > 100 && found < last.with_account * 0.5) {
      throw new Error(`Only ${found} students have an LMS account, against ${last.with_account} last time — not changing anyone (the wrong LMS or a wrong key?)`);
    }
    run.with_account = found;

    const ops: any[] = [];
    const history: HistoryEntry[] = [];
    for (const s of students) {
      const acc = accounts.get(emailOf(s));
      const has = !!acc?.exists;
      const status = s.enrolment_status === "closed" || s.enrolment_status === "old" ? s.enrolment_status : "open";
      const set: Record<string, any> = {};
      const unset: Record<string, ""> = {};
      // What the LMS says about them, kept when it changes.
      const before = s.lms_account ?? null;
      if (!before || !!before.exists !== has || (has && (!!before.active !== !!acc?.active || !!before.in_org !== !!acc?.in_org))) {
        set.lms_account = has ? { exists: true, active: !!acc?.active, in_org: !!acc?.in_org, since: before?.exists ? before.since ?? at : at } : { exists: false, since: at };
      }
      let to: string | null = null;
      if (s.enrolment_manual) {
        if (has === (status === "closed")) { unset.enrolment_manual = ""; run.back_to_lms++; }
        else run.kept_by_hand++;
      } else if (has && status !== "closed") to = "closed";
      else if (!has && status === "closed") to = "open";
      if (to) {
        Object.assign(set, { enrolment_status: to, enrolment_updated_at: at, enrolment_updated_by_name: BY, updated_date: at });
        unset.enrolment_updated_by_id = "";
        history.push({
          student_id: String(s._id), at, type: "enrolment_changed", by_id: null, by_name: BY, from: status, to, via: "lms",
          text: to === "closed" ? "Enrolled — has a Delta LMS account" : "Not enrolled — no Delta LMS account",
        });
        if (to === "closed") run.enrolled++; else run.not_enrolled++;
      }
      if (Object.keys(set).length || Object.keys(unset).length) {
        ops.push({ updateOne: { filter: { _id: s._id }, update: { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) } } });
      }
    }
    for (let i = 0; i < ops.length; i += 1000) await col("students").bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    await recordHistory(history);
    run.classes = await syncClassCounts(students, emails, emailOf);
    run.courses = await syncCourseLists(students, emails, emailOf);
    run.ok = true;
    await col("app_settings").updateOne({ _id: SETTINGS_ID } as any, { $set: { last_run: run, last_ok_run: run, running_until: null } }, { upsert: true });
    return run;
  } catch (err) {
    run.error = err instanceof Error ? err.message : String(err);
    await col("app_settings").updateOne({ _id: SETTINGS_ID } as any, { $set: { last_run: run, running_until: null } }, { upsert: true });
    return run;
  }
}

/** Each student's LMS courses — every batch answered, or nothing changes. Written only where they changed. Never throws. */
async function syncCourseLists(students: any[], emails: string[], emailOf: (s: any) => string): Promise<NonNullable<LmsEnrolmentRun["courses"]>> {
  try {
    const lists = new Map<string, LmsCourseSummary[]>();
    for (let i = 0; i < emails.length; i += BATCH) {
      const data = await callLms<{ students: any[] }>("/enrolments", { method: "POST", body: { emails: emails.slice(i, i + BATCH) }, verb: "share the courses" });
      if (!Array.isArray(data?.students)) throw new Error("The LMS did not list the courses");
      for (const s of data.students) {
        lists.set(String(s.email ?? "").toLowerCase(), (Array.isArray(s.courses) ? s.courses : []).map((c: any) => ({
          course_id: String(c.courseId ?? ""), title: String(c.title ?? ""), program: String(c.program ?? ""), academy: String(c.academy ?? ""),
          status: String(c.status ?? "active"), progress: Number(c.progress) || 0, access: String(c.access ?? ""),
        })));
      }
    }
    const ops: any[] = [];
    let withCourses = 0;
    for (const s of students) {
      const next = lists.get(emailOf(s)) ?? [];
      if (next.length) withCourses++;
      const before = Array.isArray(s.lms_courses) ? s.lms_courses : null;
      if (!next.length && !before?.length) continue;                       // none then, none now
      if (before && JSON.stringify(before) === JSON.stringify(next)) continue;
      ops.push({ updateOne: { filter: { _id: s._id }, update: { $set: { lms_courses: next, lms_courses_checked_at: new Date().toISOString() } } } });
    }
    for (let i = 0; i < ops.length; i += 1000) await col("students").bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    return { ok: true, with_courses: withCourses };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Each student's LMS class counts — every batch answered, or nothing changes. Never throws. */
async function syncClassCounts(students: any[], emails: string[], emailOf: (s: any) => string): Promise<NonNullable<LmsEnrolmentRun["classes"]>> {
  try {
    const counts = new Map<string, any>();
    for (let i = 0; i < emails.length; i += BATCH) {
      const data = await callLms<{ students: any[] }>("/class-attendance", { method: "POST", body: { emails: emails.slice(i, i + BATCH) }, verb: "share the classes" });
      if (!Array.isArray(data?.students)) throw new Error("The LMS did not list the classes");
      for (const c of data.students) counts.set(String(c.email ?? "").toLowerCase(), c);
    }
    const ops: any[] = [];
    let withClasses = 0;
    for (const s of students) {
      const c = counts.get(emailOf(s));
      const next = c ? {
        attended: Number(c.attended) || 0, missed: Number(c.missed) || 0, upcoming: Number(c.upcoming) || 0,
        booked: Number(c.booked) || 0, cancelled: Number(c.cancelled) || 0, last_attended_at: String(c.lastAttendedAt ?? ""),
      } : null;
      const any = !!next && (next.attended + next.missed + next.upcoming + next.booked + next.cancelled) > 0;
      if (any) withClasses++;
      const before = s.lms_classes ?? null;
      if (!any && !before) continue;                                         // nothing then, nothing now
      const value = any ? next : { attended: 0, missed: 0, upcoming: 0, booked: 0, cancelled: 0, last_attended_at: "" };
      const { checked_at: _old, ...was } = before ?? {};
      if (JSON.stringify(was) === JSON.stringify(value)) continue;
      ops.push({ updateOne: { filter: { _id: s._id }, update: { $set: { lms_classes: { ...value, checked_at: new Date().toISOString() } } } } });
    }
    for (let i = 0; i < ops.length; i += 1000) await col("students").bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    return { ok: true, with_classes: withClasses };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const lmsEnrolmentOn = () => lmsConfigured() && !/^(off|false|0|no)$/i.test(process.env.LMS_ENROLMENT_SYNC ?? "");

/** Every hour (the first a few minutes after start). LMS_ENROLMENT_SYNC=off keeps this server out of it. */
export function startLmsEnrolmentWorker(): void {
  if (!lmsEnrolmentOn()) {
    console.log(`[lms enrolment] off on this server (${lmsConfigured() ? "LMS_ENROLMENT_SYNC=off" : "no LMS link: LMS_API_URL / LMS_SERVICE_SECRET"})`);
    return;
  }
  const tick = async () => {
    const r = await syncLmsEnrolment("Schedule").catch((err) => ({ ok: false, error: String(err) }) as LmsEnrolmentRun);
    if (r.ok) console.log(`[lms enrolment] ${r.with_account} of ${r.students} have an LMS account; ${r.enrolled} now enrolled, ${r.not_enrolled} not enrolled${r.kept_by_hand ? `, ${r.kept_by_hand} kept as set by hand` : ""}`);
    else if (r.error !== "A check is already running") console.error(`[lms enrolment] not run: ${r.error}`);
  };
  setTimeout(() => void tick(), 3 * 60_000);
  setInterval(() => void tick(), EVERY_MS);
}
