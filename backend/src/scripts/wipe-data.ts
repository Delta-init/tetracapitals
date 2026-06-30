/**
 * Wipe every collection in the database, EXCEPT keep the super_admin
 * account so the operator can still log in.
 *
 * Usage:  CONFIRM_WIPE=yes bun src/scripts/wipe-data.ts
 *
 * Connects directly (no authSource) because the dev embedded
 * mongo-memory-server has no auth — production goes through db.ts.
 */
import { MongoClient } from "mongodb";
import { config } from "../config";

const KEEP_EMAIL = (process.env.KEEP_ADMIN_EMAIL || "super@tetracapitals.com").toLowerCase();

async function main() {
  if (process.env.CONFIRM_WIPE !== "yes") {
    console.error("Refusing to wipe — set CONFIRM_WIPE=yes to proceed.");
    process.exit(1);
  }

  const client = new MongoClient(config.mongoUri, { maxPoolSize: 5 });
  await client.connect();
  const d = client.db(config.mongoDb);

  const admin = await d.collection("users").findOne({ email: KEEP_EMAIL });
  if (!admin) {
    console.error(`No user found with email ${KEEP_EMAIL} — aborting so you don't lock yourself out.`);
    process.exit(1);
  }
  console.log(`Will preserve super admin: ${admin.email} (${admin._id})`);

  const collections = await d.listCollections().toArray();
  console.log(`Found ${collections.length} collections:`, collections.map(c => c.name).join(", "));

  let totalDeleted = 0;
  for (const c of collections) {
    if (c.name.startsWith("system.")) continue;
    if (c.name === "users") {
      const res = await d.collection("users").deleteMany({ _id: { $ne: admin._id } });
      console.log(`  users: deleted ${res.deletedCount} (kept 1 super admin)`);
      totalDeleted += res.deletedCount;
    } else {
      const res = await d.collection(c.name).deleteMany({});
      console.log(`  ${c.name}: deleted ${res.deletedCount}`);
      totalDeleted += res.deletedCount;
    }
  }

  console.log(`Total docs deleted: ${totalDeleted}`);
  await client.close();
  console.log("Done. The running backend will re-create indexes on next request.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
