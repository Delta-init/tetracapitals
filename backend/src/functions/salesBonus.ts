import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { visibleMentorIds, isStudentOf } from "../students/followups";
import { recordHistory } from "../students/history";
import { MT5_LOGIN, mt5LoginOf, keepMt5 } from "../students/mt5";
import { notifyBonusVerifiers } from "../students/bonusVerifyAlerts";

/**
 * POST /api/functions/resubmitSalesBonus { transactionId, note?, mt5Login? }
 * → { ok, status: "PENDING", mt5_login }
 *
 * A sales-close MT5 bonus a broker admin rejected, submitted again (the user, 2026-10-04): back to pending for a broker
 * admin or a Super Admin to decide, with a note on what was put right — and another MT5 login when the rejection was
 * about the account (kept as the student's, as the call log keeps one; another student's is refused). The rejection is
 * kept in the request's `rejections`, the step in the student's history, and the verifiers are told at once.
 *
 * By the student's CS (or a CS they are Common with), the people above them and admins — the same people who onboard
 * them (studentOnboarding.ts). The Sales role only reads (functions/index.ts).
 */
const who = (u: AuthUser) => u.full_name || u.email || "somebody";

export async function resubmitSalesBonus(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => null);
  const oid = toObjectId(String(body?.transactionId ?? ""));
  if (!oid) return error("transactionId is required", 400);
  const tx: any = await col("funding_transactions").findOne({ _id: oid });
  if (!tx || tx.type !== "BONUS" || tx.bonus_credit !== "sales_close") return notFound();
  if (String(tx.status ?? "").toUpperCase() !== "REJECTED") return error("Only a rejected bonus can be submitted again", 409);

  const studentOid = toObjectId(String(tx.student_id ?? ""));
  const student: any = studentOid ? await col("students").findOne({ _id: studentOid }) : null;
  if (!student) return notFound();
  const visible = await visibleMentorIds(user);
  if (visible && !isStudentOf(student, visible)) {
    return forbidden("Only this student's CS (or a CS they are Common with), the people above them and admins can submit their bonus again");
  }

  const note = String(body?.note ?? "").trim().slice(0, 1000);
  let login = String(tx.mt5_login ?? "");
  if (body?.mt5Login !== undefined && String(body.mt5Login).trim()) {
    const wanted = mt5LoginOf(body.mt5Login);
    if (!MT5_LOGIN.test(wanted)) return error("That is not an MT5 login — 4 to 15 digits", 400);
    if (wanted !== login) {
      const kept = await keepMt5(student, wanted, { email: user.email, name: who(user) }, "bonus resubmitted");
      if (kept === "taken") return error("That MT5 login is another student's", 409);
      login = wanted;
    }
  }

  const now = new Date().toISOString();
  const res = await col("funding_transactions").updateOne(
    { _id: oid, status: "REJECTED" },
    {
      $set: {
        status: "PENDING", mt5_login: login, resubmitted_at: now, resubmitted_by_id: user.id, resubmitted_by_name: who(user),
        updated_date: now,
      },
      $unset: {
        approved_by_id: "", approved_by_name: "", approved_at: "", rejected_at: "", rejected_by_id: "", rejected_by_name: "",
        rejection_reason: "", verify_alerted_at: "",
      },
      $inc: { resubmit_count: 1 },
      $push: {
        rejections: {
          reason: String(tx.rejection_reason ?? ""),
          by: String(tx.rejected_by_name ?? tx.approved_by_name ?? ""),
          at: tx.rejected_at ?? tx.approved_at ?? null,
          resubmitted_at: now,
          resubmitted_by: who(user),
          note,
        },
      },
    } as any,
  );
  if (!res.modifiedCount) return error("It was changed meanwhile — refresh and try again", 409);

  await recordHistory([{
    student_id: String(student._id),
    at: now,
    type: "onboarding_changed",
    text: `MT5 bonus submitted again by ${who(user)}${note ? ` — ${note}` : ""}${login !== String(tx.mt5_login ?? "") ? ` (MT5 ${login})` : ""}`,
    by_id: user.id,
    by_name: who(user),
  }]);
  void notifyBonusVerifiers({
    type: "bonus_verification",
    title: `MT5 bonus submitted again: ${student.full_name || student.student_code || "a student"}`,
    body: `${who(user)} submitted it again${note ? ` — ${note}` : ""}. Their onboarding waits for it.`,
    link: "/FundingRequests",
    tag: `bonus-${String(oid)}`,
  });
  return json({ ok: true, status: "PENDING", mt5_login: login });
}
