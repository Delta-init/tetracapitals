/**
 * Checks the upgrade calculator against every route on the user's chart
 * (2026-10-07), full payment and installments, and a run of payments with
 * money on hold. Pure — no database.
 *
 *   bun run src/scripts/course-upgrade-calc-check.ts
 */
import { quoteUpgrade, progressOf, UpgradeError, type OwnedCourse, type PlanType } from "../courses/upgradeCalc";
import type { CourseCode } from "../courses/priceList";
import { lmsTargetsOf, sameTitle } from "../courses/lmsMapping";

let checks = 0, failures = 0;
function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const rep = (n: number, x: number) => Array.from({ length: n }, () => x);

// The student's courses along each route, with what each cost them on that route.
const MBT: OwnedCourse = { code: "MBT", paidAed: 2_250 };
const DWT: OwnedCourse = { code: "DWT", paidAed: 3_250 };
const has = (...c: [CourseCode, number][]): OwnedCourse[] => [MBT, ...c.map(([code, paidAed]) => ({ code, paidAed }))];

type Row = { label: string; to: CourseCode; owned: OwnedCourse[]; mt5Before: number;
  full: { due: number; bonus: number }; inst?: { due: number; schedule: number[]; bonus: number }; mt5After: number };

const rows: Row[] = [
  { label: "MBT → DWT", to: "DWT", owned: has(), mt5Before: 500, full: { due: 3_250, bonus: 500 }, mt5After: 1_000 },
  // The DWT route: DWT's 3,250 taken off.
  { label: "DWT → MSNR", to: "MSNR", owned: [MBT, DWT], mt5Before: 1_000, full: { due: 11_010, bonus: 3_000 }, inst: { due: 12_000, schedule: rep(6, 2_000), bonus: 3_000 }, mt5After: 4_000 },
  { label: "DWT → DSLP Offer", to: "DSLP_OFFER", owned: [MBT, DWT], mt5Before: 1_000, full: { due: 15_100, bonus: 4_000 }, inst: { due: 16_750, schedule: [2_750, ...rep(7, 2_000)], bonus: 4_000 }, mt5After: 5_000 },
  { label: "DWT → DSLP PRO", to: "DSLP_PRO", owned: [MBT, DWT], mt5Before: 1_000, full: { due: 22_440, bonus: 6_000 }, inst: { due: 24_750, schedule: [2_750, ...rep(11, 2_000)], bonus: 6_000 }, mt5After: 7_000 },
  { label: "DWT + MSNR (plan) → DSLP PRO", to: "DSLP_PRO", owned: [MBT, DWT, { code: "MSNR", paidAed: 12_000 }], mt5Before: 4_000, full: { due: 10_440, bonus: 3_000 }, inst: { due: 12_750, schedule: [2_750, ...rep(5, 2_000)], bonus: 3_000 }, mt5After: 7_000 },
  { label: "DWT + MSNR (full) → DSLP PRO", to: "DSLP_PRO", owned: [MBT, DWT, { code: "MSNR", paidAed: 11_010 }], mt5Before: 4_000, full: { due: 11_430, bonus: 3_000 }, inst: { due: 13_740, schedule: [3_740, ...rep(5, 2_000)], bonus: 3_000 }, mt5After: 7_000 },
  { label: "DWT + DSLP Offer (plan) → DSLP PRO", to: "DSLP_PRO", owned: [MBT, DWT, { code: "DSLP_OFFER", paidAed: 16_750 }], mt5Before: 5_000, full: { due: 5_690, bonus: 2_000 }, inst: { due: 8_000, schedule: rep(4, 2_000), bonus: 2_000 }, mt5After: 7_000 },
  { label: "DWT route: DSLP PRO (plan) → DQMP", to: "DQMP", owned: [MBT, DWT, { code: "DSLP_PRO", paidAed: 24_750 }], mt5Before: 7_000, full: { due: 16_040, bonus: 5_000 }, inst: { due: 20_000, schedule: rep(10, 2_000), bonus: 5_000 }, mt5After: 12_000 },
  // The other routes: nothing of MBT taken off.
  { label: "MBT → MSNR", to: "MSNR", owned: has(), mt5Before: 500, full: { due: 11_010, bonus: 3_000 }, inst: { due: 12_000, schedule: rep(6, 2_000), bonus: 3_000 }, mt5After: 3_500 },
  { label: "MBT → DSLP Offer", to: "DSLP_OFFER", owned: has(), mt5Before: 500, full: { due: 18_350, bonus: 5_000 }, inst: { due: 20_000, schedule: rep(10, 2_000), bonus: 5_000 }, mt5After: 5_500 },
  { label: "MBT → DQMP", to: "DQMP", owned: has(), mt5Before: 500, full: { due: 44_040, bonus: 12_000 }, inst: { due: 48_000, schedule: rep(24, 2_000), bonus: 12_000 }, mt5After: 12_500 },
  { label: "MSNR (plan) → DSLP PRO", to: "DSLP_PRO", owned: has(["MSNR", 12_000]), mt5Before: 3_500, full: { due: 13_690, bonus: 4_000 }, inst: { due: 16_000, schedule: rep(8, 2_000), bonus: 4_000 }, mt5After: 7_500 },
  { label: "MSNR (full) → DSLP PRO", to: "DSLP_PRO", owned: has(["MSNR", 11_010]), mt5Before: 3_500, full: { due: 14_680, bonus: 4_000 }, inst: { due: 16_990, schedule: [2_990, ...rep(7, 2_000)], bonus: 4_000 }, mt5After: 7_500 },
  { label: "DSLP Offer (full) → DSLP PRO", to: "DSLP_PRO", owned: has(["DSLP_OFFER", 18_350]), mt5Before: 5_500, full: { due: 7_340, bonus: 2_000 }, inst: { due: 9_650, schedule: [3_650, ...rep(3, 2_000)], bonus: 2_000 }, mt5After: 7_500 },
  { label: "DSLP Offer (plan) → DSLP PRO", to: "DSLP_PRO", owned: has(["DSLP_OFFER", 20_000]), mt5Before: 5_500, full: { due: 5_690, bonus: 2_000 }, inst: { due: 8_000, schedule: rep(4, 2_000), bonus: 2_000 }, mt5After: 7_500 },
  { label: "DSLP PRO (full) → DQMP", to: "DQMP", owned: has(["DSLP_OFFER", 18_350], ["DSLP_PRO", 7_340]), mt5Before: 7_500, full: { due: 18_350, bonus: 5_000 }, inst: { due: 22_310, schedule: [4_310, ...rep(9, 2_000)], bonus: 5_000 }, mt5After: 12_500 },
  { label: "DSLP PRO (plan) → DQMP", to: "DQMP", owned: has(["DSLP_OFFER", 20_000], ["DSLP_PRO", 8_000]), mt5Before: 7_500, full: { due: 16_040, bonus: 5_000 }, inst: { due: 20_000, schedule: rep(10, 2_000), bonus: 5_000 }, mt5After: 12_500 },
];

console.log("\nEvery route on the chart");
for (const r of rows) {
  const f = quoteUpgrade(r.to, "full", r.owned);
  check(`${r.label} — full: pays ${r.full.due.toLocaleString()}, +$${r.full.bonus.toLocaleString()}, MT5 ${r.mt5After.toLocaleString()}`,
    f.dueAed === r.full.due && f.bonusUsd === r.full.bonus && r.mt5Before + f.bonusUsd === r.mt5After,
    `got ${f.dueAed} +$${f.bonusUsd}`);
  if (r.inst) {
    const q = quoteUpgrade(r.to, "installments", r.owned);
    check(`${r.label} — installments: ${r.inst.schedule[0]!.toLocaleString()} + … (${r.inst.schedule.length} payments), +$${r.inst.bonus.toLocaleString()}`,
      q.dueAed === r.inst.due && same(q.schedule, r.inst.schedule) && q.bonusUsd === r.inst.bonus && r.mt5Before + q.bonusUsd === r.mt5After,
      `got ${q.dueAed} ${JSON.stringify(q.schedule)} +$${q.bonusUsd}`);
  }
}

console.log("\nPayments: steps, money on hold, the no-bonus part");
const dslp = quoteUpgrade("DSLP_OFFER", "installments", [MBT, DWT]);   // 16,750: 2,750 + 7 × 2,000
let p = progressOf(dslp, [2_750]);
check("2,750 first: one step (+$500), the 750 earns nothing", p.stepsEarned === 1 && p.bonusEarnedUsd === 500 && p.onHoldAed === 0 && p.balanceAed === 14_000, JSON.stringify(p));
p = progressOf(dslp, [4_500]);
check("4,500 first: 750 no bonus, one step, 1,750 on hold", p.stepsEarned === 1 && p.onHoldAed === 1_750 && p.balanceAed === 12_250, JSON.stringify(p));
p = progressOf(dslp, [4_500, 1_000]);
check("…1,000 more: 2,750 in the pot makes a second step, 750 on hold", p.stepsEarned === 2 && p.onHoldAed === 750, JSON.stringify(p));
p = progressOf(dslp, [500]);
check("500 alone: inside the no-bonus part, nothing yet", p.stepsEarned === 0 && p.onHoldAed === 0 && p.balanceAed === 16_250, JSON.stringify(p));
p = progressOf(dslp, dslp.schedule);
check("the whole plan: done, every step, $4,000, nothing on hold", p.done && p.stepsEarned === 8 && p.bonusEarnedUsd === 4_000 && p.onHoldAed === 0);
p = progressOf(dslp, [20_000]);
check("paying more than the balance never earns past the course's steps", p.stepsEarned === 8 && p.done);
const full = quoteUpgrade("DSLP_OFFER", "full", [MBT, DWT]);
check("full payment: nothing until it is paid", progressOf(full, [10_000]).bonusEarnedUsd === 0);
check("…then all $4,000 at once", progressOf(full, [15_100]).bonusEarnedUsd === 4_000);
const dwt = quoteUpgrade("DWT", "full", [MBT]);
check("DWT: one payment, flat $500", progressOf(dwt, [3_250]).bonusEarnedUsd === 500 && dwt.schedule.length === 1);

console.log("\nRefused");
const refused = (fn: () => unknown, re: RegExp) => { try { fn(); return false; } catch (e) { return e instanceof UpgradeError && re.test(e.message); } };
check("DWT in installments", refused(() => quoteUpgrade("DWT", "installments" as PlanType, [MBT]), /paid once/));
check("a course the student already has", refused(() => quoteUpgrade("MSNR", "full", has(["MSNR", 12_000])), /already has/));
check("an unknown course", refused(() => quoteUpgrade("DGMP" as CourseCode, "full", [MBT]), /Unknown course/));

console.log("\nThe LMS modules each upgrade opens (lmsMapping.ts)");
const titles = (c: CourseCode) => lmsTargetsOf(c).targets.map((t) => `${t.title.split(" ")[0]}${t.firstModules ? `:${t.firstModules}` : ""}`).sort().join(",");
check("MSNR opens MMC", titles("MSNR") === "MMC");
check("DSLP Offer opens DSLP 1–10 and DWT", titles("DSLP_OFFER") === "DELTA,DSLP:10", titles("DSLP_OFFER"));
check("DSLP PRO opens all of DSLP, DWT and MMC", titles("DSLP_PRO") === "DELTA,DSLP,MMC", titles("DSLP_PRO"));
check("DQMP: no LMS course yet, DSLP PRO's courses", !lmsTargetsOf("DQMP").ownMapped && titles("DQMP") === "DELTA,DSLP,MMC", titles("DQMP"));
check("titles match however the LMS spaces them", sameTitle("DSLP  - Delta Structure & Liquidity Programme", "DSLP - Delta Structure & Liquidity Programme"));

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
