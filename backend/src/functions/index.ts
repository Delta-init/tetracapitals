import { json, notFound, forbidden, unauthorized } from "../lib/response";
import { getAuthUser } from "../auth/middleware";
import { getAllUsers } from "./getAllUsers";
import { updateUser } from "./updateUser";
import { createUser } from "./createUser";
import { getNextStudentCode } from "./getNextStudentCode";
import { releaseDailyPayout } from "./releaseDailyPayout";
import { resetUserPassword } from "./resetUserPassword";
import { masterEditTransaction, masterDeleteTransaction, masterBulkEditTransactions } from "./masterEditTransaction";
import { wipeData } from "./wipeData";
import { getReportsData } from "./getReportsData";
import { getMentorCommissions } from "./getMentorCommissions";
import { generateQuarterlyLedgers } from "./generateQuarterlyLedgers";
import { autoCloseResolvedTickets, checkTicketEscalation, sendTicketNotification } from "./tickets";
import { createReferralRequest, processReferralResponse, processWithdrawal, updateCoMentorContribution } from "./referrals";
import { creditCommission } from "./creditCommission";
import { releaseCommission } from "./releaseCommission";
import { approveCommissionPeriod } from "./approveCommissionPeriod";
import { distributeDepositPool } from "./distributeDepositPool";
import { searchStudents } from "./searchStudents";
import { getStudentHistory } from "./getStudentHistory";
import { reassignStudents } from "./reassignStudents";
import { getStudentMoves } from "./getStudentMoves";
import { getFollowups, createFollowup, logFollowup, getFollowupTeams } from "./studentFollowups";
import { getReminderLog, resendReminder, runRemindersNow, sendTestReminder } from "./followupReminders";
import { getCalls, getCallRecording, syncCallsNow, testThreecx } from "./studentCalls";
import { setEnrolment } from "./studentEnrolment";
import { getStudentTags, setStudentTag } from "./studentTags";
import {
  getWhatsAppStatus, connectWhatsApp, disconnectWhatsApp, getWhatsAppChats, getWhatsAppMessages, markWhatsAppRead,
  sendWhatsApp, sendWhatsAppFile, linkWhatsAppChat, getStudentWhatsApp,
} from "./whatsapp";
import { getMentorSchedule, getMentorClass, bookMentorMeeting, getMentorMeeting, updateMentorMeeting, cancelMentorMeeting } from "./mentorCalendar";
import { getInactivityTransfer, setInactivityTransfer, runInactivityTransfer } from "./inactivityTransfer";
import { financeFundingConfigured } from "../finance/funding";
import type { AuthUser } from "../auth/middleware";

type AuthedHandler = (req: Request, user: AuthUser) => Promise<Response>;
type AnonHandler = (req: Request) => Promise<Response>;

const AUTHED: Record<string, AuthedHandler> = {
  getAllUsers,
  reassignStudents,
  getStudentMoves,
  getFollowups,
  createFollowup,
  logFollowup,
  getFollowupTeams,
  getReminderLog,
  resendReminder,
  runRemindersNow,
  sendTestReminder,
  getCalls,
  getCallRecording,
  syncCallsNow,
  testThreecx,
  getMentorSchedule,
  getMentorClass,
  bookMentorMeeting,
  getMentorMeeting,
  updateMentorMeeting,
  cancelMentorMeeting,
  setEnrolment,
  getStudentTags,
  setStudentTag,
  getWhatsAppStatus,
  connectWhatsApp,
  disconnectWhatsApp,
  getWhatsAppChats,
  getWhatsAppMessages,
  markWhatsAppRead,
  sendWhatsApp,
  sendWhatsAppFile,
  linkWhatsAppChat,
  getStudentWhatsApp,
  getInactivityTransfer,
  setInactivityTransfer,
  runInactivityTransfer,
  updateUser,
  createUser,
  getReportsData,
  getMentorCommissions,
  sendTicketNotification,
  createReferralRequest,
  processReferralResponse,
  processWithdrawal,
  updateCoMentorContribution,
  getNextStudentCode,
  releaseDailyPayout,
  resetUserPassword,
  masterEditTransaction,
  masterDeleteTransaction,
  masterBulkEditTransactions,
  creditCommission,
  releaseCommission,
  approveCommissionPeriod,
  distributeDepositPool,
  searchStudents,
  getStudentHistory,
  // Whether new deposits go to Delta finance for approval — the pages follow the server's switch.
  getFinanceLink: async () => json({ depositsToFinance: financeFundingConfigured() }),
  wipeData,
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
