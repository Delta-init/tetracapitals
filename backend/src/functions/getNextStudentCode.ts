import { json } from "../lib/response";
import { nextStudentCode } from "../lib/studentCode";

/**
 * POST /api/functions/getNextStudentCode
 * Body: {} (ignored)
 * Returns: { code: 'STU-0042' }
 *
 * The next code from the shared atomic counter — see lib/studentCode.ts, which
 * students arriving from Delta finance draw from as well.
 */
// Signature matches the AUTHED dispatcher's (req, user) shape, but we don't read
// the body — every authenticated user (including mentors) can request a code.
export async function getNextStudentCode(_req: Request, _user: unknown): Promise<Response> {
  return json({ code: await nextStudentCode() });
}
