import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { isAdmin, visibleMentorIds, isStudentOf } from "../students/followups";
import { csManagerReach } from "../lib/userLocation";
import { loadTeams } from "../students/teams";

/* ────────────────────────────────────────────────────────────────────────────
   Reminders (the user, 2026-10-28: "a reminder page for everyone, like the
   sales portals"): anyone signed in sets their own — a title, a note, a date
   and time, and a student if it is about one — and is told on the bell, their
   phone and the browser 15 minutes before and at the time
   (students/reminderWorker.ts). The page shows them Overdue, Due soon, Today,
   Upcoming and Done; only whoever set one changes it.

   Team reminders, view only (as the Delta sales CRM's): a Chief Mentor their
   team's, a CS Manager their location's, admin roles everyone's.
──────────────────────────────────────────────────────────────────────────── */

export const REMINDERS = "reminders";
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const CAP = 1000;

/** Not done and due by the end of today (Dubai): what the sidebar counts. */
export const dueTodayFilter = (userId: string, now = Date.now()) => {
  const d = new Date(now + 4 * 3_600_000);
  const endOfDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - 4 * 3_600_000);
  return { owner_id: userId, done: { $ne: true }, remind_at: { $lt: endOfDay.toISOString() } };
};

const shape = (r: any) => ({
  id: String(r._id), owner_id: r.owner_id, owner_name: r.owner_name ?? "", title: r.title ?? "", note: r.note ?? "", remind_at: r.remind_at,
  student_id: r.student_id ?? "", student_name: r.student_name ?? "", student_code: r.student_code ?? "",
  done: r.done === true, done_at: r.done_at ?? null, done_note: r.done_note ?? "", created_at: r.created_at ?? null,
  warned_at: r.warned_at ?? null, notified_at: r.notified_at ?? null,
});

/** The student a reminder may be about: one this person can see — or a refusal. */
async function studentFor(id: string, user: AuthUser): Promise<any | Response | null> {
  if (!id) return null;
  const oid = toObjectId(id);
  if (!oid) return error("That student isn't known", 400);
  const s: any = await col("students").findOne({ _id: oid }, { projection: { full_name: 1, student_code: 1, primary_mentor_id: 1, common_cs: 1 } });
  if (!s) return error("That student isn't known", 400);
  if (isAdmin(user)) return s;
  const reach = await csManagerReach(user);
  if (reach) return reach.ids.includes(String(s.primary_mentor_id ?? "")) || (s.common_cs ?? []).some((c: any) => reach.ids.includes(String(c?.id ?? ""))) ? s : forbidden("Only a student you can see");
  const visible = await visibleMentorIds(user);
  return !visible || isStudentOf(s, visible) ? s : forbidden("Only a student you can see");
}

/** A time the browser sent (ISO), or null. */
const whenOf = (v: unknown) => { const t = Date.parse(String(v ?? "")); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** POST /api/functions/getMyReminders { state?: "active" | "done" | "all" } → { reminders } — your own, soonest first. */
export async function getMyReminders(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const state = ["active", "done", "all"].includes(body?.state) ? body.state : "all";
  const filter: Record<string, unknown> = { owner_id: user.id, ...(state === "active" ? { done: { $ne: true } } : state === "done" ? { done: true } : {}) };
  const rows = (await col(REMINDERS).find(filter).sort({ remind_at: 1 }).limit(CAP).toArray()) as any[];
  return json({ reminders: rows.map(shape), capped: rows.length >= CAP });
}

/** POST /api/functions/getStudentReminders { studentId } → { reminders } — your own about that student. */
export async function getStudentReminders(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const studentId = str(body?.studentId, 40);
  if (!studentId) return error("studentId is required", 400);
  const rows = (await col(REMINDERS).find({ owner_id: user.id, student_id: studentId }).sort({ remind_at: 1 }).limit(200).toArray()) as any[];
  return json({ reminders: rows.map(shape) });
}

/** POST /api/functions/saveReminder { id?, title, note?, remindAt, studentId? } — a new one, or a change to your own. */
export async function saveReminder(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const title = str(body?.title, 200), note = str(body?.note, 1000), remindAt = whenOf(body?.remindAt);
  if (!title) return error("Give the reminder a title", 400);
  if (!remindAt) return error("Pick a date and time", 400);
  const s = await studentFor(str(body?.studentId, 40), user);
  if (s instanceof Response) return s;
  const now = new Date().toISOString();
  const fields = {
    title, note, remind_at: remindAt,
    student_id: s ? String(s._id) : "", student_name: s ? String(s.full_name ?? "").trim() : "", student_code: s ? String(s.student_code ?? "") : "",
    updated_at: now,
  };
  if (body?.id) {
    const oid = toObjectId(String(body.id));
    const r: any = oid ? await col(REMINDERS).findOne({ _id: oid }) : null;
    if (!r) return notFound();
    if (r.owner_id !== user.id) return forbidden("Only whoever set a reminder changes it");
    // A new time is told again.
    const retime = r.remind_at !== remindAt ? { warned_at: null, notified_at: null } : {};
    await col(REMINDERS).updateOne({ _id: oid as any }, { $set: { ...fields, ...retime } });
    return json({ reminder: shape({ ...r, ...fields, ...retime }) });
  }
  const doc = { owner_id: user.id, owner_name: user.full_name || user.email || "", ...fields, done: false, created_at: now, warned_at: null, notified_at: null };
  const ins = await col(REMINDERS).insertOne(doc as any);
  return json({ reminder: shape({ ...doc, _id: ins.insertedId }) });
}

/** POST /api/functions/setReminderDone { id, done: boolean, note? } — mark your own done (with what came of it) or open again. */
export async function setReminderDone(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.id ?? ""));
  const r: any = oid ? await col(REMINDERS).findOne({ _id: oid }) : null;
  if (!r) return notFound();
  if (r.owner_id !== user.id) return forbidden("Only whoever set a reminder changes it");
  const done = body?.done !== false;
  const set = done ? { done: true, done_at: new Date().toISOString(), done_note: str(body?.note, 1000) } : { done: false, done_at: null, done_note: "" };
  await col(REMINDERS).updateOne({ _id: oid as any }, { $set: set });
  return json({ reminder: shape({ ...r, ...set }) });
}

/** POST /api/functions/deleteReminder { id } — your own. */
export async function deleteReminder(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.id ?? ""));
  const r: any = oid ? await col(REMINDERS).findOne({ _id: oid }, { projection: { owner_id: 1 } }) : null;
  if (!r) return notFound();
  if (r.owner_id !== user.id) return forbidden("Only whoever set a reminder deletes it");
  await col(REMINDERS).deleteOne({ _id: oid as any });
  return json({ ok: true });
}

/** Whose reminders this person may look at besides their own: everyone (null), these people, or none. */
async function teamReach(user: AuthUser): Promise<{ kind: "all" } | { kind: "some"; ids: string[] } | { kind: "none" }> {
  if (isAdmin(user)) return { kind: "all" };
  const reach = await csManagerReach(user);
  if (reach) return { kind: "some", ids: reach.ids };
  const visible = await visibleMentorIds(user);
  if (!visible) return { kind: "all" };
  const others = [...visible].filter((id) => id !== user.id);
  return others.length ? { kind: "some", ids: [...visible] } : { kind: "none" };
}

/**
 * POST /api/functions/getTeamReminders { person?, team?, state?: "active" | "done" | "all" } → { scope, reminders, people, teams }
 * Other people's reminders, view only — nothing of anyone else's for someone with no one under them.
 */
export async function getTeamReminders(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const reach = await teamReach(user);
  if (reach.kind === "none") return forbidden("You can only see your own reminders");
  const index = await loadTeams();
  const state = ["active", "done", "all"].includes(body?.state) ? body.state : "active";
  const filter: Record<string, any> = state === "active" ? { done: { $ne: true } } : state === "done" ? { done: true } : {};
  let owners: string[] | null = reach.kind === "some" ? reach.ids : null;
  const team = str(body?.team, 40);
  if (team) {
    const inTeam = [...index.userById.keys()].filter((id) => index.teamOf(id)?.id === team);
    owners = owners ? owners.filter((id) => inTeam.includes(id)) : inTeam;
  }
  const person = str(body?.person, 40);
  if (person) owners = owners ? owners.filter((id) => id === person) : [person];
  if (owners) filter.owner_id = { $in: owners };
  const rows = (await col(REMINDERS).find(filter).sort({ remind_at: state === "done" ? -1 : 1 }).limit(CAP).toArray()) as any[];

  // The filters' choices: whoever has reminders here, and their teams.
  const ownerIds = (await col(REMINDERS).distinct("owner_id", reach.kind === "some" ? { owner_id: { $in: reach.ids } } : {})) as string[];
  const nameOf = (id: string) => String(index.userById.get(id)?.full_name || index.userById.get(id)?.email || "Someone");
  const people = ownerIds.map((id) => ({ id, name: nameOf(id), team: index.teamOf(id)?.name ?? "" })).sort((a, b) => a.name.localeCompare(b.name));
  const teams = [...new Map(ownerIds.map((id) => index.teamOf(id)).filter(Boolean).map((t) => [t!.id, { id: t!.id, name: t!.name }])).values()];
  return json({
    scope: reach.kind === "all" ? "all" : "team",
    reminders: rows.map((r) => ({ ...shape(r), owner_name: nameOf(r.owner_id), team: index.teamOf(r.owner_id)?.name ?? "" })),
    capped: rows.length >= CAP, people, teams,
  });
}

/** POST /api/functions/getReminderTeamScope → { scope: "all" | "team" | "none" } — which button the page shows. */
export async function getReminderTeamScope(_req: Request, user: AuthUser): Promise<Response> {
  const reach = await teamReach(user);
  return json({ scope: reach.kind === "all" ? "all" : reach.kind === "some" ? "team" : "none" });
}
