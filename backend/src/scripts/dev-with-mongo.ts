/**
 * Boot a MongoDB (in-memory but on-disk so data persists across restarts),
 * expose its URI via MONGO_URI, then start the normal server. Handy for
 * local dev / CI when you don't have mongod installed.
 *
 *   bun run src/scripts/dev-with-mongo.ts
 *
 * Data is persisted under ./data/mongo so killing the process doesn't wipe
 * imported records. Delete that directory to start fresh.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";

const dbPath = resolve(process.cwd(), "data/mongo");
mkdirSync(dbPath, { recursive: true });

const mongod = await MongoMemoryServer.create({
  instance: {
    dbName: process.env.MONGO_DB ?? "student_tracker",
    port: 27017,
    dbPath,
    storageEngine: "wiredTiger",
  },
});
process.env.MONGO_URI = mongod.getUri().replace(/\/[^/]*$/, "");
console.log(`[dev-with-mongo] Embedded MongoDB at ${process.env.MONGO_URI}`);

// Import after env is set so config.ts picks up the new MONGO_URI.
await import("../index.ts");

const shutdown = async () => {
  console.log("[dev-with-mongo] Stopping embedded MongoDB...");
  await mongod.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
