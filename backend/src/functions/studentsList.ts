import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import { allOf as and, escapeRe, pageOf, textMatch } from "../lib/paging";
import type { AuthUser } from "../auth/middleware";
import { buildScopeFilter, getConfiguredScope, getDownlineIds } from "../lib/scope";
import { isMentorRole } from "../lib/roles";
import { userCanListEntity } from "../entities/crud";
import { courseLabel } from "../students/tags";
import { businessToday } from "../students/followups";

/* ────────────────────────────────────────────────────────────────────────────
   The Students page, one page at a time. Which students each tab holds and
   every filter on the page are worked out here, with the same rules the page
   used to apply in the browser to the whole list:

     my                their students and the ones Common with them
                       (Assistance with an assigned mentor: that mentor's)
     team              Team visibility (Chief Mentor): everyone under them on
                       the Up Head chain, and where they are the senior mentor
                       — not their own
     co_managed        where they are a co-mentor
     all               everyone they may see (admin roles, and anyone who is
                       not a mentor)
     open_pool         Delta Open Students
     admin_co_managed  every student with co-mentors

   …always within the role's row-level scope, as the Students list API. The
   co-managed tabs take no filters (as before).
──────────────────────────────────────────────────────────────────────────── */

type Tab = "my" | "team" | "co_managed" | "all" | "open_pool" | "admin_co_managed";
const ADMIN_TAB_ROLES = ["super_admin", "broker_admin", "academic_head"];
const CLOSED_PREFIX = "Closed - ";

const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

/** The tabs this person's Students page has — the same choice the page makes. */
async function tabsFor(user: AuthUser): Promise<Tab[]> {
  // The Sales role: one list — the students they closed (their scope) — however custom roles are otherwise treated.
  if ((await getConfiguredScope(user)) === "closed") return ["all"];
  if (isMentorRole(user.app_role)) {
    const tabs: Tab[] = ["my"];
    if ((await getConfiguredScope(user)) === "downline") tabs.push("team");
    tabs.push("co_managed");
    return tabs;
  }
  if (ADMIN_TAB_ROLES.includes(user.app_role)) {
    return user.app_role === "academic_head" ? ["all", "open_pool"] : ["all", "open_pool", "admin_co_managed"];
  }
  return ["all"];
}

/** Their own students, Common ones included. */
const mine = (id: string) => ({ $or: [{ primary_mentor_id: id }, { "common_cs.id": id }] });
/** co_mentors_details is stored as a JSON string (an array on a few older records). */
const coMentorIs = (id: string) => ({ $or: [{ co_mentors_details: { $regex: `"mentor_id"\\s*:\\s*"${escapeRe(id)}"` } }, { "co_mentors_details.mentor_id": id }] });
const hasCoMentors = { $or: [{ co_mentors_details: { $regex: '"mentor_id"' } }, { "co_mentors_details.0": { $exists: true } }] };

async function tabFilter(user: AuthUser, tab: Tab): Promise<Record<string, any>> {
  switch (tab) {
    case "my": {
      const assigned = user.app_role === "assistance" ? str(user.assigned_mentor_id, 40) : "";
      return assigned ? { primary_mentor_id: assigned } : mine(user.id);
    }
    case "team": {
      const team = await getDownlineIds(user.id);
      return and(
        { $nor: mine(user.id).$or },
        { $or: [{ primary_mentor_id: { $in: team } }, { "common_cs.id": { $in: team } }, { senior_mentor_id: user.id }] },
      );
    }
    case "co_managed": return coMentorIs(user.id);
    case "open_pool": return { assignment_status: "open_pool" };
    case "admin_co_managed": return hasCoMentors;
    default: return {};
  }
}

/** A tag as the page shows tags: Old / Closed from the Enrolment, Common, then the ones put on the student. */
function tagFilter(name: string): Record<string, any> {
  const own = { tags: name };
  if (name === "Old") return { $or: [{ enrolment_status: "old" }, own] };
  if (name === "Closed") return { $or: [{ enrolment_status: "closed", tags: { $not: /^Closed - / } }, own] };
  if (name === "Common") {
    const commonWithAnother = {
      $expr: {
        $gt: [{
          $size: {
            $filter: {
              input: { $cond: [{ $isArray: "$common_cs" }, "$common_cs", []] },
              as: "c",
              cond: { $and: [{ $gt: [{ $ifNull: ["$$c.id", ""] }, ""] }, { $ne: ["$$c.id", "$primary_mentor_id"] }] },
            },
          },
        }, 0],
      },
    };
    return { $or: [commonWithAnother, own] };
  }
  return own;
}

/** "Course / Product": course:<name> (LMS course, a Closed tag or a Course fee), product:<tag on an approved deposit>, or none. */
async function courseFilter(value: string): Promise<Record<string, any> | null> {
  const withProducts = async (tag?: string) => {
    const filter: Record<string, any> = { type: "DEPOSIT", status: "APPROVED", student_id: { $nin: [null, ""] } };
    filter.tags = tag === undefined ? { $exists: true, $ne: [] } : tag;
    return (await col("funding_transactions").distinct("student_id", filter)).map((id) => toObjectId(String(id))).filter(Boolean);
  };
  if (value === "none") {
    return {
      $nor: [
        { lms_course: { $nin: [null, ""] } },
        { tags: /^Closed - / },
        { "course_fees.course": { $nin: [null, ""] } },
        { _id: { $in: await withProducts() } },
      ],
    };
  }
  if (value.startsWith("product:")) return { _id: { $in: await withProducts(value.slice("product:".length)) } };
  if (value.startsWith("course:")) {
    const want = value.slice("course:".length).toLowerCase();
    const same = (raw: unknown) => courseLabel(raw).toLowerCase() === want;
    const [lms, fees, tags] = await Promise.all([
      col("students").distinct("lms_course"),
      col("students").distinct("course_fees.course"),
      col("students").distinct("tags", { tags: /^Closed - / }),
    ]);
    return {
      $or: [
        { lms_course: { $in: lms.filter(same) } },
        { "course_fees.course": { $in: fees.filter(same) } },
        { tags: { $in: tags.filter((t) => typeof t === "string" && t.startsWith(CLOSED_PREFIX) && same(t.slice(CLOSED_PREFIX.length))) } },
      ],
    };
  }
  return null;
}

/* "Follow-up today" (the user, 2026-10-06): due today or overdue and not called yet — they drop off once the call is
   logged — or called today. Called = a follow-up logged today, or opened today with what they said: the Follow-ups
   page's Done today. Today is the follow-ups' business day (students/followups.ts BUSINESS_OFFSET_MS). */
const FOLLOWUP_FILTERS = new Set(["due_not_called", "called_today"]);
const BUSINESS_OFFSET_MS = 330 * 60_000;

async function followupFilter(which: string): Promise<Record<string, any>> {
  const today = businessToday();
  const dayStart = new Date(Date.parse(`${today}T00:00:00.000Z`) - BUSINESS_OFFSET_MS).toISOString();
  const calledToday = {
    $or: [{ last_contact_date: today }, { client_said: { $nin: [null, ""] }, created_date: { $gte: dayStart } }],
  };
  const called = new Set((await col("student_followups").distinct("student_id", calledToday)).map(String));
  const ids = which === "called_today"
    ? [...called]
    // Due today or before ("" is no date — not due), still open.
    : (await col("student_followups").distinct("student_id", { next_followup_date: { $gt: "", $lte: today }, stage: { $nin: ["Converted", "Lost"] } }))
      .map(String).filter((id) => !called.has(id));
  return { _id: { $in: ids.map((id) => toObjectId(id)).filter(Boolean) } };
}

/** Every filter on the page, as Mongo — the search and the selects. */
async function filters(user: AuthUser, tab: Tab, f: any): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  const search = textMatch(["full_name", "student_code", "email", "phone"], str(f?.search, 100));
  if (search) out.push(search);
  if (f?.onlyNew) out.push({ new_for_id: user.id, primary_mentor_id: user.id });
  const tag = str(f?.tag);
  if (tag && tag !== "all") out.push(tagFilter(tag));
  if (f?.enrolment === "enrolled") out.push({ enrolment_status: "closed" });
  if (f?.enrolment === "not_enrolled") out.push({ enrolment_status: { $ne: "closed" } });
  if (f?.onboarding === "onboarded") out.push({ onboarded: true });
  if (f?.onboarding === "not_onboarded") out.push({ onboarded: { $ne: true } });
  // LMS classes in their own courses (the hourly LMS check keeps the counts on the student).
  if (["attended", "booked", "upcoming"].includes(f?.classes)) out.push({ [`lms_classes.${f.classes}`]: { $gt: 0 } });
  if (FOLLOWUP_FILTERS.has(f?.followup)) out.push(await followupFilter(f.followup));
  const course = str(f?.course);
  if (course && course !== "all") {
    const c = await courseFilter(course);
    if (c) out.push(c);
  }
  if (f?.balance === "owing") out.push({ course_fees: { $elemMatch: { balance_minor: { $gt: 0 } } } });
  if (f?.balance === "paid") {
    out.push({ course_fees: { $elemMatch: { balance_minor: { $type: "number" } } } });
    out.push({ course_fees: { $not: { $elemMatch: { balance_minor: { $gt: 0 } } } } });
  }
  const from = str(f?.from, 40), to = str(f?.to, 40);
  if (from && to) out.push({ created_date: { $gte: from, $lte: to } });
  const status = str(f?.status);
  if (status && status !== "all") out.push({ status });
  const team = str(f?.team, 40);
  if (team && team !== "all") out.push(team === "none" ? { team_id: { $in: [null, ""] } } : { team_id: team });
  const level = str(f?.level, 20);
  if (level === "LEVEL_1") out.push({ student_level: { $in: ["LEVEL_1", null, ""] } });
  else if (level && level !== "all") out.push({ student_level: level });
  const mentor = str(f?.mentor);
  if (tab === "all" && mentor && mentor !== "all") out.push({ primary_mentor_name: mentor });
  return out;
}

/**
 * POST /api/functions/listStudents
 * Body: { tab, page?, pageSize? (25 | 50 | 100), all? (every match, up to 10,000 — export, select all),
 *         filters?: { search, onlyNew, tag, enrolment, onboarding, classes, followup, course, balance, from, to, status, team, level, mentor } }
 * → { tab, tabs, rows, total, page, page_size, truncated?, counts: { new_for_me, co_managed?, admin_co_managed? },
 *     followup_filter? (the follow-up filter applied — the page tells a server without it apart) }
 */
export async function listStudents(req: Request, user: AuthUser): Promise<Response> {
  if (!userCanListEntity(user, "Student")) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const tabs = await tabsFor(user);
  const tab = (str(body?.tab, 30) || tabs[0]) as Tab;
  if (!tabs.includes(tab)) return error("That list isn't open to you", 403);

  const scope = await buildScopeFilter(user, "Student");
  const takesFilters = tab !== "co_managed" && tab !== "admin_co_managed";
  const query = and(scope, await tabFilter(user, tab), ...(takesFilters ? await filters(user, tab, body?.filters) : []));

  const result = await pageOf("students", query, { created_date: -1, _id: -1 }, body);

  const counts: Record<string, number> = {
    new_for_me: await col("students").countDocuments(and(scope, { new_for_id: user.id, primary_mentor_id: user.id })),
  };
  if (tabs.includes("co_managed")) counts.co_managed = await col("students").countDocuments(and(scope, coMentorIs(user.id)));
  if (tabs.includes("admin_co_managed")) counts.admin_co_managed = await col("students").countDocuments(and(scope, hasCoMentors));

  const followup = takesFilters && FOLLOWUP_FILTERS.has(body?.filters?.followup) ? body.filters.followup : undefined;
  return json({ tab, tabs, ...result, counts, ...(followup ? { followup_filter: followup } : {}) });
}

/**
 * POST /api/functions/getStudentListOptions
 * → { courses, products, mentors } — the choices in the page's filters, from the students they may see.
 */
export async function getStudentListOptions(_req: Request, user: AuthUser): Promise<Response> {
  if (!userCanListEntity(user, "Student")) return forbidden();
  const scope = await buildScopeFilter(user, "Student");
  const visible = scope ?? {};
  const [lms, fees, tags, mentors] = await Promise.all([
    col("students").distinct("lms_course", visible),
    col("students").distinct("course_fees.course", visible),
    col("students").distinct("tags", visible),
    col("students").distinct("primary_mentor_name", visible),
  ]);
  const courses = new Map<string, string>();
  const closed = tags.filter((t): t is string => typeof t === "string" && t.startsWith(CLOSED_PREFIX)).map((t) => t.slice(CLOSED_PREFIX.length));
  for (const raw of [...lms, ...closed, ...fees]) {
    const c = courseLabel(raw);
    if (c && !courses.has(c.toLowerCase())) courses.set(c.toLowerCase(), c);
  }
  const deposits: Record<string, any> = { type: "DEPOSIT", status: "APPROVED", student_id: { $nin: [null, ""] } };
  if (scope) deposits.student_id = { $in: (await col("students").distinct("_id", scope)).map(String) };
  const products = new Set((await col("funding_transactions").distinct("tags", deposits)).map((t) => String(t ?? "").trim()).filter(Boolean));
  return json({
    courses: [...courses.values()].sort(),
    products: [...products].sort(),
    mentors: mentors.filter(Boolean).map(String).sort(),
  });
}

/**
 * POST /api/functions/findStudentByEmail { email }
 * The student with this email among those the person may see (any letter case), or null — the check before adding one.
 */
export async function findStudentByEmail(req: Request, user: AuthUser): Promise<Response> {
  if (!userCanListEntity(user, "Student")) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").slice(0, 200);
  if (!email.trim()) return json({ student: null });
  const scope = await buildScopeFilter(user, "Student");
  const doc: any = await col("students").findOne(
    and(scope, { email: { $regex: `^${escapeRe(email)}$`, $options: "i" } }),
    { projection: { full_name: 1, student_code: 1, primary_mentor_id: 1, common_cs: 1 } },
  );
  return json({ student: doc ? { id: String(doc._id), full_name: doc.full_name ?? "", student_code: doc.student_code ?? "", primary_mentor_id: doc.primary_mentor_id ?? "", common_cs: doc.common_cs ?? [] } : null });
}
