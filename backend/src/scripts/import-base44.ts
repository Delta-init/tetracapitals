/**
 * Import Base44 CSV exports into MongoDB.
 *
 * Usage:
 *   bun run src/scripts/import-base44.ts [path/to/exports/dir]
 *
 * Expected file names: <EntityName>_export.csv (e.g. Ticket_export.csv).
 * Entity name → collection mapping comes from src/entities/registry.ts.
 *
 *  - IDs are preserved as MongoDB ObjectIds (Base44 emits 24-char hex strings).
 *  - Dates with 6-digit microseconds are normalized to ISO milliseconds.
 *  - Numeric / boolean strings are coerced to native types.
 *  - Empty cells become `undefined` (i.e. the field is omitted from the doc).
 *  - Embedded JSON (badges, co_mentors_details, quiz_data, etc.) stays as a string,
 *    matching the shape the frontend already expects.
 *  - Imports are idempotent: each row is upserted by _id, so re-runs are safe.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ObjectId } from "mongodb";
import { connectDb, closeDb, col, ensureIndexes } from "../db";
import { ENTITIES } from "../entities/registry";

// ─── CSV parser (RFC 4180 + Excel-style escapes) ──────────────────────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
        field = "";
      } else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ─── value coercion ───────────────────────────────────────────────────────
function coerce(v: string): unknown {
  if (v === "" || v === undefined) return undefined;
  if (v === "true") return true;
  if (v === "false") return false;
  // ObjectId-shaped values stay as strings (they are foreign keys, not numbers)
  if (/^[0-9a-f]{24}$/.test(v)) return v;
  // Plain number (integer or decimal, possibly negative)
  if (/^-?\d+(\.\d+)?$/.test(v) && !v.startsWith("0") || /^-?0(\.\d+)$/.test(v) || v === "0") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}

// Normalize "2026-05-28T13:05:02.075000" (6-digit microseconds) → "...075Z"
function normalizeDate(v: string): string {
  const m = v.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.(\d{3,6}))?(Z)?$/);
  if (!m) return v;
  const base = m[1];
  const ms = (m[3] ?? "000").slice(0, 3).padEnd(3, "0");
  return `${base}.${ms}Z`;
}

function rowToDoc(headers: string[], row: string[]): Record<string, unknown> {
  const doc: Record<string, unknown> = {};
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i];
    if (!key) continue;
    const raw = row[i] ?? "";
    if (raw === "") continue;
    if (key === "id") {
      if (/^[0-9a-f]{24}$/.test(raw)) doc._id = new ObjectId(raw);
      continue;
    }
    // Date-like keys
    if (
      key.endsWith("_date") || key.endsWith("_at") ||
      key === "timestamp" || key === "generated_at" || key === "since" ||
      key === "last_calculated_date"
    ) {
      doc[key] = normalizeDate(raw);
      continue;
    }
    // is_sample is informational, skip
    if (key === "is_sample") continue;
    doc[key] = coerce(raw);
  }
  return doc;
}

async function importFile(entityName: string, filePath: string): Promise<{ inserted: number; updated: number; skipped: number; errors: string[] }> {
  const cfg = ENTITIES[entityName];
  if (!cfg) return { inserted: 0, updated: 0, skipped: 0, errors: [`unknown entity ${entityName}`] };
  const text = await readFile(filePath, "utf8");
  const rows = parseCsv(text);
  if (!rows.length) return { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const headers = rows[0];
  const data = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
  if (!data.length) return { inserted: 0, updated: 0, skipped: 0, errors: [] };

  const c = col(cfg.collection);
  const ops = data.map((row) => {
    const doc = rowToDoc(headers, row);
    if (!doc._id) return null; // require id
    const { _id, ...rest } = doc;
    return {
      updateOne: {
        filter: { _id },
        update: { $set: rest, $setOnInsert: { _id } },
        upsert: true,
      },
    };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  if (!ops.length) return { inserted: 0, updated: 0, skipped: data.length, errors: ["no rows had a valid id"] };
  const res = await c.bulkWrite(ops as any, { ordered: false });
  return {
    inserted: res.upsertedCount ?? 0,
    updated: res.modifiedCount ?? 0,
    skipped: data.length - (res.upsertedCount ?? 0) - (res.modifiedCount ?? 0),
    errors: [],
  };
}

// ─── special case: User import isn't covered by export but mentors are
// referenced by id everywhere; we synthesize minimal User docs from any
// mentor_id we discover in the data so foreign keys resolve. They get
// `app_role: 'senior_mentor'` as a sensible default and no password
// (login will fail until you set one through change-password / re-seed).
async function synthesizeUsersFrom(entityName: string): Promise<number> {
  const cfg = ENTITIES[entityName];
  if (!cfg) return 0;
  const c = col(cfg.collection);
  const users = col("users");
  const idFields = ["mentor_id", "primary_mentor_id", "senior_mentor_id", "initiating_mentor_id", "created_by_id", "assigned_by_id", "processed_by_id"];
  const nameFields: Record<string, string> = {
    mentor_id: "mentor_name", primary_mentor_id: "primary_mentor_name",
    senior_mentor_id: "senior_mentor_name", initiating_mentor_id: "initiating_mentor_name",
    created_by_id: "created_by_name", assigned_by_id: "assigned_by_name",
    processed_by_id: "processed_by_name",
  };
  let created = 0;
  const docs = await c.find({}).limit(50_000).toArray();
  const seen = new Set<string>();
  for (const d of docs as any[]) {
    for (const f of idFields) {
      const id = d[f];
      if (!id || typeof id !== "string" || !/^[0-9a-f]{24}$/.test(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      const oid = new ObjectId(id);
      const existing = await users.findOne({ _id: oid });
      if (existing) continue;
      const name = d[nameFields[f]] || `User ${id.slice(-6)}`;
      // Use the "created_by" CSV field (email) when we can — only when the id matches.
      const email = (f === "created_by_id" && typeof d.created_by === "string") ? d.created_by : `${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}+imported@example.com`;
      await users.insertOne({
        _id: oid, email, full_name: name,
        app_role: "senior_mentor",   // sensible default — change via admin UI
        commission_rate: 4,
        upline_commission_percentage: 0,
        password_hash: "",            // login disabled until reset
        created_date: new Date().toISOString(),
        updated_date: new Date().toISOString(),
        imported: true,
      } as any);
      created++;
    }
  }
  return created;
}

async function main() {
  const dir = process.argv[2] ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "Downloads");
  console.log(`[import] reading from ${dir}`);
  await connectDb();
  await ensureIndexes();

  const all = await readdir(dir);
  const files = all.filter((f) => /_export\.csv$/i.test(f));
  console.log(`[import] found ${files.length} *_export.csv files`);

  const results: Record<string, any> = {};
  for (const f of files) {
    const entityName = f.replace(/_export\.csv$/i, "");
    if (!ENTITIES[entityName]) {
      console.log(`  ⚠  ${f} → no registry entry for '${entityName}', skipping`);
      continue;
    }
    try {
      const r = await importFile(entityName, join(dir, f));
      results[entityName] = r;
      console.log(`  ✓ ${entityName.padEnd(28)} inserted=${r.inserted} updated=${r.updated} skipped=${r.skipped}${r.errors.length ? " errors=" + r.errors.join(",") : ""}`);
    } catch (e: any) {
      console.log(`  ✗ ${entityName.padEnd(28)} ERROR: ${e.message}`);
      results[entityName] = { error: e.message };
    }
  }

  // Synthesize missing user records referenced by any imported entity
  console.log("\n[import] synthesizing missing User records from foreign keys…");
  let synth = 0;
  for (const entityName of Object.keys(results)) {
    if (entityName === "User") continue;
    synth += await synthesizeUsersFrom(entityName);
  }
  console.log(`  ✓ synthesized ${synth} user(s) for unresolved foreign keys`);

  // Collection counts after
  console.log("\n[import] post-import collection counts:");
  for (const [name, cfg] of Object.entries(ENTITIES)) {
    const n = await col(cfg.collection).estimatedDocumentCount();
    if (n > 0) console.log(`  ${name.padEnd(28)} ${n}`);
  }

  await closeDb();
  console.log("\n[import] done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
