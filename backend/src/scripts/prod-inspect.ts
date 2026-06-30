/**
 * One-off: connect to a remote Mongo and report what's there before any
 * destructive action. Lists super_admin users + per-collection counts.
 *
 * Usage:  MONGO_URI="mongodb://..." bun src/scripts/prod-inspect.ts
 */
import { MongoClient } from "mongodb";

async function main() {
  const host = process.env.MONGO_HOST || "31.97.237.248:27017";
  const dbName = process.env.MONGO_DB_NAME || "tetra";
  const user = process.env.MONGO_USER || "admin";
  const pass = process.env.MONGO_PASS || "";
  const authSource = process.env.MONGO_AUTHSOURCE || "admin";
  if (!pass) throw new Error("MONGO_PASS required");

  console.log(`Connecting to ${host}/${dbName} as ${user} (authSource=${authSource})`);

  const client = new MongoClient(`mongodb://${host}/`, {
    auth: { username: user, password: pass },
    authSource,
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 15_000,
  });
  await client.connect();

  // First, list all databases on the server so we can pick the right one.
  const dbs = await client.db("admin").admin().listDatabases();
  console.log("--- databases on server ---");
  for (const db of dbs.databases) console.log(`  ${db.name.padEnd(30)} ${db.sizeOnDisk ?? '?'} bytes`);

  const d = client.db(dbName);

  const collections = await d.listCollections().toArray();
  console.log(`DB: ${dbName} — ${collections.length} collections`);
  console.log("--- counts ---");
  for (const c of collections) {
    if (c.name.startsWith("system.")) continue;
    const n = await d.collection(c.name).estimatedDocumentCount();
    console.log(`  ${c.name.padEnd(34)} ${n}`);
  }

  console.log("--- super_admin users ---");
  const admins = await d.collection("users").find({ app_role: "super_admin" }).project({ email: 1, full_name: 1 }).toArray();
  for (const a of admins) console.log(`  ${(a as any).email}  — ${(a as any).full_name}  (id=${a._id})`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
