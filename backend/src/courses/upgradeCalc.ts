import { DEFAULT_PRICE_LIST, STEP_AED, STEP_BONUS_USD, type CourseCode, type CoursePrice } from "./priceList";

/*
 * The upgrade calculator: what a student pays to take a course, how, and the
 * MT5 bonus it brings — and, as payments are approved, how far they have got.
 * Pure: no database, so every route on the chart is checked by
 * scripts/course-upgrade-calc-check.ts.
 *
 * The rules, as the user settled them on the chart (2026-10-07):
 *   - A course's price is its full price or its installment plan, less what
 *     the student actually paid for the courses it includes — and for the
 *     courses those include (DSLP PRO takes off DSLP, and the DWT DSLP took
 *     off). MBT is never taken off.
 *   - Bonus is counted in steps: an installment plan is AED 2,000 steps (MSNR 6,
 *     DSLP Offer 10, DSLP PRO 14, DQMP 24) and DWT counts as 2. A course adds
 *     USD 500 for each step it has beyond the steps of the courses it takes
 *     off. A full payment adds them all at once; installments add them one
 *     approved 2,000 at a time.
 *   - When what is taken off leaves an installment balance that is not whole
 *     steps, the extra goes into the first payment and earns nothing (DWT →
 *     DSLP Offer: 2,750, then 7 × 2,000).
 *   - On an installment plan, money under a full step waits on hold for the
 *     next payment.
 */

export type PlanType = "full" | "installments";

/** A course the student has, and what they actually paid for it (AED). */
export interface OwnedCourse {
  code: CourseCode;
  paidAed: number;
}

export interface UpgradeQuote {
  course: CourseCode;
  plan: PlanType;
  /** The course's own price on this plan, before anything is taken off. */
  priceAed: number;
  /** Taken off, course by course. */
  deductions: { code: CourseCode; aed: number }[];
  /** What the student pays for this upgrade, AED. */
  dueAed: number;
  /** The payments: one for full (or a one-time course), the plan otherwise. */
  schedule: number[];
  /** Of the first payment, the part that earns no bonus. */
  noBonusAed: number;
  /** Bonus steps the upgrade earns, and the USD they come to. */
  steps: number;
  bonusUsd: number;
}

const byCode = (list: CoursePrice[]) => new Map(list.map((c) => [c.code, c]));

/** A course's steps: its plan's 2,000s; DWT (one-time, not a multiple) rounds up; MBT has none. */
export function stepsOf(course: CoursePrice): number {
  if (course.code === "MBT") return 0;
  if (course.planAed !== null) return Math.round(course.planAed / STEP_AED);
  return Math.ceil(course.fullAed / STEP_AED);
}

/** Every course this one takes off, and the ones those take off. */
export function includedCourses(code: CourseCode, list: CoursePrice[] = DEFAULT_PRICE_LIST): Set<CourseCode> {
  const prices = byCode(list);
  const seen = new Set<CourseCode>();
  const walk = (c: CourseCode) => {
    for (const d of prices.get(c)?.deducts ?? []) {
      if (seen.has(d)) continue;
      seen.add(d);
      walk(d);
    }
  };
  walk(code);
  return seen;
}

export class UpgradeError extends Error {}

/** What taking `course` on `plan` costs a student who already has `owned`. */
export function quoteUpgrade(
  course: CourseCode,
  plan: PlanType,
  owned: OwnedCourse[],
  list: CoursePrice[] = DEFAULT_PRICE_LIST,
): UpgradeQuote {
  const prices = byCode(list);
  const target = prices.get(course);
  if (!target) throw new UpgradeError(`Unknown course ${course}`);
  if (owned.some((o) => o.code === course)) throw new UpgradeError(`The student already has ${target.name}`);
  if (plan === "installments" && target.planAed === null) throw new UpgradeError(`${target.name} is paid once, not in installments`);

  const included = includedCourses(course, list);
  const deductions = owned
    .filter((o) => included.has(o.code) && o.paidAed > 0)
    .map((o) => ({ code: o.code, aed: o.paidAed }));
  const off = deductions.reduce((s, d) => s + d.aed, 0);

  // Bonus steps: this course's, less those of what it takes off. A course inside
  // another one the student has (DWT inside DSLP Offer) is already in that one's
  // steps, so only the outermost count.
  const takenOff = owned.filter((o) => included.has(o.code));
  const ownedSteps = takenOff
    .filter((o) => !takenOff.some((other) => other.code !== o.code && includedCourses(other.code, list).has(o.code)))
    .reduce((s, o) => s + stepsOf(prices.get(o.code)!), 0);
  const steps = target.flatBonusUsd !== undefined ? 0 : Math.max(0, stepsOf(target) - ownedSteps);
  const bonusUsd = target.flatBonusUsd !== undefined ? target.flatBonusUsd : steps * STEP_BONUS_USD;

  const priceAed = plan === "full" ? target.fullAed : target.planAed!;
  const dueAed = Math.max(0, priceAed - off);

  if (plan === "full" || target.oneTime) {
    return { course, plan: "full", priceAed: target.fullAed, deductions, dueAed, schedule: dueAed ? [dueAed] : [], noBonusAed: 0, steps, bonusUsd };
  }
  // Installments: whole 2,000 steps, the extra on top of the first.
  const whole = Math.min(steps, Math.floor(dueAed / STEP_AED));
  const noBonusAed = dueAed - whole * STEP_AED;
  const schedule = whole === 0
    ? (dueAed ? [dueAed] : [])
    : [STEP_AED + noBonusAed, ...Array.from({ length: whole - 1 }, () => STEP_AED)];
  return { course, plan, priceAed, deductions, dueAed, schedule, noBonusAed, steps: whole, bonusUsd: whole * STEP_BONUS_USD };
}

export interface Progress {
  paidAed: number;
  balanceAed: number;
  /** Steps earned so far, and the USD they come to. */
  stepsEarned: number;
  bonusEarnedUsd: number;
  /** Waiting for the next payment to make a full step (installments only). */
  onHoldAed: number;
  done: boolean;
}

/**
 * Where an upgrade stands after the payments finance has approved (AED). The
 * no-bonus part of the first payment is met first; then every full 2,000
 * earns a step; a full payment, or a one-time course, earns all at once.
 */
export function progressOf(quote: UpgradeQuote, approvedPaymentsAed: number[]): Progress {
  const paidAed = approvedPaymentsAed.reduce((s, p) => s + p, 0);
  const balanceAed = Math.max(0, quote.dueAed - paidAed);
  const done = balanceAed === 0;
  if (quote.plan === "full") {
    return {
      paidAed, balanceAed, done, onHoldAed: 0,
      stepsEarned: done ? quote.steps : 0,
      bonusEarnedUsd: done ? quote.bonusUsd : 0,
    };
  }
  const pot = Math.max(0, paidAed - quote.noBonusAed);
  const stepsEarned = Math.min(quote.steps, Math.floor(pot / STEP_AED));
  return {
    paidAed, balanceAed, done,
    stepsEarned,
    bonusEarnedUsd: stepsEarned * STEP_BONUS_USD,
    onHoldAed: done ? 0 : pot - stepsEarned * STEP_AED,
  };
}
