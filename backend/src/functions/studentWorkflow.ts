import type { AuthUser } from "../auth/middleware";
import { json, error } from "../lib/response";
import { reportCtx } from "./reports";
import { studentWorkflow, studentWorkflowStudents, isWorkflowBox } from "../students/studentWorkflow";

/* The student workflow chart (2026-10-20; students/studentWorkflow.ts) — the Reports section's filters and reach:
   admins everything, a CS Manager their location, a team leader their team, a CS their own. */

/** POST /api/functions/getStudentWorkflow { period | from&to, location, team, cs } */
export async function getStudentWorkflow(req: Request, user: AuthUser): Promise<Response> {
  const ctx = await reportCtx(await req.json().catch(() => ({})), user);
  if (ctx instanceof Response) return ctx;
  return json(await studentWorkflow(ctx));
}

/** POST /api/functions/getStudentWorkflowStudents { …the same, box | stage, teamId?, csId? } — the students behind one box. */
export async function getStudentWorkflowStudents(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const ctx = await reportCtx(body, user);
  if (ctx instanceof Response) return ctx;
  if (body?.box !== undefined && !isWorkflowBox(body.box)) return error("Unknown box", 400);
  return json(await studentWorkflowStudents(ctx, {
    box: body?.box, stage: body?.stage ? String(body.stage).slice(0, 40) : undefined,
    teamId: body?.teamId === undefined ? undefined : String(body.teamId).slice(0, 40),
    csId: body?.csId ? String(body.csId).slice(0, 40) : undefined,
  }));
}
