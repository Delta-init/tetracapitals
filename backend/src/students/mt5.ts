import { col } from "../db";
import { toObjectId } from "../lib/id";

/* ────────────────────────────────────────────────────────────────────────────
   A student's MT5 accounts (mt5_accounts): the list on their page, shown in
   their details, and what the funding forms offer to pick (the user,
   2026-10-04). Kept from wherever their MT5 login is given: the call log —
   a call that didn't connect too — a funding request when it is raised, and
   a co-management request when it is approved and becomes one.

   A login is its number, 4–15 digits, and one student's: the database keeps
   each login once (a unique index), so one that is already another
   student's is not kept for this one. Their first is the primary one.
──────────────────────────────────────────────────────────────────────────── */

export const MT5_LOGIN = /^\d{4,15}$/;

/** A login as typed, spaces taken out. */
export const mt5LoginOf = (v: unknown) => String(v ?? "").replace(/\s+/g, "").slice(0, 40);

/** A login as it may be kept: as text, or as a number in older records. */
const sameLogin = (login: string) => (Number.isSafeInteger(Number(login)) ? { $in: [login, Number(login)] } : login);

/** The student's MT5 logins: the primary one first, then oldest first. */
export async function mt5Of(studentId: string): Promise<string[]> {
  const rows = (await col("mt5_accounts").find({ student_id: studentId }, { projection: { mt5_login: 1, is_primary: 1 } }).sort({ created_date: 1 }).toArray()) as any[];
  return rows
    .sort((a, b) => Number(b.is_primary === true) - Number(a.is_primary === true))
    .map((r) => String(r.mt5_login ?? "").trim())
    .filter(Boolean);
}

/** The student whose login this is, or null. */
export async function mt5Owner(login: string): Promise<string | null> {
  const row: any = await col("mt5_accounts").findOne({ mt5_login: sameLogin(login) }, { projection: { student_id: 1 } });
  return row ? String(row.student_id ?? "") : null;
}

/** What became of a login: kept now, theirs already, another student's, or not a login number. */
export type KeptMt5 = "saved" | "had" | "taken" | "invalid";

/** Kept as one of the student's MT5 accounts. */
export async function keepMt5(
  student: { _id: unknown; full_name?: string; student_code?: string },
  login: string,
  by: { email?: string; name: string },
  source: string,
): Promise<KeptMt5> {
  if (!MT5_LOGIN.test(login)) return "invalid";
  const sid = String(student._id);
  const owner = await mt5Owner(login);
  if (owner !== null) return owner === sid ? "had" : "taken";
  const first = !(await col("mt5_accounts").findOne({ student_id: sid }, { projection: { _id: 1 } }));
  const now = new Date().toISOString();
  try {
    await col("mt5_accounts").insertOne({
      student_id: sid, student_name: student.full_name ?? "", student_code: student.student_code ?? "",
      mt5_login: login, platform: "MT5", account_type: "LIVE", base_currency: "USD", is_primary: first,
      created_by: by.email ?? "", created_by_name: by.name, source, created_date: now, updated_date: now,
    } as any);
    return "saved";
  } catch (err) {
    // Kept a moment ago by another request: for them, or for someone else.
    if ((err as { code?: number }).code !== 11000) throw err;
    return (await mt5Owner(login)) === sid ? "had" : "taken";
  }
}

/**
 * A funding request's MT5 login, kept as its student's — not a sales-close credit's (the server's, in an MT5 they
 * have). Never throws: the request stands either way.
 */
export async function keepRequestMt5(tx: any, by: { email?: string; name: string }, source: string): Promise<KeptMt5 | null> {
  try {
    const login = mt5LoginOf(tx?.mt5_login);
    const oid = toObjectId(String(tx?.student_id ?? ""));
    if (!login || !oid || tx?.bonus_credit) return null;
    const student: any = await col("students").findOne({ _id: oid }, { projection: { full_name: 1, student_code: 1 } });
    return student ? await keepMt5(student, login, by, source) : null;
  } catch (err) {
    console.error("[mt5] a funding request's MT5 login was not kept:", err);
    return null;
  }
}
