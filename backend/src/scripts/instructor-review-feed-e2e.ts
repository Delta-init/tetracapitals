/**
 * Instructor Reviews' All reviews and filters (the user, 2026-11-10), functions/instructorReviews.ts, on made-up staff in a
 * throwaway mongod and a stand-in LMS:
 *   - who: a mentor sees "My reviews" (their address), their team (their team's addresses) or everyone (no narrowing);
 *     an admin everyone; a CS refused;
 *   - what goes to the LMS: the days, programme, stars, kind, with words, search, one mentor, the page — and nothing
 *     that isn't one of those (a bad day, an unknown programme, 7 stars);
 *   - the Leaderboard takes the days and programme too; the LMS's answer comes back with the scope.
 * Run through ./test-instructor-review-feed.sh. Refuses anything but a scratch database on 127.0.0.1.
 */
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "", dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const show = (v: unknown) => String(JSON.stringify(v)).slice(0, 600);

const asked: URL[] = [];
const lms = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  fetch(req) {
    const u = new URL(req.url);
    if (req.headers.get("x-portal-secret") !== process.env.LMS_SERVICE_SECRET) return Response.json({ success: false, error: { message: "bad secret" } }, { status: 401 });
    asked.push(u);
    if (u.pathname === "/api/v1/service/instructor-reviews/feed") {
      return Response.json({ success: true, data: { reviews: [{ id: "r1", kind: "mentor_rating", rating: 5 }], total: 1, page: Number(u.searchParams.get("page")), perPage: Number(u.searchParams.get("per_page")), stats: { count: 1 } } });
    }
    if (u.pathname === "/api/v1/service/instructor-reviews") {
      return Response.json({ success: true, data: [{ instructorId: "a".repeat(24), name: "Senior A", email: "SENIOR.A@e2e.test", avgRating: 4.5 }, { instructorId: "b".repeat(24), name: "Other", email: "other@e2e.test", avgRating: 4 }] });
    }
    return Response.json({ success: false, error: { message: "not here" } }, { status: 404 });
  },
});
process.env.LMS_API_URL = `http://127.0.0.1:${lms.port}`;

const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});
const u = (name: string, app_role: string, up?: ObjectId) => ({ _id: new ObjectId(), full_name: name, email: `${name.toLowerCase().replace(/ /g, ".")}@e2e.test`, app_role, status: "active", up_head_id: up ? String(up) : "" });
const chief = u("Chief A", "chief_mentor");
const senior = u("Senior A", "senior_mentor", chief._id);
const junior = u("Junior A", "junior_mentor", senior._id);
const admin = u("Admin", "super_admin");
const cs = u("Cee Ess", "cs", senior._id);
await db.collection("users").insertMany([chief, senior, junior, admin, cs] as any[]);

const { connectDb, closeDb } = await import("../db");
const { getInstructorReviewFeed, getInstructorReviews } = await import("../functions/instructorReviews");
await connectDb();
const as = (x: any) => ({ id: String(x._id), email: x.email, full_name: x.full_name, app_role: x.app_role }) as any;
const ask = async (fn: any, who: any, body: Record<string, unknown> = {}) => {
  const res = await fn(new Request("http://e2e/api/functions/x", { method: "POST", body: JSON.stringify(body) }), as(who));
  return { status: res.status, body: (await res.json()) as any };
};
const last = () => asked[asked.length - 1]!;
const p = (k: string) => last().searchParams.get(k);

step("Whose reviews");
let r = await ask(getInstructorReviewFeed, senior, { mine: true });
check("My reviews: only their own address", r.status === 200 && p("emails") === senior.email && r.body.scope === "mine" && r.body.reviews.length === 1, show({ q: last().search, b: r.body }));
r = await ask(getInstructorReviewFeed, senior, {});
const team = String(p("emails")).split(",");
check("their team to start: their whole team's addresses (theirs among them), nobody else's", r.body.scope === "team" && r.body.team === true && team.includes(senior.email) && team.includes(junior.email) && !team.includes(admin.email), show(team));
r = await ask(getInstructorReviewFeed, senior, { scope: "all" });
check("Everyone: no narrowing — every mentor's", r.body.scope === "all" && p("emails") === null, last().search);
r = await ask(getInstructorReviewFeed, admin, {});
check("an admin: everyone", r.body.scope === "all" && r.body.team === false && p("emails") === null);
r = await ask(getInstructorReviewFeed, junior, { mine: true });
check("a Junior: their own too", r.status === 200 && p("emails") === junior.email);
r = await ask(getInstructorReviewFeed, cs, {});
check("a CS: refused", r.status === 403);

step("The filters, as the LMS reads them");
r = await ask(getInstructorReviewFeed, senior, { scope: "all", from: "2026-11-01", to: "2026-11-10", program: "4x-trading", rating: "low", kind: "class_feedback", withComment: true, q: "  late start  ", instructor: "c".repeat(24), page: 3 });
check("days, programme, stars, kind, with words, search, one mentor, the page (25 a page)", p("from") === "2026-11-01" && p("to") === "2026-11-10" && p("program") === "4x-trading" && p("rating") === "low"
  && p("kind") === "class_feedback" && p("withComment") === "1" && p("q") === "late start" && p("instructor") === "c".repeat(24) && p("page") === "3" && p("per_page") === "25", last().search);
r = await ask(getInstructorReviewFeed, senior, { scope: "all", from: "1 Nov", to: "2026-13-40x", program: "astrology", rating: 7, kind: "gossip", instructor: "nope", perPage: 5000 });
check("nothing that isn't a filter: a bad day, an unknown programme, 7 stars, an odd kind or mentor; at most 100 a page",
  ["from", "to", "program", "rating", "kind", "instructor", "withComment", "q"].every((k) => p(k) === null) && p("per_page") === "100", last().search);
r = await ask(getInstructorReviewFeed, senior, { scope: "all", rating: 4, perPage: 100 });
check("one star count, and a bigger page for the export", p("rating") === "4" && p("per_page") === "100");

step("Leaderboard");
r = await ask(getInstructorReviews, senior, { scope: "team", from: "2026-11-01", to: "2026-11-10", program: "ai" });
check("the days and programme go to the LMS", last().pathname === "/api/v1/service/instructor-reviews" && p("from") === "2026-11-01" && p("to") === "2026-11-10" && p("program") === "ai", last().search);
check("…their team's mentors only (by address, any letter case), ranked", r.status === 200 && r.body.rows.length === 1 && r.body.rows[0].name === "Senior A" && r.body.rows[0].rank === 1, show(r.body));
r = await ask(getInstructorReviews, senior, { scope: "all" });
check("Everyone: every mentor, no filters sent when none picked", r.body.rows.length === 2 && last().search === "", last().search);

await closeDb(); await client.close(); lms.stop(true);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
