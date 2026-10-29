// End-to-end proof in MOCK mode: movement, status, streamed chat, Boss delegation, ERROR, pause, 380 px.
// Screenshots land in docs/screenshots/.
import { expect, test, type Page } from "@playwright/test";

const SHOTS = "docs/screenshots";

declare global {
  interface Window {
    __hq?: { characters: () => unknown[] };
  }
}

interface Ch {
  id: string;
  status: string;
  x: number;
  y: number;
  room: string | null;
  moving: boolean;
  badge: string | null;
}

const chars = (page: Page) => page.evaluate(() => (window.__hq?.characters() ?? []) as Ch[]);
const char = async (page: Page, id: string) => (await chars(page)).find((c) => c.id === id);

async function waitChar(page: Page, id: string, pred: (c: Ch) => boolean, timeout = 30_000): Promise<Ch> {
  let last: Ch | undefined;
  await expect
    .poll(
      async () => {
        last = await char(page, id);
        return !!last && pred(last);
      },
      { timeout, intervals: [100] },
    )
    .toBe(true);
  if (!last) throw new Error("no char");
  return last;
}

/** Uncaught page errors; every test asserts this stays empty. */
const pageErrors: string[] = [];
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
  pageErrors.length = 0;
});

async function ready(page: Page) {
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto("/");
  await expect(page.getByTestId("mode-badge")).toHaveText("MOCK");
  await expect.poll(async () => (await chars(page)).length, { timeout: 20_000 }).toBe(6);
}

test("desktop: movement, Boss delegation, streaming chat, done, error, pause", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page);

  // IDLE agents wander the Pantry/Commons: positions change over time
  const before = await chars(page);
  await page.waitForTimeout(4000);
  const after = await chars(page);
  const moved = after.filter((a) => {
    const b = before.find((x) => x.id === a.id);
    return b && (Math.abs(b.x - a.x) > 0.4 || Math.abs(b.y - a.y) > 0.4);
  });
  expect(moved.length).toBeGreaterThan(0);
  for (const c of after) expect(["pantry", "commons", null]).toContain(c.room);
  await page.screenshot({ path: `${SHOTS}/01-idle-desktop.png` });
  // exactly one live event stream (guards against duplicated streaming text)
  const health = (await (await page.request.get("/api/health")).json()) as { clients: number };
  expect(health.clients).toBe(1);

  // @mention autocomplete in Boss chat
  const input = page.getByTestId("chat-input");
  await input.fill("@raj");
  await expect(page.getByTestId("mention-menu")).toBeVisible();
  await input.press("Tab");
  await expect(input).toHaveValue("@rajaie ");
  await input.pressSequentially("fix the login build and @aktham draw the new logo");
  await page.getByTestId("chat-send").click();

  // streamed reply appears in the Boss chat
  const bossMsg = page.locator('[data-testid="chat-message"][data-author="cyrex"]').first();
  await expect(bossMsg).toContainText("[MOCK] On it");

  // delegation: Boss + both targets walk to the Meeting Room
  await waitChar(page, "cyrex", (c) => c.status === "MEETING");
  await waitChar(page, "rajaie", (c) => c.status === "MEETING" && c.room === "meeting-room" && !c.moving, 20_000);
  await waitChar(page, "cyrex", (c) => c.room === "meeting-room" && !c.moving, 20_000);
  await page.screenshot({ path: `${SHOTS}/02-meeting-desktop.png` });

  // work: Rajaie goes to his desk in Engineering and types with the "..." bubble
  const working = await waitChar(page, "rajaie", (c) => (c.status === "WORKING" || c.status === "THINKING") && c.room === "engineering" && c.badge === "dots", 30_000);
  expect(working.room).toBe("engineering");
  await expect(page.getByTestId("count-working")).not.toHaveText(/^0 /);
  await page.screenshot({ path: `${SHOTS}/03-working-desktop.png` });

  // done: green check, report back in the Boss chat, done counter up
  await waitChar(page, "rajaie", (c) => c.status === "DONE" && c.badge === "check", 30_000);
  await expect(page.locator('[data-testid="chat-message"][data-author="rajaie"]').first()).toContainText("Report:");
  await expect(page.getByTestId("count-done")).not.toHaveText(/^0 /);
  await page.screenshot({ path: `${SHOTS}/04-done-desktop.png` });
  // after 5 s DONE falls back to IDLE and the agent wanders again
  await waitChar(page, "rajaie", (c) => c.status === "IDLE" && c.badge === null, 15_000);

  // error: Zurub fails all retries -> red "!" and needs-input counter
  await page.getByTestId("tab-roster").click();
  await page.getByTestId("roster-zurub").click();
  await expect(page.getByTestId("tab-chat")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("chat-input").fill("draft the investor pitch #fail");
  await page.getByTestId("chat-send").click();
  await waitChar(page, "zurub", (c) => c.status === "ERROR" && c.badge === "alert", 30_000);
  await expect(page.getByTestId("count-needs")).toHaveText(/^1 /);
  await expect(page.locator('[data-testid="chat-message"][data-author="system"]').last()).toContainText("Error:");
  await page.screenshot({ path: `${SHOTS}/05-error-desktop.png` });

  // global pause: new work waits
  await page.getByTestId("pause").click();
  await expect(page.getByTestId("paused-banner")).toBeVisible();
  await page.getByTestId("thread-picker").getByText("Nedal").click();
  await page.getByTestId("chat-input").fill("animate a walk cycle");
  await page.getByTestId("chat-send").click();
  await page.waitForTimeout(1500);
  expect((await char(page, "nedal"))?.status).toBe("IDLE");
  await page.getByTestId("tab-roster").click();
  await expect(page.getByTestId("roster-nedal")).toContainText("1 queued");
  await page.screenshot({ path: `${SHOTS}/06-paused-roster-desktop.png` });
  await page.getByTestId("pause").click();
  await waitChar(page, "nedal", (c) => c.status === "THINKING" || c.status === "WORKING", 10_000);

  await page.getByTestId("tab-activity").click();
  await expect(page.getByTestId("activity")).toContainText("Cyrex -> Rajaie");
  await page.screenshot({ path: `${SHOTS}/07-activity-desktop.png` });
});

test("380 px: layout fits, chat and delegation work", async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await ready(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(overflow).toBeLessThanOrEqual(380);
  await expect(page.getByTestId("office-canvas")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/08-mobile-380.png` });

  await page.getByTestId("chat-input").fill("@razan audit this week's agent reports");
  await page.getByTestId("chat-send").click();
  await waitChar(page, "razan", (c) => c.status === "MEETING");
  await expect(page.locator('[data-testid="chat-message"][data-author="cyrex"]').last()).toContainText("[MOCK]");
  await page.screenshot({ path: `${SHOTS}/09-mobile-380-delegation.png` });

  // click-to-focus from the roster
  await page.getByTestId("tab-roster").click();
  await page.getByTestId("roster-razan").click();
  await waitChar(page, "razan", (c) => c.status === "DONE" || c.status === "WORKING" || c.status === "THINKING", 30_000);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/10-mobile-380-focus.png` });
});
