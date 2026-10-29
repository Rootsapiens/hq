import { defineConfig } from "@playwright/test";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// Fresh e2e database per run, inside the repo (server/data is git-ignored).
// The env var keeps one name across the runner and its workers, which re-read this file.
const dataDir = join(import.meta.dirname, "server", "data");
if (!process.env.HQ_E2E_DB) {
  mkdirSync(dataDir, { recursive: true });
  for (const f of readdirSync(dataDir)) {
    if (f.startsWith("e2e-")) rmSync(join(dataDir, f), { force: true }); // old runs
  }
  process.env.HQ_E2E_DB = join(dataDir, `e2e-${Date.now()}.sqlite`);
}
const e2eDb = process.env.HQ_E2E_DB;

// E2E runs the real `npm run dev` stack in MOCK mode on a fresh database.
export default defineConfig({
  testDir: "e2e",
  timeout: 300_000, // software WebGL in headless Chromium is slow; desktop run takes ~1-2.5 min
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { MOCK: "1", HQ_DB: e2eDb },
  },
});
