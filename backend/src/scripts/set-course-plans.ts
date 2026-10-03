/**
 * The courses a Bonus (a course payment) can be for, with their terms from Delta_Fee_Structure.pdf (the user,
 * 2026-10-03): DWT, MSNR, DSLP Offer and DSLP Full. MBT and MBT + DWT are left out — sold at enrolment, no bonus here.
 * Sets each one's full price, whole bonus and AED 2,000 instalments on its product (the Products page), creating the
 * product when there is none. Only courses with a bonus set are offered on a Bonus request.
 *
 *   cd backend
 *   bun src/scripts/set-course-plans.ts                                     shows every product and what it would set
 *   bun src/scripts/set-course-plans.ts --dslp-offer="DSLP"                 points a course at a product by its name
 *        (--dwt=, --msnr=, --dslp-offer=, --dslp-full=)
 *   bun src/scripts/set-course-plans.ts --apply                             does it; saves an undo file first
 *   bun src/scripts/set-course-plans.ts --undo=<file> [--apply]             puts it back
 *
 * Uses the same database as the API (MONGO_URI / MONGO_DB, from this folder's .env). Running it again changes nothing.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { connectDb, col, closeDb } from "../db";
import { toObjectId } from "../lib/id";

const apply = process.argv.includes("--apply");
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = new Date().toISOString();
const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split("/")[0];
const SCRIPT = "set-course-plans";
const AED_PER_USD = 3.67;
const MISSING = { $missing: true };

/** "DSLP — Offer Price" → "DSLPOFFERPRICE": the same name, however it was typed. */
const norm = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

type Terms = { full_price: number; full_price_currency: "AED" | "USD"; bonus_usd: number; instalments: number };
const COURSES: { key: string; title: string; terms: Terms; match: (n: string) => boolean }[] = [
  { key: "dwt", title: "DWT", terms: { full_price: 3250, full_price_currency: "AED", bonus_usd: 500, instalments: 0 }, match: (n) => n === "DWT" },
  { key: "msnr", title: "MSNR", terms: { full_price: 3000, full_price_currency: "USD", bonus_usd: 3000, instalments: 6 }, match: (n) => n === "MSNR" },
  { key: "dslp-offer", title: "DSLP Offer", terms: { full_price: 5000, full_price_currency: "USD", bonus_usd: 5000, instalments: 10 }, match: (n) => n.startsWith("DSLP") && n.includes("OFFER") },
  { key: "dslp-full", title: "DSLP Full", terms: { full_price: 7000, full_price_currency: "USD", bonus_usd: 7000, instalments: 14 }, match: (n) => n.startsWith("DSLP") && n.includes("FULL") },
];
const FIELDS = ["full_price", "full_price_currency", "bonus_usd", "instalments", "bonus_type", "active"] as const;

const money = (t: Terms) => (t.full_price_currency === "AED" ? `AED ${t.full_price.toLocaleString("en-US")}` : `$${t.full_price.toLocaleString("en-US")}`);
const describe = (t: Terms) =>
  `full ${money(t)} → bonus $${t.bonus_usd.toLocaleString("en-US")} at once` +
  (t.instalments ? ` · or ${t.instalments} × AED 2,000 → $500 each` : " · full payment only");

const log = {
  script: SCRIPT, database: config.mongoDb, host, applied_at: now,
  updated: [] as { id: string; name: string; before: Record<string, unknown>; after: Record<string, unknown> }[],
  created: [] as { id: string; name: string }[],
};

async function run() {
  const products = (await col("transaction_tags").find({}).sort({ name: 1 }).toArray()) as any[];
  console.log(`\nProducts now (${products.length}):`);
  for (const p of products) {
    const terms = Number(p.bonus_usd) > 0 ? ` · course terms: full ${p.full_price_currency === "AED" ? "AED " : "$"}${p.full_price ?? 0}, bonus $${p.bonus_usd}, ${p.instalments ?? 0} instalments` : "";
    console.log(`  ${String(p.name).padEnd(28)} amount $${p.amount_usd ?? 0} · ${p.bonus_type === "without" ? "without bonus" : "with bonus"}${p.active === false ? " · inactive" : ""}${terms}`);
  }

  type Plan = { course: (typeof COURSES)[number]; product: any | null; problem?: string; changes: Record<string, [unknown, unknown]> };
  const plans: Plan[] = [];
  for (const course of COURSES) {
    const named = option(course.key);
    let product: any | null = null;
    let problem: string | undefined;
    if (named) {
      product = products.find((p) => norm(p.name) === norm(named)) ?? null;
      if (!product) problem = `no product called "${named}"`;
    } else {
      const found = products.filter((p) => course.match(norm(p.name)));
      if (found.length === 1) product = found[0];
      else if (found.length > 1) problem = `several products could be it (${found.map((p) => `"${p.name}"`).join(", ")}) — say which with --${course.key}="<name>"`;
    }
    const after: Record<string, unknown> = { ...course.terms, bonus_type: "with", active: true };
    const changes: Record<string, [unknown, unknown]> = {};
    if (product) for (const f of FIELDS) if (JSON.stringify(product[f] ?? null) !== JSON.stringify(after[f])) changes[f] = [product[f] ?? null, after[f]];
    plans.push({ course, product, problem, changes });
  }

  console.log(`\nCourses on a Bonus request:`);
  for (const p of plans) {
    const head = `  ${p.course.title.padEnd(11)} ${describe(p.course.terms)}`;
    if (p.problem) console.log(`${head}\n      ✗ ${p.problem} — left out`);
    else if (!p.product) console.log(`${head}\n      → new product "${p.course.title}"`);
    else if (!Object.keys(p.changes).length) console.log(`${head}\n      ✓ "${p.product.name}" — already set`);
    else console.log(`${head}\n      → "${p.product.name}": ${Object.entries(p.changes).map(([f, [a, b]]) => `${f} ${JSON.stringify(a)} → ${JSON.stringify(b)}`).join(", ")}`);
  }
  const loneDslp = products.find((p) => norm(p.name) === "DSLP");
  if (loneDslp && !option("dslp-offer") && !option("dslp-full")) {
    console.log(`\n  There's a product called "${loneDslp.name}". If it is one of the DSLP courses, point at it — e.g. --dslp-offer="${loneDslp.name}" —`);
    console.log(`  or it stays as it is (not offered on a Bonus) and the DSLP courses get products of their own.`);
  }
  console.log(`\nLeft as they are: every other product (MBT and MBT + DWT included) — not offered on a Bonus request.`);

  const todo = plans.filter((p) => !p.problem && (!p.product || Object.keys(p.changes).length));
  if (!todo.length) { console.log("\nNothing to change."); return; }
  if (!apply) { console.log(`\nNothing written — run again with --apply to set ${todo.length} course(s).`); return; }

  const undoPath = join(homedir(), `${SCRIPT}-undo-${now.replace(/[:.]/g, "-")}.json`);
  const saveUndo = () => Bun.write(undoPath, JSON.stringify(log, null, 1));
  try {
    await saveUndo();
    for (const p of todo) {
      const after = { ...p.course.terms, bonus_type: "with", active: true };
      if (p.product) {
        log.updated.push({
          id: String(p.product._id), name: p.product.name,
          before: Object.fromEntries([...FIELDS, "updated_date"].map((f) => [f, f in p.product ? p.product[f] : MISSING])),
          after: { ...after, updated_date: now },
        });
        await saveUndo();
        await col("transaction_tags").updateOne({ _id: p.product._id }, { $set: { ...after, updated_date: now } });
        console.log(`  ✓ ${p.course.title}: "${p.product.name}" set`);
      } else {
        const t = p.course.terms;
        const usd = t.full_price_currency === "AED" ? Math.round((t.full_price / AED_PER_USD) * 100) / 100 : t.full_price;
        const res = await col("transaction_tags").insertOne({
          name: p.course.title, color: "#2563eb", amount_usd: usd, includes: [], ...after,
          created_by: SCRIPT, created_date: now, updated_date: now,
        } as any);
        log.created.push({ id: String(res.insertedId), name: p.course.title });
        await saveUndo();
        console.log(`  ✓ ${p.course.title}: new product created`);
      }
    }
    console.log(`\nDone: ${log.updated.length} product(s) set, ${log.created.length} created.`);
  } finally {
    if (log.updated.length || log.created.length) {
      await saveUndo();
      console.log(`Undo file: ${undoPath}\n  bun src/scripts/${SCRIPT}.ts --undo=${undoPath}          (shows what it would put back)`);
    }
  }
}

async function undo(file: string) {
  const saved = JSON.parse(await Bun.file(file).text()) as typeof log;
  if (saved.script !== SCRIPT) throw new Error(`${file} is not an undo file of ${SCRIPT}.`);
  if (saved.database !== config.mongoDb || saved.host !== host) throw new Error(`That undo file is for "${saved.database}" on ${saved.host}, not this database.`);
  console.log(`\nUndo of ${SCRIPT} on ${saved.applied_at}:`);
  for (const u of saved.updated) console.log(`  "${u.name}" — its course terms put back as they were`);
  // A product made here is taken away again — or, when a request uses it by now, switched off instead.
  const used = new Map<string, number>();
  for (const c of saved.created) used.set(c.id, await col("funding_transactions").countDocuments({ tags: c.name }));
  for (const c of saved.created) console.log(`  "${c.name}" — ${used.get(c.id) ? `used by ${used.get(c.id)} request(s): switched off, not deleted` : "deleted"}`);
  if (!apply) { console.log("\nNothing written — run again with --apply to put it back."); return; }
  for (const u of saved.updated) {
    const $set: Record<string, unknown> = {}, $unset: Record<string, ""> = {};
    for (const [f, v] of Object.entries(u.before)) { if (v && typeof v === "object" && (v as any).$missing) $unset[f] = ""; else $set[f] = v; }
    await col("transaction_tags").updateOne({ _id: toObjectId(u.id) as any }, { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) });
  }
  for (const c of saved.created) {
    if (used.get(c.id)) await col("transaction_tags").updateOne({ _id: toObjectId(c.id) as any }, { $set: { active: false, updated_date: new Date().toISOString() } });
    else await col("transaction_tags").deleteOne({ _id: toObjectId(c.id) as any });
  }
  console.log("\nPut back.");
}

await connectDb();
console.log(`${SCRIPT} on "${config.mongoDb}" at ${host}${apply ? "" : " (dry run)"}`);
try {
  const file = option("undo");
  if (file) await undo(file);
  else await run();
} finally {
  await closeDb();
}
