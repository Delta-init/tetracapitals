import { col } from "../db";
import { notify, type Notice } from "../lib/notify";

/* ────────────────────────────────────────────────────────────────────────────
   Sales-close MT5 bonuses waiting for a broker admin (the user, 2026-10-04).

   A student promised a bonus at the close is onboarded only once a broker
   admin or a Super Admin approves it (students/bonusVerification.ts), so a
   bonus left waiting holds the student — and the salesperson's commission —
   up. One that has waited 6 hours since it was raised (or submitted again)
   is told to every active broker admin and Super Admin: one notice, the bell
   and their phone, once per request — again only after it is submitted
   again. Not at night: what comes due between 21:00 and 09:00 UAE goes at
   09:00. Test users are never told. ONBOARDING_ALERTS=off or
   BONUS_VERIFY_ALERTS=off switches it off on a server.
──────────────────────────────────────────────────────────────────────────── */

export const VERIFY_WAIT_HOURS = 6;
const WAIT_MS = VERIFY_WAIT_HOURS * 3_600_000;
const TICK_MS = 5 * 60_000;
const UAE_OFFSET_MS = 4 * 3_600_000;
const TEST_EMAIL = /@deltatest\.dev$/i;
const OFF = /^(off|false|0|no)$/i;

const iso = (ms: number) => new Date(ms).toISOString();
const daytime = (now: number) => {
  const h = new Date(now + UAE_OFFSET_MS).getUTCHours();
  return h >= 9 && h < 21;
};

/** Who decides a sales-close bonus: every active broker admin and Super Admin, test users aside. */
export async function bonusVerifiers(): Promise<string[]> {
  const users = (await col("users")
    .find({ app_role: { $in: ["broker_admin", "super_admin"] }, status: { $ne: "inactive" } }, { projection: { email: 1, is_test: 1 } })
    .toArray()) as any[];
  return users.filter((u) => !u.is_test && !TEST_EMAIL.test(String(u.email ?? ""))).map((u) => String(u._id));
}

/** Tell the verifiers now — for a bonus submitted again, say. Never throws. */
export async function notifyBonusVerifiers(n: Notice): Promise<void> {
  try {
    await notify(await bonusVerifiers(), n);
  } catch (err) {
    console.error("[bonus verification] could not tell the verifiers", err);
  }
}

const money = (t: any) =>
  t.amount_currency === "USD" || !t.amount_currency
    ? `$${Number(t.amount_usd ?? t.amount_original ?? 0).toLocaleString("en-US")}`
    : `${t.amount_currency} ${Number(t.amount_original ?? 0).toLocaleString("en-US")}`;

export async function bonusVerifyAlertTick(now = Date.now()): Promise<number> {
  if (!daytime(now)) return 0;
  const before = iso(now - WAIT_MS);
  const due = (await col("funding_transactions")
    .find({
      type: "BONUS",
      bonus_credit: "sales_close",
      status: "PENDING",
      verify_alerted_at: { $exists: false },
      $or: [
        { resubmitted_at: { $lte: before } },
        { resubmitted_at: { $exists: false }, requested_at: { $lte: before } },
      ],
    }, { projection: { student_name: 1, student_code: 1, amount_currency: 1, amount_original: 1, amount_usd: 1 } })
    .limit(100)
    .toArray()) as any[];
  if (!due.length) return 0;
  // Claimed before anyone is told, so two copies of the backend never tell anyone twice.
  const claimed: any[] = [];
  for (const t of due) {
    const r = await col("funding_transactions").updateOne(
      { _id: t._id, verify_alerted_at: { $exists: false } },
      { $set: { verify_alerted_at: iso(now) } },
    );
    if (r.modifiedCount) claimed.push(t);
  }
  if (!claimed.length) return 0;
  const name = (t: any) => `${t.student_name || "A student"}${t.student_code ? ` (${t.student_code})` : ""}`;
  await notifyBonusVerifiers({
    type: "bonus_verification",
    title: claimed.length === 1 ? `MT5 bonus waiting ${VERIFY_WAIT_HOURS}h: ${name(claimed[0])}` : `${claimed.length} MT5 bonuses waiting over ${VERIFY_WAIT_HOURS} hours`,
    body: claimed.length === 1
      ? `${money(claimed[0])} promised at the sales close is waiting for approval — their onboarding is on hold until then.`
      : `${claimed.slice(0, 5).map(name).join(", ")}${claimed.length > 5 ? ` and ${claimed.length - 5} more` : ""} — onboarding is on hold until each is approved.`,
    link: "/FundingRequests",
    tag: "bonus-verification",
  });
  return claimed.length;
}

export function startBonusVerifyAlertWorker(): void {
  if (OFF.test(process.env.ONBOARDING_ALERTS ?? "") || OFF.test(process.env.BONUS_VERIFY_ALERTS ?? "")) {
    console.log("[bonus verification] alerts off on this server");
    return;
  }
  const tick = () => bonusVerifyAlertTick().catch((err) => console.error("[bonus verification] run failed", err));
  setTimeout(() => void tick(), 150_000);
  setInterval(() => void tick(), TICK_MS);
}
