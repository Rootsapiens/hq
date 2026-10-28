// Dev helper: screenshot the running app. Usage: node scripts/peek.mjs <out.png> [width] [height]
import { chromium } from "@playwright/test";
const [out = "peek.png", w = "1440", h = "900"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
await page.goto("http://localhost:5173/");
await page.waitForTimeout(3500);
await page.screenshot({ path: out });
console.log(logs.join("\n"));
console.log(JSON.stringify(await page.evaluate(() => window.__hq?.characters())));
await browser.close();
