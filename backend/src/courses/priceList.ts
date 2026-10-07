/*
 * The CSE course price list (the user, 2026-10-07: "Delta Course Price
 * Structure: CSE Upgrade Route", as corrected on the chart).
 *
 * Each course has a full price (one payment) and, except MBT and DWT, an
 * installment plan of AED 2,000 payments. A course may include others the
 * student already paid for; those are taken off its price. MBT is never taken
 * off (it is how every student starts, from Sales). DGMP is left out until its
 * bonus and included courses are set.
 *
 * Bonus: every AED 2,000 step of an installment balance adds USD 500 to MT5; a
 * full payment adds the same steps' bonus at once. MBT's 500 and DWT's flat 500
 * come on top — MSNR → DSLP PRO ends at 7,500, DWT → DSLP PRO at 7,000.
 */

export type CourseCode = "MBT" | "DWT" | "MSNR" | "DSLP_OFFER" | "DSLP_PRO" | "DQMP";

export interface CoursePrice {
  code: CourseCode;
  name: string;
  /** One payment, AED. */
  fullAed: number;
  /** The installment plan's total, AED (a multiple of 2,000); null: no installments. */
  planAed: number | null;
  /** Bonus a payment of this course adds, USD, when it is not matched in 2,000 steps (MBT, DWT). */
  flatBonusUsd?: number;
  /** Courses this one includes: what the student paid for them is taken off. */
  deducts: CourseCode[];
  /** Paid once (or through Tabby), never in installments. */
  oneTime?: boolean;
}

export const STEP_AED = 2_000;
export const STEP_BONUS_USD = 500;

export const DEFAULT_PRICE_LIST: CoursePrice[] = [
  { code: "MBT", name: "MBT", fullAed: 2_250, planAed: null, flatBonusUsd: 500, deducts: [], oneTime: true },
  { code: "DWT", name: "DWT", fullAed: 3_250, planAed: null, flatBonusUsd: 500, deducts: [], oneTime: true },
  { code: "MSNR", name: "MSNR", fullAed: 11_010, planAed: 12_000, deducts: [] },
  { code: "DSLP_OFFER", name: "DSLP Offer", fullAed: 18_350, planAed: 20_000, deducts: ["DWT"] },
  { code: "DSLP_PRO", name: "DSLP PRO Full", fullAed: 25_690, planAed: 28_000, deducts: ["DWT", "MSNR", "DSLP_OFFER"] },
  { code: "DQMP", name: "DQMP", fullAed: 44_040, planAed: 48_000, deducts: ["DSLP_PRO"] },
];
