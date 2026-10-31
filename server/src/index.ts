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
// PORT is honoured when HQ serves the built web app itself (hosting platforms set PORT).
const staticDir = process.env.HQ_STATIC_DIR ? process.env.HQ_STATIC_DIR : undefined;
const port = Number(process.env.HQ_PORT ?? (staticDir ? process.env.PORT : undefined) ?? 8787);
const host = (process.env.HQ_HOST ?? "").trim() || "127.0.0.1";
const ownerToken = (process.env.HQ_OWNER_TOKEN ?? "").trim() || undefined;
const publicDetail = process.env.HQ_PUBLIC_DETAIL === "full" ? "full" : "office";
if (host !== "127.0.0.1" && host !== "localhost" && !ownerToken) {
  console.error("[hq] refusing to listen on a public address without HQ_OWNER_TOKEN (anyone could command the agents).");
  process.exit(1);
}

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
  host,
  ownerToken,
  publicDetail,
  staticDir,
  meetingMs: process.env.MEETING_MS ? Number(process.env.MEETING_MS) : undefined,
});
console.log(`[hq] server on http://${host}:${app.port} (ws /ws)${ownerToken ? `, PUBLIC: viewers watch (${publicDetail}), owner logs in` : ""}${staticDir ? ", serving web app" : ""}`);

const shutdown = () => {
  void app.close().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
