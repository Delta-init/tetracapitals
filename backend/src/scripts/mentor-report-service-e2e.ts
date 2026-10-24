/**
 * GET /api/v1/service/mentor-report and /mentor-reviews (portal/service.ts → functions/mentorReport.ts and
 * instructorReviews.ts) — Root's Reports → Mentors tab (2026-10-24) — end to end:
 *
 *   Case 1  happy path   every mentor, as a Super Admin sees them: the LMS's figures day by day, matched by address,
 *                        an LMS-only instructor too, and the commission credited in the dates (pool shares included)
 *   Case 2  reviews      one mentor's reviews, the dates and page handed to the LMS
 *   Case 3  errors       bad dates, no instructor, the LMS down (commission still shows), the LMS refusing reviews
 *   Case 4  permission   no secret, a wrong one
 *
 * Run through ./test-mentor-report-service.sh (throwaway mongod, the API, a fake LMS — no .env). Scratch database only.
 */
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "", dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) { console.error(`Refusing: ${uri} / ${dbName}`); process.exit(1); }
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;
const SECRET = process.env.ROOT_ERP_SECRET ?? "", LMS_SECRET = process.env.LMS_SERVICE_SECRET ?? "";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"} ${label}\x1b[0m${ok ? "" : ` — ${detail}`}`); };
const same = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
async function get(path: string, secret: string | null = SECRET) {
  const r = await fetch(`${API}/api/v1/service${path}`, { headers: secret ? { "x-portal-secret": secret } : {} });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
}

const FROM = "2026-10-20", TO = "2026-10-22";
const P = `?from=${FROM}&to=${TO}`;
const at = (day: string, hh = "10") => new Date(`${day}T${hh}:00:00+04:00`).toISOString();

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
await db.dropDatabase();

const person = (full_name: string, email: string, app_role: string, extra: Record<string, unknown> = {}) =>
  ({ _id: new ObjectId(), email, full_name, app_role, status: "active", ...extra });
const chief = person("Chief Ann", "ann@e2e.test", "chief_mentor");
const junior = person("Junior Ben", "Ben@E2E.test", "junior_mentor");
const gone = person("Gone Gil", "gil@e2e.test", "senior_mentor", { status: "inactive" });
const cs = person("Cee Cs", "cee@e2e.test", "cs");
await db.collection("users").insertMany([chief, junior, gone, cs] as any[]);
const id = (u: any) => String(u._id);
await db.collection("commission_credits").insertMany([
  { recipient_id: id(chief), commission_usd: 40, requested_at: at("2026-10-21") },
  { recipient_id: id(chief), commission_usd: 12.5, requested_at: at("2026-10-21", "23") },  // 23:00 Dubai: still the 21st
  { recipient_id: id(junior), commission_usd: 7, created_date: at("2026-10-22"), requested_at: null }, // a pool share, no request date
  { recipient_id: id(chief), commission_usd: 100, requested_at: at("2026-10-19") },           // before the dates
  { recipient_id: id(cs), commission_usd: 99, requested_at: at("2026-10-21") },               // not a mentor
] as any[]);

/* The LMS: the mentors' report (Ann on two days, an instructor who isn't in the portal) and Ann's reviews. */
const ANN_LMS = "a".repeat(24);
let lmsDown = false;
const asked: string[] = [];
const lms = Bun.serve({
  port: Number(process.env.E2E_FAKE_LMS_PORT),
  fetch(req) {
    const url = new URL(req.url);
    asked.push(url.pathname + url.search);
    if (req.headers.get("x-portal-secret") !== LMS_SECRET) return Response.json({ success: false, message: "Bad secret" }, { status: 401 });
    if (lmsDown) return Response.json({ success: false, message: "The LMS is having a moment" }, { status: 503 });
    if (url.pathname === "/api/v1/service/mentor-report") {
      return Response.json({ success: true, data: { mentors: [
        { instructorId: ANN_LMS, email: "ANN@e2e.test", name: "Ann (LMS)",
          total: { classes: 3, held: 2, classesCancelled: 1, bookings: 9, bookingsCancelled: 1, attended: 7, missed: 1, meetings: 2, meetingsCancelled: 1, reviews: 2, lowRatings: 1, avgRating: 3.5, ratingCounts: { 5: 1, 2: 1 } },
          days: [{ day: "2026-10-22", classes: 1, held: 1, bookings: 4 }, { day: "2026-10-20", classes: 2, held: 1, classesCancelled: 1, bookings: 5 }] },
        { instructorId: "b".repeat(24), email: "lms-only@e2e.test", name: "Only LMS", total: { classes: 1, held: 1, bookings: 2 }, days: [{ day: "2026-10-21", classes: 1, held: 1, bookings: 2 }] },
      ] } });
    }
    if (url.pathname === `/api/v1/service/instructor-reviews/${ANN_LMS}`) {
      return Response.json({ success: true, data: { reviews: [{ _id: "r1", rating: 5, comment: "Great", studentId: { name: "Sara" }, liveClassId: { title: "Gold" }, createdAt: at("2026-10-21") }],
        total: 1, page: Number(url.searchParams.get("page")), perPage: 50 } });
    }
    return Response.json({ success: false, message: "Route GET " + url.pathname + " not found" }, { status: 404 });
  },
});

step("Case 4 — permission");
same("no secret: 401", (await get(`/mentor-report${P}`, null)).status, 401);
same("a wrong secret: 401", (await get(`/mentor-report${P}`, "nope")).status, 401);
same("…and for reviews", (await get(`/mentor-reviews?instructorId=${ANN_LMS}`, "nope")).status, 401);

step("Case 1 — every mentor");
let r = await get(`/mentor-report${P}`);
const d = r.body?.data ?? {};
const row = (email: string) => (d.mentors ?? []).find((m: any) => String(m.email).toLowerCase() === email);
check("answers, everyone (as a Super Admin), the LMS available", r.status === 200 && d.everyone === true && d.lms?.available === true && d.from === FROM && d.to === TO, JSON.stringify(r.body).slice(0, 300));
same("the mentors: Ann, Ben and the LMS-only instructor — not Gil (inactive), not the CS", (d.mentors ?? []).map((m: any) => m.name).sort(), ["Chief Ann", "Junior Ben", "Only LMS"]);
const ann = row("ann@e2e.test");
check("Ann matched to the LMS by address (case aside), its figures and id", ann?.in_lms === true && ann?.lms_id === ANN_LMS && ann?.total?.held === 2 && ann?.total?.bookings === 9 && ann?.total?.avgRating === 3.5, JSON.stringify(ann));
same("Ann's commission in the dates: 40 + 12.50 (not the 19th's 100)", ann?.total?.commission_usd, 52.5);
same("…on her days: the 22nd and 20th from the LMS, the 21st from the commission", (ann?.days ?? []).map((x: any) => [x.day, x.held, x.commission_usd]), [["2026-10-22", 1, 0], ["2026-10-21", 0, 52.5], ["2026-10-20", 1, 0]]);
const ben = row("ben@e2e.test");
check("Ben: no LMS activity, a pool share of 7 on the 22nd", ben?.in_lms === false && ben?.total?.commission_usd === 7 && ben?.days?.[0]?.day === "2026-10-22", JSON.stringify(ben));
check("the LMS-only instructor is there, without commission", row("lms-only@e2e.test")?.in_lms === true && row("lms-only@e2e.test")?.total?.commission_usd === 0);
check("the LMS was asked for everyone (no address list), with the dates", asked.some((a) => a === `/api/v1/service/mentor-report?from=${FROM}&to=${TO}`), asked.join(" | "));
check("most classes held first", d.mentors?.[0]?.name === "Chief Ann");

step("Case 2 — a mentor's reviews");
r = await get(`/mentor-reviews?instructorId=${ANN_LMS}&from=${FROM}&to=${TO}&page=2`);
check("her reviews, as the LMS gave them", r.status === 200 && r.body?.data?.reviews?.[0]?.comment === "Great" && r.body?.data?.total === 1, JSON.stringify(r.body).slice(0, 300));
check("…the LMS asked for page 2, 50 a page, in the dates", asked.some((a) => a.startsWith(`/api/v1/service/instructor-reviews/${ANN_LMS}?`) && a.includes("page=2") && a.includes("per_page=50") && a.includes(`from=${FROM}`) && a.includes(`to=${TO}`)), asked.join(" | "));

step("Case 3 — errors");
same("dates missing: 400", (await get(`/mentor-report?from=${FROM}`)).status, 400);
same("dates upside down: 400", (await get(`/mentor-report?from=${TO}&to=${FROM}`)).status, 400);
same("not a date: 400", (await get(`/mentor-report?from=20-10-2026&to=${TO}`)).status, 400);
same("reviews without an instructor: 400", (await get(`/mentor-reviews`)).status, 400);
lmsDown = true;
r = await get(`/mentor-report${P}`);
check("the LMS down: still answers, says so, commission still shows", r.status === 200 && r.body?.data?.lms?.available === false && !!r.body?.data?.lms?.message
  && (r.body?.data?.mentors ?? []).find((m: any) => m.name === "Chief Ann")?.total?.commission_usd === 52.5, JSON.stringify(r.body?.data?.lms));
r = await get(`/mentor-reviews?instructorId=${ANN_LMS}`);
check("reviews with the LMS down: 502 and why", r.status === 502 && typeof r.body?.error?.message === "string" && r.body.error.message.length > 0, JSON.stringify(r.body));

lms.stop(true);
await client.close();
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
