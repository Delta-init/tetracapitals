import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { serialize, serializeMany, toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";

/**
 * Mentor asks to be added as a co-mentor for another mentor's student.
 * Creates a MentorReferral record and an audit Log entry.
 */
export async function createReferralRequest(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => null);
  if (!body) return error("Body required", 400);
  const {
    student_id, student_name, student_code,
    receiving_mentor_id, receiving_mentor_name,
    requested_deposit_amount, payment_method, mt5_login, screenshot_url, notes,
    transaction_type, tags,
  } = body;
  if (!student_id || !receiving_mentor_id) return error("Missing required fields", 400);
  // Default to DEPOSIT for backwards-compat with the original popup that
  // didn't send a type. New BONUS referrals flow through here too.
  const txType = transaction_type === "BONUS" ? "BONUS" : "DEPOSIT";
  const txTags = Array.isArray(tags) ? tags.filter((t) => typeof t === "string" && t) : [];
  if (txType === "BONUS" && txTags.length === 0) {
    return error("BONUS referrals must include at least one tag", 400);
  }

  const sid = toObjectId(student_id);
  const student = sid ? await col("students").findOne({ _id: sid }) : null;
  // Self-request guard: a mentor can't co-manage their own primary student.
  // Check primary FIRST so the error message is accurate even when they're
  // also already listed in co_mentors_details with role 'primary'.
  if (student && (student as any).primary_mentor_id === user.id) {
    return error("You're already the primary mentor for this client.", 400);
  }
  if (student && (student as any).co_mentors_details) {
    let existing: any[] = [];
    try {
      const raw = (student as any).co_mentors_details;
      existing = Array.isArray(raw) ? raw : JSON.parse(raw);
    } catch { /* ignore */ }
    if (Array.isArray(existing)) {
      // Block duplicate self-requests. Any number of OTHER mentors may
      // co-manage; the previous 2-mentor cap was removed per business
      // rule (primary + as many approved co-mentors as needed).
      if (existing.some((cm) => cm.mentor_id === user.id)) {
        return error("You are already a co-mentor for this client.", 400);
      }
    }
  }

  const pending = await col("mentor_referrals").findOne({
    student_id,
    initiating_mentor_id: user.id,
    status: "pending",
  });
  if (pending) return error("You already have a pending referral request for this client.", 400);

  const now = new Date().toISOString();
  const referralDoc = {
    student_id, student_name, student_code,
    initiating_mentor_id: user.id,
    initiating_mentor_name: user.full_name,
    receiving_mentor_id, receiving_mentor_name,
    requested_deposit_amount: parseFloat(requested_deposit_amount) || 0,
    transaction_type: txType,
    tags: txTags,
    payment_method: payment_method || "",
    mt5_login: mt5_login || "",
    screenshot_url: screenshot_url || "",
    notes: notes || "",
    status: "pending",
    created_at: now,
    created_date: now,
    updated_date: now,
  };
  const ins = await col("mentor_referrals").insertOne(referralDoc as any);
  const referral = serialize({ _id: ins.insertedId, ...referralDoc });

  await col("logs").insertOne({
    timestamp: now,
    user_id: user.id,
    user_email: user.email,
    user_name: user.full_name,
    user_role: user.app_role,
    action_type: "other",
    entity_type: "MentorReferral",
    entity_id: referral.id,
    details: JSON.stringify({
      message: `Referral request sent by ${user.full_name} to ${receiving_mentor_name} for student ${student_name}`,
      student_id, requested_deposit_amount,
    }),
    success: true,
    created_date: now,
  } as any);

  return json({ referral });
}

/** Receiving mentor approves or rejects a pending referral. */
export async function processReferralResponse(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => null);
  if (!body) return error("Body required", 400);
  const { referral_id, action, rejection_reason } = body;
  if (!referral_id || !action) return error("Missing referral_id or action", 400);

  const rid = toObjectId(referral_id);
  if (!rid) return notFound("Referral not found");
  const referral = await col("mentor_referrals").findOne({ _id: rid });
  if (!referral) return notFound("Referral not found");

  if ((referral as any).receiving_mentor_id !== user.id) return forbidden("You are not authorized to respond to this referral");
  if ((referral as any).status !== "pending") return error("This referral has already been responded to", 400);

  const now = new Date().toISOString();

  if (action === "approve") {
    const sid = toObjectId((referral as any).student_id);
    let student: any = null;
    if (sid) {
      student = await col("students").findOne({ _id: sid });
      if (student) {
        // Append the new co-mentor to the existing list instead of rebuilding
        // from scratch. The old behaviour overwrote co_mentors_details every
        // approval, so a second co-mentor approval wiped out the first one —
        // effectively capping each student at one co-mentor regardless of how
        // many had been approved.
        let coMentors: any[] = [];
        if (student.co_mentors_details) {
          try {
            const raw = student.co_mentors_details;
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (Array.isArray(parsed)) coMentors = parsed;
          } catch { /* fall through with empty list */ }
        }
        // Ensure the primary mentor is recorded as role: primary (idempotent).
        if (student.primary_mentor_id && !coMentors.some((cm) => cm.mentor_id === student.primary_mentor_id)) {
          coMentors.push({
            mentor_id: student.primary_mentor_id,
            mentor_name: student.primary_mentor_name,
            net_deposit_contribution_usd: 0,
            role: "primary",
            since: now,
          });
        }
        // Append the newly-approved co-mentor (idempotent — won't double-add).
        const newCoId = (referral as any).initiating_mentor_id;
        if (newCoId && !coMentors.some((cm) => cm.mentor_id === newCoId)) {
          coMentors.push({
            mentor_id: newCoId,
            mentor_name: (referral as any).initiating_mentor_name,
            net_deposit_contribution_usd: 0,
            role: "co_mentor",
            since: now,
          });
        }
        await col("students").updateOne(
          { _id: sid },
          { $set: { co_mentors_details: JSON.stringify(coMentors), updated_date: now } },
        );
      }
    }

    const iOid = toObjectId((referral as any).initiating_mentor_id);
    const iUser = iOid ? await col("users").findOne({ _id: iOid }, { projection: { password_hash: 0 } }) : null;

    await col("funding_transactions").insertOne({
      type: (referral as any).transaction_type || "DEPOSIT",
      // Carry the tags from the referral so a BONUS keeps its category when the
      // approval converts the referral into a real FundingTransaction.
      tags: Array.isArray((referral as any).tags) ? (referral as any).tags : [],
      status: "PENDING",
      student_id: (referral as any).student_id,
      student_name: (referral as any).student_name,
      student_code: (referral as any).student_code,
      primary_mentor_id: student ? student.primary_mentor_id : (referral as any).receiving_mentor_id,
      primary_mentor_name: student ? student.primary_mentor_name : (referral as any).receiving_mentor_name,
      senior_mentor_id: student ? student.senior_mentor_id : null,
      senior_mentor_name: student ? student.senior_mentor_name : null,
      initiating_mentor_id: (referral as any).initiating_mentor_id,
      initiating_mentor_name: (referral as any).initiating_mentor_name,
      upline_commission_percentage: iUser ? parseFloat((iUser as any).upline_commission_percentage) || 0 : 0,
      amount_usd: parseFloat((referral as any).requested_deposit_amount) || 0,
      payment_method: (referral as any).payment_method || "",
      mt5_login: (referral as any).mt5_login || "",
      screenshot_url: (referral as any).screenshot_url || "",
      notes: (referral as any).notes || "",
      requested_by_id: (referral as any).initiating_mentor_id,
      requested_by_name: (referral as any).initiating_mentor_name,
      // Use the time the co-mentor ORIGINALLY submitted the referral, not the
      // time the primary mentor got around to approving it. Admin should see
      // when the deposit was actually requested (and commission is attributed
      // to that date's quarter), even if the primary delayed the approval.
      requested_at: (referral as any).created_at || (referral as any).created_date || now,
      created_date: now,
      updated_date: now,
    } as any);

    await col("mentor_referrals").updateOne(
      { _id: rid },
      { $set: { status: "approved", responded_at: now, updated_date: now } },
    );

    await col("logs").insertOne({
      timestamp: now,
      user_id: user.id, user_email: user.email, user_name: user.full_name, user_role: user.app_role,
      action_type: "other", entity_type: "MentorReferral", entity_id: referral_id,
      details: JSON.stringify({
        message: `Referral APPROVED by ${user.full_name}. ${(referral as any).initiating_mentor_name} added as co-mentor for student ${(referral as any).student_name}. FundingTransaction created for broker approval.`,
      }),
      success: true,
      created_date: now,
    } as any);

    return json({ success: true, message: "Referral approved. FundingTransaction created for admin review." });
  }

  if (action === "reject") {
    if (!rejection_reason) return error("Rejection reason is required", 400);
    await col("mentor_referrals").updateOne(
      { _id: rid },
      { $set: { status: "rejected", rejection_reason, responded_at: now, updated_date: now } },
    );
    await col("logs").insertOne({
      timestamp: now,
      user_id: user.id, user_email: user.email, user_name: user.full_name, user_role: user.app_role,
      action_type: "other", entity_type: "MentorReferral", entity_id: referral_id,
      details: JSON.stringify({ message: `Referral REJECTED by ${user.full_name}. Reason: ${rejection_reason}` }),
      success: true,
      created_date: now,
    } as any);
    return json({ success: true, message: "Referral rejected." });
  }

  return error('Invalid action. Use "approve" or "reject".', 400);
}

/**
 * Recalculate a single co-mentor's net contribution by summing their approved
 * deposits and withdrawals on the given student.
 */
export async function updateCoMentorContribution(req: Request, _user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => null);
  if (!body) return error("Body required", 400);
  const { student_id, mentor_id } = body;
  if (!student_id || !mentor_id) return error("Missing student_id or mentor_id", 400);

  const sid = toObjectId(student_id);
  if (!sid) return notFound("Student not found");
  const student = await col("students").findOne({ _id: sid });
  if (!student) return notFound("Student not found");
  if (!(student as any).co_mentors_details) return json({ success: true, message: "No co_mentors_details on student" });

  let coMentors: any[] = [];
  try {
    coMentors = typeof (student as any).co_mentors_details === "string"
      ? JSON.parse((student as any).co_mentors_details)
      : (student as any).co_mentors_details;
  } catch {
    return error("Invalid co_mentors_details format", 500);
  }
  const match = coMentors.find((cm) => cm.mentor_id === mentor_id);
  if (!match) return json({ success: true, message: "Co-mentor not found — no update needed" });

  const isPrimary = match.role === "primary" || mentor_id === (student as any).primary_mentor_id;
  let txs: any[];
  if (isPrimary) {
    const allApproved = serializeMany(
      await col("funding_transactions").find({ student_id, status: "APPROVED" }).toArray(),
    );
    txs = allApproved.filter((t: any) => !t.initiating_mentor_id || t.initiating_mentor_id === mentor_id);
  } else {
    txs = serializeMany(
      await col("funding_transactions").find({ student_id, status: "APPROVED", initiating_mentor_id: mentor_id }).toArray(),
    );
  }
  let netContribution = 0;
  for (const tx of txs) {
    if (tx.type === "DEPOSIT" || tx.type === "BONUS") netContribution += tx.amount_usd || 0;
    else if (tx.type === "WITHDRAWAL") netContribution -= tx.amount_usd || 0;
  }
  const updated = coMentors.map((cm) =>
    cm.mentor_id === mentor_id ? { ...cm, net_deposit_contribution_usd: netContribution } : cm,
  );
  await col("students").updateOne(
    { _id: sid },
    { $set: { co_mentors_details: JSON.stringify(updated), updated_date: new Date().toISOString() } },
  );
  return json({ success: true, netContribution, updatedCoMentors: updated });
}

/** Stub kept for parity with frontend calls. */
export async function processWithdrawal(_req: Request, user: AuthUser): Promise<Response> {
  if (!["super_admin", "broker_admin", "academic_head"].includes(user.app_role)) {
    return forbidden("Forbidden: Admin access required");
  }
  return json({ success: true, message: "Withdrawal processed. Use CoManageCalculator for co-managed deductions." });
}
