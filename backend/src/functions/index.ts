import { json, notFound, forbidden, unauthorized } from "../lib/response";
import { getAuthUser } from "../auth/middleware";
import { getAllUsers } from "./getAllUsers";
import { updateUser } from "./updateUser";
import { createUser } from "./createUser";
import { getNextStudentCode } from "./getNextStudentCode";
import { releaseDailyPayout } from "./releaseDailyPayout";
import { resetUserPassword } from "./resetUserPassword";
import { setUserStatus } from "./setUserStatus";
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
import { getFollowups, createFollowup, logFollowup, addFollowupNote, getFollowupTeams } from "./studentFollowups";
import { getReminderLog, resendReminder, runRemindersNow, sendTestReminder } from "./followupReminders";
import { getCalls, getCallRecording, syncCallsNow, testThreecx, getClickToCall, callStudent, getMyCallState, hangUpMyCall } from "./studentCalls";
import { getTransferPeople, transferStudent } from "./studentTransfer";
import { getDashboardTotals } from "./dashboardTotals";
import { getLmsExams, getStudentLmsExams } from "./lmsExams";
import { previewCourseLms } from "./lmsPreview";
import { sendFundingBack, correctFundingRequest, setFundingTransactionId } from "./fundingCorrections";
import { getMoneyReport, getFundingRequestReport, getBonusReport, getReportFilters } from "./reports";
import { getLedgerBreakdown } from "./commissionLedgerBreakdown";
import { getStudentWorkflow, getStudentWorkflowStudents } from "./studentWorkflow";
import { setEnrolment, setStudentPriority, getLmsEnrolment, syncLmsEnrolmentNow } from "./studentEnrolment";
import { updateStudentDetails } from "./studentDetails";
import { getOnboardingDraft, setOnboarding } from "./studentOnboarding";
import { getNotOnboarded } from "./notOnboarded";
import { getBalancePayments, recordBalancePayment } from "./balancePayments";
import { resubmitSalesBonus } from "./salesBonus";
import { getBonusApprovals } from "./bonusApprovals";
import { getCoursePriceList, saveCoursePriceList, getStudentCourses, setStudentCourses, startCourseUpgrade, cancelCourseUpgrade, listCourseUpgrades, recordCoursePayment, getUpgradeLmsPlan, applyUpgradeLms, listCoursePaymentRequests } from "./courseUpgrades";
import { getStudentClasses } from "./lmsClasses";
import { getStudentLmsSupport, getLmsSupportTickets, getLmsSupportTicketCount, answerLmsTicket, resolveLmsTicket } from "./lmsSupport";
import {
  getLmsEnrolmentRequests, getLmsEnrolmentRequestCount, getLmsEnrolmentRequest, getLmsEnrolmentDocument,
  approveLmsEnrolmentRequest, rejectLmsEnrolmentRequest, viewStudentInLms, assignLmsApplicant,
} from "./lmsEnrolmentRequests";
import { getSalesBonusToSend, sendSalesBonusCredit } from "./salesBonusSend";
import { getCreditRequestOptions, raiseCreditRequest, listCreditRequests, decideCreditRequest } from "./creditRequests";
import { getCourseCommissionSummary } from "./courseCommissionSummary";
import { getCsLeaderboard } from "./csLeaderboard";
import { getMyCurrency } from "./myCurrency";
import { removeStudentMt5, setPrimaryMt5 } from "./studentMt5";
import { markNotStudent, unmarkNotStudent, listNotStudents } from "./notStudent";
import { getStudentEmails, getStudentEmail } from "./studentEmails";
import { getInstructorReviews, getInstructorReviewList } from "./instructorReviews";
import { getMentorReport, getMentorReportDetails } from "./mentorReport";
import { getPendingMeetingOutcomes, getMeetingOutcomeOptions, saveMeetingOutcome, getStudentMeetingOutcomes } from "./meetingOutcomes";
import { getVoiceRecordings, saveVoiceRecording, deleteVoiceRecording } from "./voiceRecordings";
import { getCsTvLink } from "./csTv";
import { getLmsCourseAccess, giveLmsCourses, setLmsModuleAccess } from "./lmsCourseAccess";
import { getClassCompletions } from "./classCompletions";
import { getMyTeamCsIds } from "./myTeam";
import { getStudentZohoInvoices, listZohoInvoices, getZohoInvoiceOptions, linkZohoInvoice, getStudentInvoicesForLink, listFinanceInvoices } from "./zohoInvoices";
import { getStudentLmsCourses } from "./lmsCourses";
import { getStudentTags, setStudentTag } from "./studentTags";
import { getPushConfig, savePushSubscription, deletePushSubscription, sendTestPush } from "./push";
import { getNavCounts, markStudentSeen } from "./navCounts";
import { getTabbyLinks, createTabbyLink, cancelTabbyLink } from "./tabbyLinks";
import { getPaymentLinks, requestPaymentLink, approvePaymentLink, rejectPaymentLink, cancelPaymentLinkRequest, retryPaymentLink } from "./paymentLinks";
import { listStudents, getStudentListOptions, findStudentByEmail, getStudentBonusPending } from "./studentsList";
import { listStudentLogs, listStudentLogHistory, listTransactions } from "./pagedLists";
import {
  getWhatsAppStatus, connectWhatsApp, disconnectWhatsApp, getWhatsAppChats, getWhatsAppMessages, markWhatsAppRead,
  sendWhatsApp, sendWhatsAppFile, linkWhatsAppChat, getStudentWhatsApp, getWhatsAppUnread,
} from "./whatsapp";
import { listPrograms, searchProgramStudents, createProgram, changeProgramStudents, rescheduleProgram, stopProgram, resendProgramNotice, setProgramResponse, getProgramAudiences, addProgramGuestToLms } from "./programs";
import { getMentorSchedule, getMentorClass, bookMentorMeeting, getMentorMeeting, updateMentorMeeting, cancelMentorMeeting, markMentorTimeOff, removeMentorTimeOff } from "./mentorCalendar";
import { getInactivityTransfer, setInactivityTransfer, runInactivityTransfer } from "./inactivityTransfer";
import { financeFundingConfigured } from "../finance/funding";
import { seesClosedOnly, salesMayCall, SALES_READ_ONLY } from "../students/closedBy";
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
  addFollowupNote,
  getFollowupTeams,
  getReminderLog,
  resendReminder,
  runRemindersNow,
  sendTestReminder,
  getCalls,
  getCallRecording,
  syncCallsNow,
  testThreecx,
  getClickToCall,
  callStudent,
  getMyCallState,
  hangUpMyCall,
  getMentorSchedule,
  listPrograms,
  searchProgramStudents,
  createProgram,
  changeProgramStudents,
  rescheduleProgram,
  stopProgram,
  resendProgramNotice,
  setProgramResponse,
  getMentorClass,
  bookMentorMeeting,
  getMentorMeeting,
  updateMentorMeeting,
  cancelMentorMeeting,
  markMentorTimeOff,
  removeMentorTimeOff,
  setEnrolment,
  setStudentPriority,
  getTransferPeople,
  transferStudent,
  getDashboardTotals,
  getLmsExams,
  getStudentLmsExams,
  previewCourseLms,
  sendFundingBack,
  correctFundingRequest,
  // An approved request's transaction ID corrected on MT5 Approvals (broker admin, Super Admin)
  setFundingTransactionId,
  getMoneyReport,
  getFundingRequestReport,
  getBonusReport,
  getReportFilters,
  // What is behind a quarterly commission ledger on Commission Reports (2026-10-27)
  getLedgerBreakdown,
  // The student workflow chart, and the students behind a box (2026-10-20)
  getStudentWorkflow,
  getStudentWorkflowStudents,
  updateStudentDetails,
  getOnboardingDraft,
  setOnboarding,
  getNotOnboarded,
  // Balance payments: what students still owe on finance's courses, and the next payment recorded (balancePayments.ts)
  getBalancePayments,
  recordBalancePayment,
  resubmitSalesBonus,
  getBonusApprovals,
  // CSE course upgrades: the price list, a student's courses, starting one (courseUpgrades.ts)
  getCoursePriceList,
  saveCoursePriceList,
  getStudentCourses,
  setStudentCourses,
  startCourseUpgrade,
  cancelCourseUpgrade,
  listCourseUpgrades,
  recordCoursePayment,
  getUpgradeLmsPlan,
  applyUpgradeLms,
  getLmsEnrolment,
  syncLmsEnrolmentNow,
  getStudentClasses,
  getStudentLmsSupport,
  getLmsSupportTickets,
  getLmsSupportTicketCount,
  getClassCompletions,
  getMyTeamCsIds,
  // Zoho Books invoices 2024–2026 (zohoInvoices.ts)
  getStudentZohoInvoices,
  listZohoInvoices,
  getZohoInvoiceOptions,
  linkZohoInvoice,
  getStudentInvoicesForLink,
  listFinanceInvoices,
  answerLmsTicket,
  resolveLmsTicket,
  // LMS enrolment requests, decided here (lmsEnrolmentRequests.ts)
  getLmsEnrolmentRequests,
  getLmsEnrolmentRequestCount,
  getLmsEnrolmentRequest,
  getLmsEnrolmentDocument,
  approveLmsEnrolmentRequest,
  rejectLmsEnrolmentRequest,
  // …and given to a CS when nobody's yet (CS Manager, Super Admin)
  assignLmsApplicant,
  // A sales-close bonus sent for credit from its Bonus pending badge (salesBonusSend.ts)
  getSalesBonusToSend,
  sendSalesBonusCredit,
  // Bonus not credited yet — raised to the broker admins, answered on their page (creditRequests.ts)
  getCreditRequestOptions,
  raiseCreditRequest,
  listCreditRequests,
  decideCreditRequest,
  // A CS's / CS Manager's course upgradation summary on Funding Activities (courseCommissionSummary.ts)
  getCourseCommissionSummary,
  // The CS and team leaderboards (csLeaderboard.ts)
  getCsLeaderboard,
  getMyCurrency,
  removeStudentMt5,
  setPrimaryMt5,
  markNotStudent,
  getStudentEmails,
  getInstructorReviews,
  getMentorReport,
  getMentorReportDetails,
  getPendingMeetingOutcomes,
  getMeetingOutcomeOptions,
  saveMeetingOutcome,
  getStudentMeetingOutcomes,
  getVoiceRecordings,
  saveVoiceRecording,
  deleteVoiceRecording,
  getCsTvLink,
  getInstructorReviewList,
  getStudentEmail,
  getProgramAudiences,
  addProgramGuestToLms,
  unmarkNotStudent,
  listNotStudents,
  // The bonus course payments, on the Course Upgrades page (courseUpgrades.ts)
  listCoursePaymentRequests,
  // A student's own LMS, read-only — from LMS Requests and the student page
  viewStudentInLms,
  // Their LMS courses: put on Forex courses, modules opened or locked (lmsCourseAccess.ts)
  getLmsCourseAccess,
  giveLmsCourses,
  setLmsModuleAccess,
  getStudentLmsCourses,
  getStudentTags,
  setStudentTag,
  getPushConfig,
  savePushSubscription,
  deletePushSubscription,
  sendTestPush,
  getNavCounts,
  markStudentSeen,
  getTabbyLinks,
  createTabbyLink,
  cancelTabbyLink,
  getPaymentLinks,
  requestPaymentLink,
  approvePaymentLink,
  rejectPaymentLink,
  cancelPaymentLinkRequest,
  retryPaymentLink,
  listStudents,
  getStudentListOptions,
  findStudentByEmail,
  getStudentBonusPending,
  listStudentLogs,
  listStudentLogHistory,
  listTransactions,
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
  getWhatsAppUnread,
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
  setUserStatus,
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
    // The Sales role reads (students/closedBy.ts) — whatever a function would otherwise let anyone signed in do.
    if (!salesMayCall(name) && (await seesClosedOnly(user))) return forbidden(SALES_READ_ONLY);
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
