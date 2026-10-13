import { col } from "../db";

/* ────────────────────────────────────────────────────────────────────────────
   Who a Not linked Zoho invoice is most likely for (the user, 2026-10-13).

   The import (scripts/import-zoho-invoices.ts) links only a sure match — one
   student by email, else by phone — and leaves the rest Not linked: often the
   email is one student's and the phone another's (a duplicate record), or the
   email has a typo. Here every student is looked at for each invoice:
     Strong   the same email (one student has it); or an email typo — a
              misspelt domain (gamil.com), one or two letters off, the same
              name at another domain — with the same name too;
     Likely   an email typo alone or with the phone (a family member's is
              often one letter off); or the same phone and the same name;
     Weak     the same phone alone (family / shared numbers) or the name alone.
   Suggestions only: an admin links them (the Invoices page), or
   scripts/link-zoho-suggested.ts links the Strong ones.
──────────────────────────────────────────────────────────────────────────── */

export type Strength = "strong" | "likely" | "weak";
export type Suggestion = {
  student_id: string; student_code: string; full_name: string; email: string; phone: string; cs: string;
  strength: Strength; how: string[];
  /** The first names agree (one starts the other's, 4 letters at least) — what a Likely one needs to be linked for you. */
  name_agrees: boolean;
};
/** Addresses many people share the start of — info@, admin@ … — never a match by it alone. */
const GENERIC_LOCAL = /^(info|admin|contact|accounts?|sales|office|support|hello|mail|enquir(y|ies)|hr|finance|billing)$/;

const RANK: Record<Strength, number> = { strong: 1, likely: 2, weak: 3 };
const DOMAIN_TYPOS: Record<string, string> = {
  "gamil.com": "gmail.com", "gmial.com": "gmail.com", "gmal.com": "gmail.com", "gmai.com": "gmail.com", "gmail.co": "gmail.com",
  "gnail.com": "gmail.com", "gmail.con": "gmail.com", "gmail.coom": "gmail.com", "gmaill.com": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "yahoo.co": "yahoo.com", "yaho.com": "yahoo.com",
};

const norm = (e: unknown) => String(e ?? "").trim().toLowerCase();
const phone9 = (p: unknown) => { const d = String(p ?? "").replace(/\D/g, ""); return d.length >= 9 ? d.slice(-9) : ""; };
const nameKey = (n: unknown) => String(n ?? "").toLowerCase().replace(/^(mr|mrs|ms|dr)\.?\s+/, "").replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 1).sort().join(" ");
const firstName = (n: unknown) => String(n ?? "").toLowerCase().replace(/^(mr|mrs|ms|dr)\.?\s+/, "").replace(/[^a-z ]/g, " ").trim().split(/\s+/)[0] ?? "";
const namesAgree = (a: unknown, b: unknown) => {
  const x = firstName(a), y = firstName(b);
  if (x.length < 3 || y.length < 3) return false;
  const n = Math.min(4, x.length, y.length);
  return x.slice(0, n) === y.slice(0, n);
};
const fixDomain = (e: string) => { const [l, d] = e.split("@"); return d && DOMAIN_TYPOS[d] ? `${l}@${DOMAIN_TYPOS[d]}` : e; };

/** Letters apart (stops early past 2). */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      low = Math.min(low, cur[j]!);
    }
    if (low > 2) return 9;
    prev = cur;
  }
  return prev[b.length]!;
}

type Index = { byEmail: Map<string, any[]>; byLocal: Map<string, any[]>; byPhone: Map<string, any[]>; byName: Map<string, any[]>; emails: string[] };
let cached: { at: number; index: Promise<Index> } | null = null;

/** Every student by email, the part before the @, phone and name — kept a minute. */
function index(): Promise<Index> {
  if (cached && Date.now() - cached.at < 60_000) return cached.index;
  const build = (async () => {
    const students = (await col("students").find({}, { projection: { student_code: 1, full_name: 1, email: 1, phone: 1, primary_mentor_name: 1 } }).toArray()) as any[];
    const byEmail = new Map<string, any[]>(), byLocal = new Map<string, any[]>(), byPhone = new Map<string, any[]>(), byName = new Map<string, any[]>();
    const put = (m: Map<string, any[]>, k: string, s: any) => { if (k) (m.get(k) ?? m.set(k, []).get(k)!).push(s); };
    for (const s of students) {
      const e = norm(s.email);
      put(byEmail, e, s);
      put(byLocal, e.includes("@") ? e.split("@")[0]! : "", s);
      put(byPhone, phone9(s.phone), s);
      const nk = nameKey(s.full_name);
      if (nk.includes(" ")) put(byName, nk, s);
    }
    return { byEmail, byLocal, byPhone, byName, emails: [...byEmail.keys()] };
  })();
  cached = { at: Date.now(), index: build };
  build.catch(() => { cached = null; });
  return build;
}

/** The students an invoice's customer may be, most likely first (at most `max`). */
export async function suggestionsFor(customer: { name?: unknown; email?: unknown; phone?: unknown }, max = 3): Promise<Suggestion[]> {
  const ix = await index();
  const e = norm(customer?.email), ph = phone9(customer?.phone), nk = nameKey(customer?.name);
  const hits = new Map<string, { s: any; how: Set<string> }>();
  const add = (s: any, how: string) => { const k = String(s._id); (hits.get(k) ?? hits.set(k, { s, how: new Set() }).get(k)!).how.add(how); };
  if (e.includes("@")) {
    for (const s of ix.byEmail.get(e) ?? []) add(s, "same email");
    const fixed = fixDomain(e);
    if (fixed !== e) for (const s of ix.byEmail.get(fixed) ?? []) add(s, "email typo");
    const local = e.split("@")[0]!;
    if (!GENERIC_LOCAL.test(local)) for (const s of ix.byLocal.get(local) ?? []) if (norm(s.email) !== e) add(s, "email typo");
    if (e.length > 8) for (const o of ix.emails) if (o !== e && o.includes("@") && distance(e, o) <= 2) for (const s of ix.byEmail.get(o) ?? []) add(s, "email typo");
  }
  if (ph) for (const s of ix.byPhone.get(ph) ?? []) add(s, "same phone");
  if (nk.includes(" ")) for (const s of ix.byName.get(nk) ?? []) add(s, "same name");
  const sameEmail = (ix.byEmail.get(e) ?? []).length;
  const out: Suggestion[] = [...hits.values()].map(({ s, how }) => {
    const em = how.has("same email"), typo = how.has("email typo"), p = how.has("same phone"), n = how.has("same name");
    const strength: Strength =
      (em && sameEmail === 1) || (typo && n) ? "strong"
        : em || typo || (p && n) ? "likely"
          : "weak";
    return {
      student_id: String(s._id), student_code: String(s.student_code ?? ""), full_name: String(s.full_name ?? "").trim(), email: String(s.email ?? ""),
      phone: String(s.phone ?? ""), cs: String(s.primary_mentor_name ?? ""), strength, how: [...how],
      name_agrees: n || namesAgree(customer?.name, s.full_name),
    };
  });
  // Equally sure: the exact email first, then the name, then the phone.
  const weight = (x: Suggestion) => (x.how.includes("same email") ? 8 : 0) + (x.how.includes("same name") ? 4 : 0) + (x.how.includes("email typo") ? 2 : 0) + (x.how.includes("same phone") ? 1 : 0);
  return out.sort((a, b) => RANK[a.strength] - RANK[b.strength] || weight(b) - weight(a)).slice(0, max);
}

export const strengthRank = (s?: Strength | null) => (s ? RANK[s] : 9);
