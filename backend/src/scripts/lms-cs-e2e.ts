/**
 * Each student's CS and CS team, told to the Delta LMS (students/lmsCs.ts) —
 * against a scratch database and a stand-in LMS this test serves itself, run
 * by run:
 *
 *   A. the first run tells the LMS every student with an LMS account — by
 *      email, and by their LMS id where kept — with their CS, team, code and
 *      whether they wait in Delta Open Students (no CS then, whatever is in
 *      the mentor field); none without an account; each remembered as told;
 *   B. the next run tells nothing new — only a student the LMS did not find is
 *      asked about again; a changed team, a CS given to an open-pool student,
 *      a student code — each told, alone;
 *   C. an LMS that is down changes nothing here, and the next run tells it all
 *      the same; more than 500 go in batches of 500;
 *   D. one run at a time; switched off by LMS_CS_SYNC=off; not set up without
 *      the LMS link.
 *
 * Run by ../../test-lms-cs.sh.
 */
import { ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
const SECRET = process.env.LMS_SERVICE_SECRET ?? "";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

/* ── A stand-in LMS: POST /service/student-cs, behind its secret ── */
let lmsMode: "ok" | "down" = "ok";
const calls: any[][] = [];                    // each call's students
const notFound = new Set<string>();           // emails the LMS has no student for
const lms = Bun.serve({
  port: Number(process.env.E2E_FAKE_LMS_PORT),
  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get("x-portal-secret") !== SECRET) return Response.json({ success: false, error: { message: "Bad secret" } }, { status: 401 });
    if (lmsMode === "down") return Response.json({ success: false, error: { message: "LMS is down" } }, { status: 503 });
    if (url.pathname !== "/api/v1/service/student-cs") return Response.json({ success: false, error: { message: "Route not found" } }, { status: 404 });
    const body: any = await req.json().catch(() => ({}));
    const students: any[] = Array.isArray(body.students) ? body.students : [];
    calls.push(students);
    const missing = students.filter((s) => notFound.has(String(s.email))).map((s) => String(s.email));
    return Response.json({ success: true, data: { updated: students.length - missing.length, unchanged: 0, notFound: missing } });
  },
});

const { connectDb, col, closeDb } = await import("../db");
const { syncLmsCs, lmsCsOn } = await import("../students/lmsCs");
await connectDb();
const db = col("students");
await db.deleteMany({});
await col("app_settings").deleteMany({});

const LMS_ID = new ObjectId().toHexString();
await db.insertMany([
  { student_code: "STU-10", email: "Aisha@Example.com", primary_mentor_name: "CS 2- AB", team_name: "Falcons", assignment_status: "assigned", lms_account: { exists: true } },
  { student_code: "STU-11", email: "bilal@example.com", lms_user_id: LMS_ID, primary_mentor_name: "CS 3- KT", team_name: "Eagles", assignment_status: "assigned" },
  { student_code: "STU-12", email: "cara@example.com", primary_mentor_name: "Left over", team_name: "Delta Open Students", assignment_status: "open_pool", lms_account: { exists: true } },
  { student_code: "STU-13", email: "dev@example.com", primary_mentor_name: "CS 4", team_name: "Owls", assignment_status: "assigned", lms_account: { exists: false } },
  { student_code: "STU-14", email: "eve@example.com", primary_mentor_name: "CS 5", team_name: "Owls", assignment_status: "assigned", lms_account: { exists: true } },
] as any[]);
notFound.add("eve@example.com");
const sentOf = async (code: string) => ((await db.findOne({ student_code: code })) as any)?.lms_cs_sent;
const told = (code: string) => calls.at(-1)?.find((s) => s.code === code);
// The lease is let go at the end of each run; a test clears it between runs too.
const freeLease = () => col("app_settings").updateOne({ _id: "lms_cs" } as any, { $set: { running_until: null } });

try {
  step("A · the first run tells the LMS everyone with an account");
  let r = await syncLmsCs("Test");
  check("run ok: 4 of the 4 with an LMS account sent, 1 not found there", r.ok && r.students === 4 && r.sent === 4 && r.not_found === 1, JSON.stringify(r));
  const a = told("STU-10");
  check("by email (lower case), with the CS, team, code; not open", a?.email === "aisha@example.com" && a?.cs === "CS 2- AB" && a?.team === "Falcons" && a?.code === "STU-10" && a?.open === false, JSON.stringify(a));
  check("by their LMS id too, where kept", told("STU-11")?.lmsUserId === LMS_ID && told("STU-11")?.email === "bilal@example.com", JSON.stringify(told("STU-11")));
  const c = told("STU-12");
  check("the open pool: no CS, whatever the mentor field says; its team; open", c?.cs === "" && c?.team === "Delta Open Students" && c?.open === true, JSON.stringify(c));
  check("no LMS account: not sent", !told("STU-13"));
  check("each remembered as told", (await sentOf("STU-10"))?.team === "Falcons" && (await sentOf("STU-12"))?.open === true && !!(await sentOf("STU-11"))?.at);
  check("…but not the one the LMS did not find", !(await sentOf("STU-14")));
  check("the secret went with it (the stand-in refuses otherwise)", calls.length === 1);

  step("B · then only what changed");
  await freeLease();
  r = await syncLmsCs("Test");
  check("nothing changed: only the one not found is asked about again", r.ok && r.sent === 1 && calls.at(-1)?.length === 1 && told("STU-14")?.email === "eve@example.com", JSON.stringify(r));
  notFound.delete("eve@example.com");
  await db.updateOne({ student_code: "STU-10" }, { $set: { team_name: "Ravens" } });
  await db.updateOne({ student_code: "STU-12" }, { $set: { assignment_status: "assigned", primary_mentor_name: "CS 7- QA", team_name: "Hawks" } });
  await db.updateOne({ student_code: "STU-11" }, { $set: { student_code: "STU-11B" } });
  await freeLease();
  r = await syncLmsCs("Test");
  const codes = (calls.at(-1) ?? []).map((s) => s.code).sort().join(",");
  check("a team changed, a CS given, a code changed — and the one now found: those four, no one else", r.ok && r.sent === 4 && codes === "STU-10,STU-11B,STU-12,STU-14", `${r.sent} ${codes}`);
  check("…as they are now", told("STU-10")?.team === "Ravens" && told("STU-12")?.cs === "CS 7- QA" && told("STU-12")?.open === false && told("STU-12")?.team === "Hawks");
  await freeLease();
  r = await syncLmsCs("Test");
  check("and then nothing at all", r.ok && r.sent === 0, JSON.stringify(r));

  step("C · an LMS that is down, and many students");
  await db.updateOne({ student_code: "STU-10" }, { $set: { primary_mentor_name: "CS 8- ZZ" } });
  lmsMode = "down";
  await freeLease();
  const before = calls.length;
  r = await syncLmsCs("Test");
  check("LMS down: the run says why, and nothing is remembered as told", !r.ok && /LMS/.test(r.error ?? "") && (await sentOf("STU-10"))?.cs === "CS 2- AB", JSON.stringify(r));
  lmsMode = "ok";
  await freeLease();
  r = await syncLmsCs("Test");
  check("back up: told on the next run", r.ok && r.sent === 1 && told("STU-10")?.cs === "CS 8- ZZ" && (await sentOf("STU-10"))?.cs === "CS 8- ZZ", JSON.stringify(r));
  check("(the down run did reach the LMS and was refused)", calls.length === before + 1);
  await db.insertMany(Array.from({ length: 1100 }, (_, i) => ({
    student_code: `STU-B${i}`, email: `bulk${i}@example.com`, primary_mentor_name: "CS 9", team_name: "Bulk", assignment_status: "assigned", lms_account: { exists: true },
  })) as any[]);
  await freeLease();
  const n = calls.length;
  r = await syncLmsCs("Test");
  check("1,100 new: in batches of 500, 500 and 100", r.ok && r.sent === 1100 && calls.slice(n).map((x) => x.length).join(",") === "500,500,100", `${r.sent} ${calls.slice(n).map((x) => x.length).join(",")}`);

  step("D · one at a time, a switch, and the link");
  await db.updateOne({ student_code: "STU-10" }, { $set: { team_name: "Kites" } });
  await freeLease();
  const [x, y] = await Promise.all([syncLmsCs("Test"), syncLmsCs("Test")]);
  check("two at once: one runs, the other says one is going", [x, y].filter((q) => q.ok).length === 1 && [x, y].some((q) => q.error === "A run is already going"), JSON.stringify([x.error, y.error]));
  process.env.LMS_CS_SYNC = "off";
  check("LMS_CS_SYNC=off: off", lmsCsOn() === false);
  delete process.env.LMS_CS_SYNC;
  check("on by default with the LMS link", lmsCsOn() === true);
  const { config } = await import("../config");
  const url = config.lms.apiUrl;
  (config.lms as any).apiUrl = "";
  await freeLease();
  r = await syncLmsCs("Test");
  check("no LMS link: not run, and says so", !r.ok && /LMS_API_URL/.test(r.error ?? ""), JSON.stringify(r));
  (config.lms as any).apiUrl = url;
} catch (err) {
  fail++; console.log(`  \x1b[31m✗ the test threw — ${(err as Error).message}\n${(err as Error).stack}\x1b[0m`);
} finally {
  lms.stop(true);
  await closeDb();
}
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
