import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// E2E runs the real `npm run dev` stack in MOCK mode on a fresh database.
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { MOCK: "1", HQ_DB: join(tmpdir(), `hq-e2e-${Date.now()}.sqlite`) },
  },
});
