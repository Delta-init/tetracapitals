/**
 * Boot an in-memory MongoDB, expose its URI via MONGO_URI, then start the
 * normal server. Handy for local dev / CI when you don't have mongod installed.
 *
 *   bun run src/scripts/dev-with-mongo.ts
 */
import { MongoMemoryServer } from "mongodb-memory-server";

const mongod = await MongoMemoryServer.create({
  instance: { dbName: process.env.MONGO_DB ?? "student_tracker", port: 27017 },
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
