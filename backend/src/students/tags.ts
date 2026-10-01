import { col } from "../db";

/* ────────────────────────────────────────────────────────────────────────────
   Student tags: labels on a student, picked from one list (student_tags).

   Three kinds:
   - auto — Old, Closed and Common. Never put on by hand: they follow the
     student. Old and Closed come from their Enrolment (Closed only while no
     "Closed - <course>" says more), Common from being on two CSs' own sheets
     (common_cs).
   - closed — "Closed - <course>", one for every course the portal knows: the
     products (Products page) and the LMS courses students arrive with. Putting
     one on a student marks them enrolled (Enrolment: Closed).
   - custom — any other tag an admin adds on the Student Tags page.
   The closed and custom ones are stored on the student as `tags`; the auto
   ones are worked out, so they can never disagree with the student.
──────────────────────────────────────────────────────────────────────────── */

export const AUTO_TAGS = [
  { name: "Old", color: "#d97706" },
  { name: "Closed", color: "#059669" },
  { name: "Common", color: "#ea580c" },
];
const AUTO_NAMES = new Set(AUTO_TAGS.map((t) => t.name));
export const CLOSED_PREFIX = "Closed - ";
export const isClosedTag = (name: string) => name.startsWith(CLOSED_PREFIX);
export const isAutoTag = (name: string) => AUTO_NAMES.has(name);

/**
 * "delta-wave-theory-trading-programme" and "DELTA WAVE THEORY TRADING PROGRAMME" → "Delta Wave Theory Trading
 * Programme"; codes stay upper-case (DSLP). The same as courseLabel() in frontend/src/components/utils/studentProducts.js.
 */
export function courseLabel(raw: unknown): string {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  if (!/\s/.test(s)) s = s.replace(/[-_]+/g, " ");
  const shouting = !/[a-z]/.test(s);
  const word = (w: string) => {
    if (!/[A-Za-z]/.test(w)) return w;
    const isCode = (/^[A-Z0-9&]{2,5}$/.test(w) && (!shouting || !/[AEIOU]/.test(w))) || /^[b-df-hj-np-tv-xz]{3,5}$/i.test(w);
    return isCode ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  };
  return s.replace(/\s+/g, " ").split(" ").map((w) => w.split("-").map(word).join("-")).join(" ");
}

/** The tags a student shows: Old / Closed from their Enrolment, Common, then the ones put on them. */
export function tagNamesOf(s: any): string[] {
  const own: string[] = (Array.isArray(s?.tags) ? s.tags : []).filter((t: unknown): t is string => typeof t === "string" && !!t);
  const auto: string[] = [];
  if (s?.enrolment_status === "old") auto.push("Old");
  if (s?.enrolment_status === "closed" && !own.some(isClosedTag)) auto.push("Closed");
  if ((Array.isArray(s?.common_cs) ? s.common_cs : []).some((c: any) => c?.id && c.id !== s.primary_mentor_id)) auto.push("Common");
  return [...auto, ...own];
}

/** Every course the portal knows: the products, and the LMS courses students arrived with. */
export async function courseNames(): Promise<string[]> {
  const products = (await col("transaction_tags").find({ active: { $ne: false } }, { projection: { name: 1 } }).toArray())
    .map((t: any) => String(t.name ?? "").trim());
  const lms = (await col("students").distinct("lms_course")).map(courseLabel);
  return [...new Set([...products, ...lms].filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** The tag list — first making any auto tag, and a "Closed - <course>" for any course, that is not on it yet. */
export async function tagCatalog(): Promise<any[]> {
  const have = new Set((await col("student_tags").find({}, { projection: { name: 1 } }).toArray()).map((t: any) => String(t.name)));
  const now = new Date().toISOString();
  const missing = [
    ...AUTO_TAGS.map((t) => ({ name: t.name, color: t.color, kind: "auto" })),
    ...(await courseNames()).map((c) => ({ name: `${CLOSED_PREFIX}${c}`, color: "#059669", kind: "closed", course: c })),
  ]
    .filter((t) => !have.has(t.name))
    .map((t) => ({ ...t, active: true, created_date: now, updated_date: now, created_by: "", created_by_name: "Tetra Commission" }));
  if (missing.length) {
    // The name is unique (db.ts), so two pages opening at once cannot make the same tag twice.
    await col("student_tags").insertMany(missing, { ordered: false }).catch((err: any) => {
      if (err?.code !== 11000 && !err?.writeErrors?.every?.((e: any) => e?.code === 11000)) throw err;
    });
  }
  return col("student_tags").find({}).toArray();
}
