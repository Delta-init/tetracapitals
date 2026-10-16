import { col } from "../db";
import { toObjectId } from "../lib/id";
import { businessToday, commonIds } from "../students/followups";
import { notOnboardedFilter, newFromFinanceFilter } from "../students/onboardingAlerts";
import { openFollowupsFilter, followupsDueTodayFilter, followupsOverdueFilter } from "../functions/navCounts";
import { callNeeded } from "../students/classCompletions";
import { bonusPendingOf, idsWithBonusPending, BONUS_STAGE_KEYS, type BonusStage } from "../students/bonusPending";
import { studentsByEmail, lmsTicketsOf, lmsTrouble } from "../functions/lmsSupport";
import { lmsConfigured } from "../lib/lms";
import { locations } from "./csOverview";

/* ────────────────────────────────────────────────────────────────────────────
   GET /api/v1/service/cs-pending — the Root portal's Pending → CS portal tab
   (the user, 2026-10-17): what waits on each CS, and exactly which students —

     onboarding    not onboarded yet (the Not onboarded page); from finance and
                   waiting 6 hours or more is late (red on the sidebar)
     bonus         MT5 bonuses not decided, by where each is stuck: sent back to
                   the CS, needs a call, with finance, waiting for a broker admin
                   (students/bonusPending.ts)
     tickets       the student's LMS Help & Support tickets still open — waiting
                   for an answer, or waiting on the student (the Support tickets
                   page's Open and "Waiting on student" tabs)
     followups     due today, and overdue
     completions   classes attended that still wait for the CS's call

   This app's own rules, the sidebar's filters: a student is their CS's and any
   Common CS's. One with neither is counted under "No CS yet" (id ""). Every
   active CS has a row, with or without anything waiting; anyone else (a CS
   Manager with students of their own, a switched-off CS) only with something.
   The team's totals count each student once, however many CSs share them.
   Read-only.
──────────────────────────────────────────────────────────────────────────── */

export const NO_CS = "";
/** The LMS is asked for every student's tickets at most once a minute — the Root page asks every minute. */
const TICKETS_MS = 60_000;

export interface CsPendingCounts {
  onboarding: number; onboarding_late: number;
  bonus: number; bonus_usd: number; bonus_sent_back: number; bonus_needs_call: number; bonus_with_finance: number; bonus_waiting_broker: number;
  tickets_open: number; tickets_waiting: number;
  followups_today: number; followups_overdue: number;
  completions: number;
}
const blank = (): CsPendingCounts => ({
  onboarding: 0, onboarding_late: 0,
  bonus: 0, bonus_usd: 0, bonus_sent_back: 0, bonus_needs_call: 0, bonus_with_finance: 0, bonus_waiting_broker: 0,
  tickets_open: 0, tickets_waiting: 0, followups_today: 0, followups_overdue: 0, completions: 0,
});
const cents = (n: number) => Math.round(n * 100) / 100;
const csOf = (s: any): string[] => [...new Set([String(s?.primary_mentor_id ?? ""), ...commonIds(s)].filter(Boolean))];

type Tickets = { available: boolean; message?: string; tickets: any[] };
let kept: { at: number; tickets: Promise<Tickets> } | null = null;
/** Every student's open tickets in the LMS (open: waiting for an answer; pending: waiting on the student). */
function openTickets(): Promise<Tickets> {
  if (!lmsConfigured()) return Promise.resolve({ available: false, message: "The LMS is not linked on this server", tickets: [] });
  if (kept && Date.now() - kept.at < TICKETS_MS) return kept.tickets;
  const tickets = studentsByEmail(null)
    .then(async (byEmail) => {
      const { tickets } = await lmsTicketsOf(byEmail);
      return {
        available: true,
        tickets: tickets
          .filter((t) => t.status === "open" || t.status === "pending")
          .map((t) => ({ ...t, studentId: String(byEmail.get(String(t.email ?? "").toLowerCase())?._id ?? "") })),
      };
    })
    .catch((err) => {
      kept = null; // a failed ask isn't kept: the next one tries again
      return { available: false, message: lmsTrouble(err), tickets: [] };
    });
  kept = { at: Date.now(), tickets };
  return tickets;
}

export async function csPending(now = Date.now()) {
  const today = businessToday();
  const studentsCol = col("students");
  const [notOnboarded, late, followups, completions, bonusIds, tickets, users, locOf] = await Promise.all([
    studentsCol.find(notOnboardedFilter(), { projection: { _id: 1, created_date: 1, finance_invoice_id: 1 } }).toArray(),
    studentsCol.find(newFromFinanceFilter(now), { projection: { _id: 1 } }).toArray(),
    col("student_followups").find({ ...openFollowupsFilter(), $or: [followupsDueTodayFilter(today), followupsOverdueFilter(today)] },
      { projection: { student_id: 1, stage: 1, next_followup_date: 1, title: 1, target_outcome: 1 } }).toArray(),
    callNeeded(null),
    idsWithBonusPending("pending"),
    openTickets(),
    col("users").find({}, { projection: { full_name: 1, email: 1, app_role: 1, status: 1, team_name: 1 } }).toArray(),
    locations(),
  ]);
  const bonusOf = await bonusPendingOf(bonusIds);

  // Every student anything is about, once — their name, code and CSs.
  const sids = new Set<string>([
    ...(notOnboarded as any[]).map((s) => String(s._id)),
    ...(followups as any[]).map((f) => String(f.student_id ?? "")),
    ...(completions as any[]).map((c) => String(c.student_id ?? "")),
    ...bonusOf.keys(),
    ...tickets.tickets.map((t) => t.studentId),
  ].filter(Boolean));
  const oids = [...sids].map((id) => toObjectId(id)).filter(Boolean) as any[];
  const students = oids.length
    ? ((await studentsCol.find({ _id: { $in: oids } }, { projection: { full_name: 1, student_code: 1, primary_mentor_id: 1, common_cs: 1, team_name: 1 } }).toArray()) as any[])
    : [];
  const studentById = new Map(students.map((s) => [String(s._id), s]));
  const userById = new Map((users as any[]).map((u) => [String(u._id), u]));
  const nameOf = (id: string) => String(userById.get(id)?.full_name || userById.get(id)?.email || "");

  const counts = new Map<string, CsPendingCounts>();
  const team = blank();
  const byLocation: Record<string, CsPendingCounts> = { dubai: blank(), bangalore: blank() };
  const c = (id: string) => counts.get(id) ?? counts.set(id, blank()).get(id)!;
  /** A student's CSs ("No CS yet" for none), each with the student's name and code for the lists. */
  const whoOf = (sid: string) => {
    const s = studentById.get(sid);
    const cs = csOf(s);
    return {
      studentId: sid, student: String(s?.full_name ?? ""), code: String(s?.student_code ?? ""),
      csIds: cs.length ? cs : [NO_CS], cs: cs.map((id) => ({ id, name: nameOf(id) })),
      location: cs.length ? locOf(cs[0]!) : "dubai",
    };
  };
  /** Adds to each of the student's CSs, and to the team (and their location) once. */
  const tally = (who: ReturnType<typeof whoOf>, add: (x: CsPendingCounts) => void) => {
    for (const id of who.csIds) add(c(id));
    add(team);
    add(byLocation[who.location] ?? byLocation.dubai!);
  };

  const lateIds = new Set((late as any[]).map((s) => String(s._id)));
  const onboarding = (notOnboarded as any[]).map((s) => {
    const who = whoOf(String(s._id));
    const isLate = lateIds.has(who.studentId);
    tally(who, (x) => { x.onboarding++; if (isLate) x.onboarding_late++; });
    return { ...who, since: String(s.created_date ?? ""), fromFinance: !!s.finance_invoice_id, late: isLate };
  }).sort((a, b) => a.since.localeCompare(b.since));

  const STAGE_KEY: Record<BonusStage, keyof CsPendingCounts> = {
    sent_back: "bonus_sent_back", needs_call: "bonus_needs_call", with_finance: "bonus_with_finance", waiting_broker: "bonus_waiting_broker",
  };
  const bonus = [...bonusOf].map(([sid, p]) => {
    const who = whoOf(sid);
    tally(who, (x) => {
      x.bonus += BONUS_STAGE_KEYS.reduce((n, k) => n + p[k].count, 0);
      x.bonus_usd = cents(x.bonus_usd + p.total_usd);
      for (const k of BONUS_STAGE_KEYS) x[STAGE_KEY[k]] += p[k].count;
    });
    return {
      ...who, count: BONUS_STAGE_KEYS.reduce((n, k) => n + p[k].count, 0), usd: p.total_usd, stage: p.stage, since: p.since ?? "",
      stages: Object.fromEntries(BONUS_STAGE_KEYS.filter((k) => p[k].count > 0).map((k) => [k, p[k]])),
    };
  }).sort((a, b) => a.since.localeCompare(b.since));

  const ticketRows = tickets.tickets.filter((t) => t.studentId).map((t) => {
    const who = whoOf(t.studentId);
    const waitingOnStudent = t.status === "pending";
    tally(who, (x) => { waitingOnStudent ? x.tickets_waiting++ : x.tickets_open++; });
    return {
      ...who, ticketId: String(t.id ?? ""), subject: String(t.subject ?? ""), category: String(t.category ?? ""),
      status: waitingOnStudent ? "waiting_on_student" : "waiting_for_answer", openedAt: String(t.openedAt ?? ""),
      lastMessageAt: String(t.lastMessageAt ?? ""), lastFrom: String(t.lastFrom ?? ""),
    };
  }).sort((a, b) => a.lastMessageAt.localeCompare(b.lastMessageAt));

  const followupRows = (followups as any[]).map((f) => {
    const who = whoOf(String(f.student_id ?? ""));
    const due = String(f.next_followup_date ?? "");
    const overdue = due < today;
    tally(who, (x) => { overdue ? x.followups_overdue++ : x.followups_today++; });
    return { ...who, due, overdue, stage: String(f.stage ?? ""), title: String(f.title ?? ""), outcome: String(f.target_outcome ?? "") };
  }).sort((a, b) => a.due.localeCompare(b.due));

  const completionRows = (completions as any[]).map((d) => {
    const who = whoOf(String(d.student_id ?? ""));
    tally(who, (x) => { x.completions++; });
    return {
      ...who, student: who.student || String(d.student_name ?? ""), code: who.code || String(d.student_code ?? ""),
      className: String(d.class?.title ?? ""), course: String(d.class?.course ?? ""), mentor: String(d.class?.mentor ?? ""),
      endedAt: String(d.ended_at ?? ""), since: String(d.notified_at ?? d.ended_at ?? ""),
    };
  }).sort((a, b) => a.endedAt.localeCompare(b.endedAt));

  // Every active CS; anyone else with something waiting.
  const isActive = (u: any) => u?.status !== "inactive";
  for (const u of users as any[]) if (u.app_role === "cs" && isActive(u)) c(String(u._id));
  const total = (x: CsPendingCounts) =>
    x.onboarding + x.bonus + x.tickets_open + x.tickets_waiting + x.followups_today + x.followups_overdue + x.completions;
  const people = [...counts]
    .filter(([id]) => id !== NO_CS && userById.has(id))
    .map(([id, x]) => {
      const u = userById.get(id);
      return {
        id, name: nameOf(id) || "Unknown", email: String(u.email ?? "").trim().toLowerCase(), role: String(u.app_role ?? ""),
        team: String(u.team_name ?? ""), active: isActive(u), location: locOf(id), counts: x, total: total(x),
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const none = counts.get(NO_CS);

  return {
    today,
    generatedAt: new Date(now).toISOString(),
    totals: { ...team, total: total(team) },
    totalsByLocation: Object.fromEntries(Object.entries(byLocation).map(([k, x]) => [k, { ...x, total: total(x) }])),
    people,
    noCs: none ? { counts: none, total: total(none) } : null,
    tickets: { available: tickets.available, ...(tickets.message ? { message: tickets.message } : {}) },
    items: { onboarding, bonus, tickets: ticketRows, followups: followupRows, completions: completionRows },
  };
}
