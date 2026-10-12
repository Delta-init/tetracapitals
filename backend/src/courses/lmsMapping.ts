import type { CourseCode } from "./priceList";
import { includedCourses } from "./upgradeCalc";

/*
 * Which LMS modules each CSE course opens (the user, 2026-10-08, from the
 * mapping sheet root/outputs/cse-lms-module-mapping.xlsx): an LMS Forex course
 * by its title — found among the student's own academy's courses, which the
 * LMS hands over — and, for DSLP Offer, only its first modules. A course
 * opens the ones of every course it takes off too (DSLP PRO: DWT, MMC, DSLP).
 * DQMP has no LMS course yet: add its line once the course is made there.
 * HADC is no upgrade's.
 */
export interface LmsTarget { title: string; firstModules?: number }

export const CSE_LMS: Record<CourseCode, LmsTarget[]> = {
  MBT: [{ title: "MARKET BREAK-OUT TRADING PROGRAM" }],
  DWT: [{ title: "DELTA WAVE THEORY TRADING PROGRAMME" }],
  MSNR: [{ title: "MMC (MARKET MAKING CYCLE)" }],
  DSLP_OFFER: [{ title: "DSLP - Delta Structure & Liquidity Programme", firstModules: 10 }],
  DSLP_PRO: [{ title: "DSLP - Delta Structure & Liquidity Programme" }],
  DQMP: [],
};

export const sameTitle = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/** Every LMS course an upgrade to `code` opens: its own and those of the courses it takes off, the widest per course. */
export function lmsTargetsOf(code: CourseCode): { targets: LmsTarget[]; ownMapped: boolean } {
  const out: LmsTarget[] = [];
  for (const c of [code, ...includedCourses(code)]) {
    for (const t of CSE_LMS[c] ?? []) {
      const have = out.find((o) => sameTitle(o.title, t.title));
      if (!have) out.push({ ...t });
      else if (have.firstModules !== undefined && (t.firstModules === undefined || t.firstModules > have.firstModules)) have.firstModules = t.firstModules;
    }
  }
  return { targets: out, ownMapped: (CSE_LMS[code] ?? []).length > 0 };
}

/** "DSLP — Offer Price" → "DSLPOFFERPRICE": a product's name, however it was typed. */
export const productKey = (name: unknown) => String(name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The LMS course a Bonus course payment's product opens (the user, 2026-10-12 — "go, your way"): by the product's name,
 * as Course Upgrades map their courses — DSLP Offer the first 10 DSLP modules, DSLP (Full) all of DSLP, DWT, MSNR (MMC),
 * MBT. A product that bundles others has them on the request too (its tags), and each opens its own. Anything else
 * (HADC, DQMP…) opens nothing yet.
 */
export function lmsTargetOfProduct(name: unknown): LmsTarget | null {
  const k = productKey(name);
  if (!k) return null;
  if (k.startsWith("DSLP") && k.includes("OFFER")) return { ...CSE_LMS.DSLP_OFFER[0]! };
  if (k.startsWith("DSLP")) return { ...CSE_LMS.DSLP_PRO[0]! };
  if (k.startsWith("DWT") || k.includes("DELTAWAVE")) return { ...CSE_LMS.DWT[0]! };
  if (k.startsWith("MSNR") || k.startsWith("MMC") || k.includes("MARKETMAKING")) return { ...CSE_LMS.MSNR[0]! };
  if (k.startsWith("MBT") || k.includes("BREAKOUT")) return { ...CSE_LMS.MBT[0]! };
  return null;
}

/** Every LMS course a set of products opens, the widest per course (a bundle and its own course). */
export function lmsTargetsOfProducts(names: unknown[]): LmsTarget[] {
  const out: LmsTarget[] = [];
  for (const n of names) {
    const t = lmsTargetOfProduct(n);
    if (!t) continue;
    const have = out.find((o) => sameTitle(o.title, t.title));
    if (!have) out.push(t);
    else if (have.firstModules !== undefined && (t.firstModules === undefined || t.firstModules > have.firstModules)) have.firstModules = t.firstModules;
  }
  return out;
}
