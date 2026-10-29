// Entry point. Reads .env (via tsx --env-file-if-exists), picks live or MOCK mode, starts the server.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startApp } from "./app";
import { AnthropicModel, errorMessage, type ModelClient } from "./model";
import { MockModel } from "./mock";

const here = dirname(fileURLToPath(import.meta.url));
const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
const modelName = (process.env.MODEL ?? "").trim() || "claude-sonnet-5-5";
const mockFlag = process.env.MOCK === "1" || process.env.MOCK === "true";
// HQ_PORT, not PORT: launchers often set PORT to the web port, which would collide with Vite.
const port = Number(process.env.HQ_PORT ?? 8787);

let model: ModelClient;
if (mockFlag || !apiKey) {
  model = new MockModel();
  console.log(`[hq] MOCK mode (${mockFlag ? "MOCK=1" : "no ANTHROPIC_API_KEY"}): fake streamed replies and fake delegation.`);
} else {
  model = new AnthropicModel(apiKey, modelName);
  console.log(`[hq] LIVE mode, model ${modelName}.`);
}

process.on("unhandledRejection", (err) => console.error("[hq] unhandled rejection (contained):", errorMessage(err)));
process.on("uncaughtException", (err) => console.error("[hq] uncaught exception (contained):", errorMessage(err)));

const app = await startApp({
  model,
  dbPath: process.env.HQ_DB ?? join(here, "..", "data", "hq.sqlite"),
  port,
  meetingMs: process.env.MEETING_MS ? Number(process.env.MEETING_MS) : undefined,
});
console.log(`[hq] server on http://127.0.0.1:${app.port} (ws /ws)`);

const shutdown = () => {
  void app.close().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
