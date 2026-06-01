import { config } from "./config";
import { connectDb, ensureIndexes, closeDb } from "./db";
import { route } from "./router";
import { error as errorResponse } from "./lib/response";

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
