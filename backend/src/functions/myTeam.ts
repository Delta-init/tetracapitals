import { json } from "../lib/response";
import { visibleMentorIds } from "../students/followups";
import type { AuthUser } from "../auth/middleware";

/**
 * POST /api/functions/getMyTeamCsIds → { all, ids } — whose students this person works with, as the follow-ups and the
 * Students page's Team tab have it: a Chief Mentor or CS Manager the CSs under them (themselves too), a CS their own,
 * admins everyone (`all`). The student page opens a student when their CS is one of these (2026-10-08).
 */
export async function getMyTeamCsIds(_req: Request, user: AuthUser): Promise<Response> {
  const ids = await visibleMentorIds(user);
  return json(ids === null ? { all: true, ids: [] } : { all: false, ids: [...ids] });
}
