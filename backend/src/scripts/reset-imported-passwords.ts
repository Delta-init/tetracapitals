/**
 * Set a default password on every imported user (the User CSV doesn't
 * carry a password_hash, so they can't log in until we set one).
 *
 * Usage:  MONGO_URI=mongodb://127.0.0.1:27017 bun src/scripts/reset-imported-passwords.ts
 *
 * Skips users whose email matches KEEP_ADMIN_EMAIL (the local super admin).
 */
import bcrypt from "bcryptjs";
import { MongoClient } from "mongodb";
import { config } from "../config";

const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || "ChangeMe123!";
const KEEP_EMAIL = (process.env.KEEP_ADMIN_EMAIL || "super@tetracapitals.com").toLowerCase();

async function main() {
  const client = new MongoClient(config.mongoUri, { maxPoolSize: 5 });
  await client.connect();
  const d = client.db(config.mongoDb);

  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const res = await d.collection("users").updateMany(
    { email: { $ne: KEEP_EMAIL } },
    { $set: { password_hash: hash } }
  );
  console.log(`Set default password '${DEFAULT_PASSWORD}' on ${res.modifiedCount} users (kept ${KEEP_EMAIL} as-is).`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
