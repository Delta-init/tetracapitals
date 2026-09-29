import { json, error, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { isAdminRole } from "../lib/roles";
import { findDue, getSettings, runInactivity, saveSettings } from "../students/inactivity";

/**
 * POST /api/functions/getInactivityTransfer — admin roles.
 * Returns the rule's settings, how many students it watches, and who is due now.
 */
export async function getInactivityTransfer(_req: Request, user: AuthUser): Promise<Response> {
  if (!isAdminRole(user.app_role)) return forbidden();
  const settings = await getSettings();
  const { watched, due } = await findDue(settings.days);
  return json({ settings, watched, due });
}

/**
 * POST /api/functions/setInactivityTransfer — Super Admin.
 * Body: { enabled?: boolean, days?: number (30–365) }
 */
export async function setInactivityTransfer(req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_by_name: user.full_name || user.email, updated_date: new Date().toISOString() };
  if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
  if (body?.days !== undefined) {
    const d = Number(body.days);
    if (!Number.isInteger(d) || d < 30 || d > 365) return error("days must be a whole number from 30 to 365", 400);
    patch.days = d;
  }
  return json({ settings: await saveSettings(patch) });
}

/** POST /api/functions/runInactivityTransfer — Super Admin: run the rule now. */
export async function runInactivityTransfer(_req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  return json(await runInactivity(user));
}
