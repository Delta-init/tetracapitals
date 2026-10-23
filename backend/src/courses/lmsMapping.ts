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
 *
 * MSNR opens the LMS's own MSNR course since 2026-10-18 (it used to open MMC,
 * which is now a product of its own — lmsTargetOfProduct). Only MSNR itself
 * moved: inside DSLP PRO and DQMP it still stands for MMC, as before
 * (INCLUDED_AS), so what those open is unchanged.
 */
export interface LmsTarget { title: string; firstModules?: number }

const MSNR_COURSE: LmsTarget = { title: "MSNR - Malaysian Support & Resistance" };
const MMC_COURSE: LmsTarget = { title: "MMC (MARKET MAKING CYCLE)" };

export const CSE_LMS: Record<CourseCode, LmsTarget[]> = {
  MBT: [{ title: "MARKET BREAK-OUT TRADING PROGRAM" }],
  DWT: [{ title: "DELTA WAVE THEORY TRADING PROGRAMME" }],
  MSNR: [MSNR_COURSE],
  DSLP_OFFER: [{ title: "DSLP - Delta Structure & Liquidity Programme", firstModules: 10 }],
  DSLP_PRO: [{ title: "DSLP - Delta Structure & Liquidity Programme" }],
  DQMP: [],
};

export const sameTitle = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/** What a course opens when it comes inside a bigger one, where that differs from its own line (see above). */
const INCLUDED_AS: Partial<Record<CourseCode, LmsTarget[]>> = {
  MSNR: [MMC_COURSE],
};

/** Every LMS course an upgrade to `code` opens: its own and those of the courses it takes off, the widest per course. */
export function lmsTargetsOf(code: CourseCode): { targets: LmsTarget[]; ownMapped: boolean } {
  const out: LmsTarget[] = [];
  for (const c of [code, ...includedCourses(code)]) {
    for (const t of (c !== code && INCLUDED_AS[c]) || CSE_LMS[c] || []) {
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
 * as Course Upgrades map their courses — DSLP Offer the first 10 DSLP modules, DSLP (Full) all of DSLP, DWT, MBT;
 * MSNR its own MSNR course and MMC the MMC course (2026-10-18 — MSNR used to open MMC). A product that bundles others
 * has them on the request too (its tags), and each opens its own. Anything else (HADC, DQMP…) opens nothing yet.
 */
export function lmsTargetOfProduct(name: unknown): LmsTarget | null {
  const k = productKey(name);
  if (!k) return null;
  // By how the name starts, as before; else by the code anywhere in it (2026-10-23: "Pro Trader – DSLP" opened nothing).
  for (const has of [(code: string) => k.startsWith(code), (code: string) => k.includes(code)]) {
    if (has("DSLP") && k.includes("OFFER")) return { ...CSE_LMS.DSLP_OFFER[0]! };
    if (has("DSLP")) return { ...CSE_LMS.DSLP_PRO[0]! };
    if (has("DWT") || k.includes("DELTAWAVE")) return { ...CSE_LMS.DWT[0]! };
    if (has("MSNR") || k.includes("MALAYSIAN")) return { ...MSNR_COURSE };
    if (has("MMC") || k.includes("MARKETMAKING")) return { ...MMC_COURSE };
    if (has("MBT") || k.includes("BREAKOUT")) return { ...CSE_LMS.MBT[0]! };
  }
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
