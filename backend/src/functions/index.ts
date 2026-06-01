import { json, notFound, forbidden, unauthorized } from "../lib/response";
import { getAuthUser } from "../auth/middleware";
import { getAllUsers } from "./getAllUsers";
import { updateUser } from "./updateUser";
import { getReportsData } from "./getReportsData";
import { getMentorCommissions } from "./getMentorCommissions";
import { generateQuarterlyLedgers } from "./generateQuarterlyLedgers";
import { autoCloseResolvedTickets, checkTicketEscalation, sendTicketNotification } from "./tickets";
import { createReferralRequest, processReferralResponse, processWithdrawal, updateCoMentorContribution } from "./referrals";
import type { AuthUser } from "../auth/middleware";

type AuthedHandler = (req: Request, user: AuthUser) => Promise<Response>;
type AnonHandler = (req: Request) => Promise<Response>;

const AUTHED: Record<string, AuthedHandler> = {
  getAllUsers,
  updateUser,
  getReportsData,
  getMentorCommissions,
  sendTicketNotification,
  createReferralRequest,
  processReferralResponse,
  processWithdrawal,
  updateCoMentorContribution,
};

// Functions that should still require auth but accept no body of interest.
const AUTHED_NOBODY: Record<string, () => Promise<Response>> = {
  generateQuarterlyLedgers,
  autoCloseResolvedTickets,
  checkTicketEscalation,
};

export async function invokeFunction(req: Request, name: string): Promise<Response> {
  if (AUTHED[name]) {
    const user = await getAuthUser(req);
    if (!user) return unauthorized();
    return AUTHED[name](req, user);
  }
  if (AUTHED_NOBODY[name]) {
    const user = await getAuthUser(req);
    if (!user) return unauthorized();
    // Only admins may trigger maintenance/cron functions ad-hoc.
    if (!["super_admin", "admin", "broker_admin", "academic_head", "finance_admin"].includes(user.app_role)) {
      return forbidden();
    }
    return AUTHED_NOBODY[name]();
  }
  return notFound(`Unknown function '${name}'`);
}

export function listFunctions(): string[] {
  return [...Object.keys(AUTHED), ...Object.keys(AUTHED_NOBODY)];
}
