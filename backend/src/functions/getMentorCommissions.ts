import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { serializeMany } from "../lib/id";
import type { AuthUser } from "../auth/middleware";

const ALLOWED = new Set([
  "super_admin", "broker_admin", "academic_head", "finance_admin",
  "junior_mentor", "senior_mentor", "admin",
]);
const MAX_CAP = 25_000;

export async function getMentorCommissions(req: Request, user: AuthUser): Promise<Response> {
  if (!ALLOWED.has(user.app_role)) return forbidden();
  const body: any = await req.json().catch(() => null);
  const { startDate, endDate } = body ?? {};
  if (!startDate || !endDate) return error("startDate and endDate are required", 400);

  const isMentor = user.app_role === "junior_mentor" || user.app_role === "senior_mentor";
  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const allUsers = await col("users").find({}, { projection: { password_hash: 0 } }).toArray();
  const commissionRateMap: Record<string, number> = {};
  for (const u of allUsers as any[]) {
    commissionRateMap[u._id.toString()] = parseFloat(u.commission_rate) || 4;
  }

  const allTxs = serializeMany(
    await col("funding_transactions").find({ status: "APPROVED" }).toArray(),
  );
  const allAdjs = serializeMany(
    await col("manual_commission_adjustments").find({}).toArray(),
  );

  let filtered = allTxs.filter((t: any) => {
    const d = new Date(t.requested_at || t.created_date);
    return d >= start && d <= end;
  });
  let filteredAdj = allAdjs.filter((a: any) => {
    // Quarter attribution follows the admin-chosen effective_date; legacy rows
    // without it fall back to created_date.
    const d = new Date(a.effective_date || a.created_date);
    return d >= start && d <= end;
  });

  if (isMentor) {
    filtered = filtered.filter(
      (t: any) => (t.initiating_mentor_id || t.primary_mentor_id) === user.id,
    );
    filteredAdj = filteredAdj.filter((a: any) => a.mentor_id === user.id);
  }

  const mentorMap: Record<string, any> = {};

  for (const tx of filtered) {
    const mentorId = tx.initiating_mentor_id || tx.primary_mentor_id;
    if (!mentorId) continue;
    const mentorName = tx.initiating_mentor_name || tx.primary_mentor_name || "Unknown";
    if (!mentorMap[mentorId]) {
      mentorMap[mentorId] = { mentor_id: mentorId, mentor_name: mentorName, transactions: [], adjustments: [] };
    }
    mentorMap[mentorId].transactions.push(tx);
  }
  for (const adj of filteredAdj) {
    if (!mentorMap[adj.mentor_id]) {
      mentorMap[adj.mentor_id] = {
        mentor_id: adj.mentor_id,
        mentor_name: adj.mentor_name || "Unknown",
        transactions: [],
        adjustments: [],
      };
    }
    mentorMap[adj.mentor_id].adjustments.push(adj);
  }

  const result: any[] = [];
  for (const mentorId in mentorMap) {
    const mentor = mentorMap[mentorId];
    const studentNetDeposits: Record<string, number> = {};
    let totalDeposit = 0;
    let totalBonus = 0;
    let totalWithdrawal = 0;
    for (const tx of mentor.transactions) {
      const sid = tx.student_id;
      if (!studentNetDeposits[sid]) studentNetDeposits[sid] = 0;
      // BONUS still counts as a deposit for commission attribution, but is
      // tracked separately so reports can show it as its own column.
      if (tx.type === "DEPOSIT") {
        studentNetDeposits[sid] += tx.amount_usd || 0;
        totalDeposit += tx.amount_usd || 0;
      } else if (tx.type === "BONUS") {
        studentNetDeposits[sid] += tx.amount_usd || 0;
        totalBonus += tx.amount_usd || 0;
      } else if (tx.type === "WITHDRAWAL") {
        studentNetDeposits[sid] -= tx.amount_usd || 0;
        totalWithdrawal += tx.amount_usd || 0;
      }
    }
    let commissionableNet = 0;
    for (const sid in studentNetDeposits) {
      const capped = Math.min(studentNetDeposits[sid], MAX_CAP);
      commissionableNet += Math.max(capped, 0);
    }
    const rate = (commissionRateMap[mentorId] ?? 4) / 100;
    const grossCommission = commissionableNet * rate;
    const manualAdjTotal = mentor.adjustments.reduce((s: number, a: any) => s + (a.amount_usd || 0), 0);
    const adjustedGross = grossCommission + manualAdjTotal;
    result.push({
      mentor_id: mentorId,
      mentor_name: mentor.mentor_name,
      commission_rate: commissionRateMap[mentorId] ?? 4,
      total_deposit: totalDeposit,
      total_bonus: totalBonus,
      total_withdrawal: totalWithdrawal,
      net_deposit: totalDeposit + totalBonus - totalWithdrawal,
      commissionable_net: commissionableNet,
      gross_commission: grossCommission,
      manual_adjustment: manualAdjTotal,
      adjusted_gross: adjustedGross,
      release_75: adjustedGross * 0.75,
      buffer_25: adjustedGross * 0.25,
      transaction_count: mentor.transactions.length,
      adjustment_count: mentor.adjustments.length,
    });
  }
  result.sort((a, b) => b.commissionable_net - a.commissionable_net);
  return json({ rows: result });
}
