import { config } from "./config";
import { connectDb, ensureIndexes, closeDb } from "./db";
import { route } from "./router";
import { error as errorResponse } from "./lib/response";
import { startFinanceFundingWorker } from "./finance/funding";
import { startInactivityWorker } from "./students/inactivity";
import { startReminderWorker } from "./students/followupReminders";
import { startCallSyncWorker } from "./students/calls";

async function main() {
  await connectDb();
  await ensureIndexes();
  console.log(`[student-tracker] MongoDB connected: ${config.mongoDb}`);

  const server = Bun.serve({
    port: config.port,
    async fetch(req) {
      try {
        return await route(req);
      } catch (err) {
        console.error("[handler error]", err);
        const msg = err instanceof Error ? err.message : "Internal server error";
        return errorResponse(msg, 500);
      }
    },
  });
  console.log(`[student-tracker] API listening on http://localhost:${server.port}`);
  // New deposit requests to Delta finance for approval, retried until it has them.
  startFinanceFundingWorker();
  // Students held by a CS with no approved deposit for 90 days move team (off until switched on).
  startInactivityWorker();
  // Follow-up reminder emails, 10:00 UAE each day (FOLLOWUP_REMINDERS=off to keep a server out of it).
  startReminderWorker();
  // Calls with students (and their recordings) from 3CX, every 5 minutes — once THREECX_* is set.
  startCallSyncWorker();
}

const shutdown = async (signal: string) => {
  console.log(`\n[student-tracker] ${signal} received, shutting down...`);
  await closeDb();
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((err) => {
  console.error("[startup failed]", err);
  process.exit(1);
});
