import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";

const ALLOWED = new Set(["super_admin", "broker_admin", "academic_head"]);

interface Row {
  student_id: string;
  student_name: string;
  student_code: string;
  primary_mentor_name: string;
  senior_mentor_name: string;
  total_deposit: number;
  total_withdrawal: number;
  net: number;
  transaction_count: number;
}

export async function getReportsData(req: Request, user: AuthUser): Promise<Response> {
  if (!ALLOWED.has(user.app_role)) return forbidden();
  const body: any = await req.json().catch(() => null);
  const { startDate, endDate } = body ?? {};
  if (!startDate || !endDate) return error("startDate and endDate are required", 400);

  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const txs = await col("funding_transactions")
    .find({ status: "APPROVED" })
    .sort({ requested_at: -1 })
    .toArray();

  const filtered = txs.filter((t: any) => {
    const txDate = new Date(t.requested_at || t.created_date);
    return txDate >= start && txDate <= end;
  });

  const studentMap: Record<string, Row> = {};
  for (const tx of filtered as any[]) {
    const key = tx.student_id;
    if (!studentMap[key]) {
      studentMap[key] = {
        student_id: tx.student_id,
        student_name: tx.student_name,
        student_code: tx.student_code || "",
        primary_mentor_name: tx.primary_mentor_name || "",
        senior_mentor_name: tx.senior_mentor_name || "",
        total_deposit: 0,
        total_withdrawal: 0,
        net: 0,
        transaction_count: 0,
      };
    }
    if (tx.type === "DEPOSIT") studentMap[key].total_deposit += tx.amount_usd || 0;
    else if (tx.type === "WITHDRAWAL") studentMap[key].total_withdrawal += tx.amount_usd || 0;
    studentMap[key].transaction_count += 1;
  }

  for (const key in studentMap) {
    studentMap[key].net = studentMap[key].total_deposit - studentMap[key].total_withdrawal;
  }

  const rows = Object.values(studentMap).sort((a, b) => b.total_deposit - a.total_deposit);
  const totals = rows.reduce(
    (acc, r) => {
      acc.total_deposit += r.total_deposit;
      acc.total_withdrawal += r.total_withdrawal;
      acc.net += r.net;
      return acc;
    },
    { total_deposit: 0, total_withdrawal: 0, net: 0 },
  );

  return json({ rows, totals });
}
