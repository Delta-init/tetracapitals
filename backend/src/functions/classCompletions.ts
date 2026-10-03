import { col } from "../db";
import { json } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { visibleMentorIds, studentsOf } from "../students/followups";
import { COMPLETIONS, settleCalls } from "../students/classCompletions";

const SHOWN_DAYS = 60;

/**
 * POST /api/functions/getClassCompletions
 * The live classes students attended that are over, once their CS has been told (students/classCompletions.ts) —
 * a CS's own students (Common ones too), a Chief Mentor's or CS Manager's people's, everyone's for admin roles,
 * as the follow-ups — the last SHOWN_DAYS days, the latest class first. Each says whether a call has been logged
 * since the class ended (a follow-up Log, or a 3CX call), with the student's numbers to call them.
 * → { completions, counts: { open, called } }
 */
export async function getClassCompletions(_req: Request, user: AuthUser): Promise<Response> {
  const now = new Date();
  const filter: Record<string, any> = {
    notified_at: { $exists: true },
    ended_at: { $gte: new Date(now.getTime() - SHOWN_DAYS * 86_400_000).toISOString() },
  };
  const visible = await visibleMentorIds(user);
  if (visible) {
    const ids = (await col("students").find(studentsOf(visible), { projection: { _id: 1 } }).toArray()).map((s) => String(s._id));
    filter.student_id = { $in: ids };
  }
  const docs = await settleCalls((await col(COMPLETIONS).find(filter as any).sort({ ended_at: -1 }).limit(1000).toArray()) as any[]);

  const oids = [...new Set(docs.map((d) => d.student_id))].map(toObjectId).filter(Boolean);
  const students = oids.length
    ? ((await col("students").find({ _id: { $in: oids as any[] } }, { projection: { full_name: 1, student_code: 1, phone: 1, primary_mentor_id: 1, primary_mentor_name: 1, team_name: 1 } }).toArray()) as any[])
    : [];
  const byId = new Map(students.map((s) => [String(s._id), s]));

  const completions = docs.map((d) => {
    const s = byId.get(d.student_id);
    return {
      id: String(d._id),
      student: {
        id: d.student_id,
        name: String(s?.full_name ?? d.student_name ?? "").trim(),
        code: String(s?.student_code ?? d.student_code ?? ""),
        phone: String(s?.phone ?? ""),
        cs_id: String(s?.primary_mentor_id ?? ""),
        cs: String(s?.primary_mentor_name ?? ""),
        team: String(s?.team_name ?? ""),
      },
      class: d.class ?? {},
      ended_at: d.ended_at,
      notified_at: d.notified_at ?? null,
      told_to: d.told_to ?? "",
      told: (d.told ?? []).map((t: any) => t.name).filter(Boolean),
      called_at: d.called_at ?? null,
      called_via: d.called_via ?? "",
      called_by: d.called_by ?? "",
    };
  });
  return json({
    completions,
    counts: { open: completions.filter((c) => !c.called_at).length, called: completions.filter((c) => c.called_at).length },
  });
}
